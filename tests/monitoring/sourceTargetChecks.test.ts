import { describe, expect, it } from 'vitest';
import { MonitorCoordinator } from '../../src/main/monitoring/monitorCoordinator';
import { AppDatabase } from '../../src/main/storage/database';
import type { Classifier, PostSource, SourceCheckResult } from '../../src/shared/domain';

const classifier: Classifier = { id: 'source-check-fixture', classify: async () => ({ level: 'irrelevant', score: 0, reasons: [], matchedTerms: [], classifierVersion: 'fixture' }) };
function fixture() {
  const database = new AppDatabase(':memory:');
  const calls: string[] = [];
  let release: (() => void) | null = null;
  let slowId: string | null = null;
  const failed = new Set<string>();
  const source = (id: string): PostSource => ({ id, check: async ({ checkedAt }): Promise<SourceCheckResult> => {
    calls.push(id);
    if (id === slowId) await new Promise<void>(resolve => { release = resolve; });
    return { sourceId: id, checkedAt, state: failed.has(id) ? 'error' : 'online', latencyMs: 0, posts: [], errorCode: failed.has(id) ? 'SOURCE_FAILED' : null };
  } });
  let outages = 0;
  const coordinator = new MonitorCoordinator({ database, sources: [source('x-browser'), source('public-rss')], classifier, onSignal: () => {}, onOutage: () => { outages += 1; } });
  return { database, calls, failed, coordinator, outages: () => outages, slow: (id: string) => { slowId = id; }, release: () => { slowId = null; release?.(); } };
}

describe('targeted source checks', () => {
  it('checks only the selected source and leaves the other source health untouched', async () => {
    const f = fixture();
    try {
      const before = f.coordinator.health.get('public-rss');
      const summary = await f.coordinator.checkNow('2026-10-02T02:14:00Z', 'x-browser');
      expect(f.calls).toEqual(['x-browser']);
      expect(summary.sourceResults.map(result => result.sourceId)).toEqual(['x-browser']);
      expect(f.coordinator.health.get('x-browser').lastSuccessAt).toBe('2026-10-02T02:14:00Z');
      expect(f.coordinator.health.get('public-rss')).toEqual(before);
    } finally { f.database.close(); }
  });

  it('does not declare an all-source outage from a single-source failure', async () => {
    const f = fixture(); f.failed.add('x-browser'); f.failed.add('public-rss');
    try {
      for (let attempt = 0; attempt < 3; attempt++) await f.coordinator.checkNow(`2026-10-02T02:1${attempt}:00Z`, 'x-browser');
      expect(f.outages()).toBe(0);
      expect(f.coordinator.health.get('public-rss').lastCheckedAt).toBeNull();
      for (let attempt = 0; attempt < 3; attempt++) await f.coordinator.checkNow(`2026-10-02T02:2${attempt}:00Z`);
      expect(f.outages()).toBe(1);
    } finally { f.database.close(); }
  });

  it('coalesces duplicate source requests but queues a different requested source', async () => {
    const f = fixture(); f.slow('x-browser');
    try {
      const first = f.coordinator.checkNow('2026-10-02T02:14:00Z', 'x-browser');
      const duplicate = f.coordinator.checkNow('2026-10-02T02:15:00Z', 'x-browser');
      const other = f.coordinator.checkNow('2026-10-02T02:16:00Z', 'public-rss');
      expect(first).toBe(duplicate);
      expect(f.calls).toEqual(['x-browser']);
      f.release();
      const [, , result] = await Promise.all([first, duplicate, other]);
      expect(f.calls).toEqual(['x-browser', 'public-rss']);
      expect(result.sourceResults.map(source => source.sourceId)).toEqual(['public-rss']);
      expect(f.coordinator.health.get('public-rss').lastCheckedAt).toBe('2026-10-02T02:16:00Z');
    } finally { f.database.close(); }
  });

  it('queues an all-source request after a source-only run and coalesces requests covered by a global run', async () => {
    const f = fixture(); f.slow('x-browser');
    try {
      const first = f.coordinator.checkNow('2026-10-02T02:14:00Z', 'x-browser');
      const all = f.coordinator.checkNow('2026-10-02T02:15:00Z');
      f.release();
      await first;
      const result = await all;
      expect(result.sourceResults.map(source => source.sourceId)).toEqual(['x-browser', 'public-rss']);
      expect(f.calls).toEqual(['x-browser', 'x-browser', 'public-rss']);
      f.slow('x-browser');
      const global = f.coordinator.checkNow('2026-10-02T02:16:00Z');
      expect(f.coordinator.checkNow('2026-10-02T02:17:00Z', 'public-rss')).toBe(global);
      f.release(); await global;
      expect(f.calls).toEqual(['x-browser', 'x-browser', 'public-rss', 'x-browser', 'public-rss']);
    } finally { f.database.close(); }
  });

  it('rejects an unknown target without checking or modifying any source', async () => {
    const f = fixture();
    try {
      await expect(f.coordinator.checkNow('2026-10-02T02:14:00Z', 'missing')).rejects.toThrow('Unknown source');
      expect(f.calls).toEqual([]);
      expect(f.coordinator.health.list().every(source => source.lastCheckedAt === null)).toBe(true);
    } finally { f.database.close(); }
  });
});

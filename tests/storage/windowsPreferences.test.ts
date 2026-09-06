import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { AppDatabase } from '../../src/main/storage/database';
import { DurableDeliveryWorker } from '../../src/main/notifications/durableDeliveryWorker';
import type { ClassificationResult, SignalEvent } from '../../src/shared/domain';

const now = new Date('2026-09-05T10:00:00.000Z');
const enabledKeys = { confirmed: 'windowsConfirmedEnabled', preview: 'windowsPreviewEnabled', related: 'windowsRelatedEnabled' } as const;

function stage(database: AppDatabase, level: SignalEvent['level']): void {
  database.upsertPost({ id: '1', authorHandle: 'thsottiaux', text: 'fixture notification', quotedText: null, kind: 'original', createdAt: '2026-09-05T09:00:00.000Z', url: 'https://x.com/thsottiaux/status/1', sourceIds: ['rss'] });
  const classification: ClassificationResult = { level, score: 10, reasons: ['fixture'], matchedTerms: [], classifierVersion: 'fixture' };
  database.recordClassificationAndSignal('1', classification, 'fixture-hash', { id: 'event', postId: '1', level, previousLevel: null, isEscalation: false, detectedAt: now.toISOString() });
}

describe('persisted per-level Windows preferences', () => {
  it('applies backward-compatible defaults to old settings JSON and round-trips all six flags without a schema bump', () => {
    const directory = mkdtempSync(join(tmpdir(), 'tibo-windows-preferences-'));
    const path = join(directory, 'fixture.sqlite');
    let database = new AppDatabase(path);
    database.close();
    const raw = new DatabaseSync(path);
    raw.prepare('UPDATE app_settings SET value_json = ? WHERE id = 1').run(JSON.stringify({ pollIntervalMinutes: 17, emailEnabled: true }));
    raw.close();
    database = new AppDatabase(path);
    try {
      expect(database.schemaVersion()).toBe(3);
      expect(database.getSettings()).toMatchObject({ pollIntervalMinutes: 17, emailEnabled: true, windowsConfirmedEnabled: true, windowsPreviewEnabled: true, windowsRelatedEnabled: true, windowsConfirmedSound: true, windowsPreviewSound: true, windowsRelatedSound: false });
      const flags = { windowsConfirmedEnabled: false, windowsPreviewEnabled: false, windowsRelatedEnabled: false, windowsConfirmedSound: false, windowsPreviewSound: false, windowsRelatedSound: true };
      database.updateSettings(flags);
      database.close();
      database = new AppDatabase(path);
      expect(database.getSettings()).toMatchObject({ ...flags, pollIntervalMinutes: 17, emailEnabled: true });
      expect(database.schemaVersion()).toBe(3);
    } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
  });

  it.each(['confirmed', 'preview', 'related'] as const)('stores disabled %s as not-sent, never submits or retries it', async (level) => {
    const database = new AppDatabase(':memory:');
    try {
      database.updateSettings({ [enabledKeys[level]]: false });
      stage(database, level);
      const deliver = vi.fn();
      const worker = new DurableDeliveryWorker({ database, windows: { id: 'windows', deliver } });
      expect(database.listDeliveryStatuses().find((item) => item.channel === 'windows')).toMatchObject({ state: 'not-sent', lastError: 'WINDOWS_NOTIFICATION_DISABLED', nextAttemptAt: null });
      await worker.processDue(now);
      await worker.retryFailed(new Date(now.getTime() + 60_000), 'event');
      expect(deliver).not.toHaveBeenCalled();
      expect(database.listDueDeliveryJobs('2026-09-05T10:30:00.000Z')).toHaveLength(0);
    } finally { database.close(); }
  });

  it.each(['confirmed', 'preview', 'related'] as const)('cancels pending %s when its Windows preference is disabled before delivery', async (level) => {
    const database = new AppDatabase(':memory:');
    try {
      stage(database, level);
      database.updateSettings({ [enabledKeys[level]]: false });
      const deliver = vi.fn();
      await new DurableDeliveryWorker({ database, windows: { id: 'windows', deliver } }).processDue(now);
      expect(deliver).not.toHaveBeenCalled();
      expect(database.listDeliveryStatuses().find((item) => item.channel === 'windows')).toMatchObject({ state: 'cancelled', lastError: 'WINDOWS_NOTIFICATION_DISABLED', nextAttemptAt: null });
    } finally { database.close(); }
  });

  it.each(['confirmed', 'preview'] as const)('keeps %s email staged independently when Windows is disabled', (level) => {
    const database = new AppDatabase(':memory:');
    try {
      database.updateSettings({ [enabledKeys[level]]: false, emailEnabled: true, emailRecipients: ['fixture@example.com'] });
      stage(database, level);
      expect(database.listDueDeliveryJobs(now.toISOString())).toEqual([expect.objectContaining({ channel: 'email', recipient: 'fixture@example.com', state: 'pending' })]);
      expect(database.listDeliveryStatuses().find((item) => item.channel === 'windows')?.state).toBe('not-sent');
    } finally { database.close(); }
  });
});

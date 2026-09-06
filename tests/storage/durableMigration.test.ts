import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { AppDatabase } from '../../src/main/storage/database';
import { createLegacyFixture } from './legacyFixture';

describe('complete legacy migration', () => {
  it.each([1, 2] as const)('migrates v%s alias collisions without deleting any history or replaying sent/failed events', (version) => {
    const directory = mkdtempSync(join(tmpdir(), 'tibo-full-migration-'));
    const path = join(directory, 'fixture.sqlite');
    createLegacyFixture(path, version);
    const database = new AppDatabase(path);
    try {
      expect(database.schemaVersion()).toBe(3);
      expect(database.getSettings()).toMatchObject({ pollIntervalMinutes: 17, onboardingComplete: true, smtpHost: 'fixture.invalid' });
      expect(database.getEncryptedSecret('smtp-password')).toEqual(Buffer.from([7,19,42,255]));
      expect(() => database.recordClassification('missing-parent', database.getLatestClassification('42')!)).toThrow(/FOREIGN KEY/i);
      expect(database.listPosts()).toHaveLength(3);
      expect(database.getPost('rss-guid')).toMatchObject({ id: '42', kind: 'quote', quotedText: 'Long retained quote evidence', sourceIds: ['public-rss', 'x-browser'] });
      expect(database.listSignalEvents()).toHaveLength(3);
      expect(database.getSignalEvent('event-rss-guid')).toMatchObject({ postId: '42' });
      expect(database.listDueDeliveryJobs('2026-09-05T10:01:00.000Z')).toEqual(expect.arrayContaining([expect.objectContaining({ eventId: 'event-pending-only', recipient: 'a@example.com' }), expect.objectContaining({ eventId: 'event-pending-only', recipient: 'b@example.com' })]));
      expect(database.listDueDeliveryJobs('2026-09-05T10:01:00.000Z')).toHaveLength(2);
      const raw = new DatabaseSync(path);
      try {
        for (const [table, count] of [['classifications', 4], ['signal_events', 4], ['mail_queue', 4], ['deliveries', 3], ['source_observations', 1], ['encrypted_secrets', 1], ['event_snapshots', 4], ['post_alias_history', 4]] as const) expect(raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toMatchObject({ n: count });
        expect(raw.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
        expect(raw.prepare('SELECT superseded_by FROM signal_events WHERE id = ?').get('event-rss-guid')).toMatchObject({ superseded_by: 'event-42' });
        expect(raw.prepare('SELECT COUNT(*) AS n FROM classifications WHERE post_id = ?').get('42')).toMatchObject({ n: 2 });
      } finally { raw.close(); }
    } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
  });
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { AppDatabase } from '../../src/main/storage/database';
import type { ClassificationResult, MonitoredPost, SignalEvent } from '../../src/shared/domain';

describe('AppDatabase', () => {
  let database: AppDatabase | null = null;
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    database?.close();
    database = null;
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('applies migrations and exposes initial app settings', () => {
    database = new AppDatabase(':memory:');

    expect(database.schemaVersion()).toBe(3);
    expect(database.getSettings()).toMatchObject({
      pollIntervalMinutes: 5,
      browserSourceEnabled: false,
      publicRssEnabled: true,
      startAtLogin: true,
      closeToTray: true,
      baselineComplete: false,
    });
  });

  it('transactionally migrates an on-disk v1 database to v3 without losing data', () => {
    const directory = mkdtempSync(join(tmpdir(), 'tibo-watch-v1-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'fixture.sqlite');
    createV1Fixture(path);

    database = new AppDatabase(path);

    expect(database.schemaVersion()).toBe(3);
    expect(database.getSettings()).toMatchObject({
      pollIntervalMinutes: 17,
      baselineComplete: true,
      smtpHost: 'smtp.fixture.test',
    });
    expect(database.getPost('legacy-post')).toMatchObject({
      text: 'Legacy complete text',
      quotedText: 'Legacy quote',
      kind: 'quote',
      sourceIds: ['legacy-source'],
    });
    expect(database.getLatestClassification('legacy-post')).toMatchObject({
      level: 'preview',
      classifierVersion: 'rules-v1',
      inputHash: null,
    });

    const raw = new DatabaseSync(path);
    const columns = raw.prepare('PRAGMA table_info(classifications)').all() as Array<{ name: string }>;
    const indexes = raw.prepare('PRAGMA index_list(classifications)').all() as Array<{ name: string }>;
    const plan = raw
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT post_id, level, score, reasons_json, matched_terms_json,
                classifier_version, input_hash, created_at
         FROM classifications WHERE post_id = ? ORDER BY id DESC LIMIT 1`,
      )
      .all('legacy-post') as Array<{ detail: string }>;
    raw.close();

    expect(columns.map((column) => column.name)).toContain('input_hash');
    expect(indexes.map((index) => index.name)).toContain('idx_classifications_post_id_id');
    expect(plan.some((step) => step.detail.includes('idx_classifications_post_id_id'))).toBe(true);
  });

  it('merges evidence from two sources without duplicating a post', () => {
    database = new AppDatabase(':memory:');

    database.upsertPost(postFixture(['public-rss']));
    database.upsertPost(postFixture(['x-browser']));

    expect(database.listPosts()).toHaveLength(1);
    expect(database.getPost('post-1')?.sourceIds).toEqual(['public-rss', 'x-browser']);
  });

  it('does not overwrite a complete post with a later truncated observation', () => {
    database = new AppDatabase(':memory:');
    const completeText =
      'Update on rate limits in Codex. As part of the fixes tomorrow, we will do a full reset of usage for all paid subscriptions.';

    database.upsertPost({ ...postFixture(['x-browser']), text: completeText });
    database.upsertPost({ ...postFixture(['x-browser']), text: completeText.slice(0, 48) });

    expect(database.getPost('post-1')?.text).toBe(completeText);
  });

  it('stores the latest classification while retaining its evidence', () => {
    database = new AppDatabase(':memory:');
    database.upsertPost(postFixture(['public-rss']));
    database.recordClassification('post-1', classificationFixture('preview'));
    database.recordClassification('post-1', classificationFixture('confirmed'));

    expect(database.getLatestClassification('post-1')).toMatchObject({
      level: 'confirmed',
      score: 10,
      reasons: ['明确表示额度已经重置'],
      matchedTerms: ['reset', 'Codex'],
    });
  });

  it('round-trips the canonical classification input hash', () => {
    database = new AppDatabase(':memory:');
    database.upsertPost(postFixture(['public-rss']));

    database.recordClassification('post-1', classificationFixture('preview'), 'abc123');

    expect(database.getLatestClassification('post-1')).toMatchObject({
      inputHash: 'abc123',
    });
  });

  it('deduplicates delivery events by post and signal level', () => {
    database = new AppDatabase(':memory:');
    database.upsertPost(postFixture(['public-rss']));
    const event = eventFixture('confirmed');

    expect(database.insertSignalEvent(event)).toBe(true);
    expect(database.insertSignalEvent({ ...event, id: 'event-duplicate' })).toBe(false);
    expect(database.listSignalEvents()).toHaveLength(1);
  });

  it('persists settings updates with recipient normalization', () => {
    database = new AppDatabase(':memory:');

    database.updateSettings({
      pollIntervalMinutes: 10,
      emailRecipients: [' first@example.com ', 'second@example.com', 'first@example.com'],
    });

    expect(database.getSettings()).toMatchObject({
      pollIntervalMinutes: 10,
      emailRecipients: ['first@example.com', 'second@example.com'],
    });
  });

  it('stores encrypted credentials without exposing plaintext', () => {
    database = new AppDatabase(':memory:');
    const ciphertext = Buffer.from([7, 19, 42, 255]);
    database.setEncryptedSecret('smtp-password', ciphertext);
    expect(database.getEncryptedSecret('smtp-password')).toEqual(ciphertext);
  });

  it('persists and advances the cross-restart mail retry queue', () => {
    database = new AppDatabase(':memory:');
    database.upsertPost(postFixture(['public-rss']));
    const event = eventFixture('confirmed');
    database.insertSignalEvent(event);
    const id = database.enqueueMail(event.id, 1, '2026-07-31T05:01:00.000Z');
    expect(database.listDueMail('2026-07-31T05:00:59.000Z')).toEqual([]);
    expect(database.listDueMail('2026-07-31T05:01:00.000Z')[0]).toMatchObject({
      id,
      eventId: event.id,
      attempt: 1,
      status: 'pending',
    });
    database.rescheduleMail(id, 2, '2026-07-31T05:06:00.000Z', 'ECONNREFUSED');
    expect(database.listMailQueue()[0]).toMatchObject({
      attempt: 2,
      nextAttemptAt: '2026-07-31T05:06:00.000Z',
      lastError: 'ECONNREFUSED',
    });
    database.markMailFinal(id);
    expect(database.listMailQueue()[0]?.status).toBe('failed');
  });
});

function createV1Fixture(path: string): void {
  const raw = new DatabaseSync(path);
  raw.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE app_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE posts (
      id TEXT PRIMARY KEY,
      author_handle TEXT NOT NULL,
      text TEXT NOT NULL,
      quoted_text TEXT,
      published_at TEXT NOT NULL,
      kind TEXT NOT NULL,
      url TEXT NOT NULL,
      source_ids_json TEXT NOT NULL,
      first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE classifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      level TEXT NOT NULL,
      score INTEGER NOT NULL,
      reasons_json TEXT NOT NULL,
      matched_terms_json TEXT NOT NULL,
      classifier_version TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    PRAGMA user_version = 1;
  `);
  raw
    .prepare('INSERT INTO app_settings (id, value_json) VALUES (1, ?)')
    .run(JSON.stringify({
      pollIntervalMinutes: 17,
      baselineComplete: true,
      smtpHost: 'smtp.fixture.test',
    }));
  raw
    .prepare(
      `INSERT INTO posts (
         id, author_handle, text, quoted_text, published_at, kind, url, source_ids_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      'legacy-post',
      'thsottiaux',
      'Legacy complete text',
      'Legacy quote',
      '2026-07-31T04:53:19.000Z',
      'quote',
      'https://x.com/thsottiaux/status/legacy-post',
      JSON.stringify(['legacy-source']),
    );
  raw
    .prepare(
      `INSERT INTO classifications (
         post_id, level, score, reasons_json, matched_terms_json, classifier_version
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      'legacy-post',
      'preview',
      7,
      JSON.stringify(['legacy reason']),
      JSON.stringify(['reset']),
      'rules-v1',
    );
  raw.close();
}

function postFixture(sourceIds: string[]): MonitoredPost {
  return {
    id: 'post-1',
    authorHandle: 'thsottiaux',
    text: 'Codex reset soon',
    createdAt: '2026-07-31T04:53:19.000Z',
    url: 'https://x.com/thsottiaux/status/post-1',
    kind: 'original',
    quotedText: null,
    sourceIds,
  };
}

function classificationFixture(level: ClassificationResult['level']): ClassificationResult {
  return {
    level,
    score: level === 'confirmed' ? 10 : 7,
    reasons: level === 'confirmed' ? ['明确表示额度已经重置'] : ['表达了未来或疑问式重置意图'],
    matchedTerms: ['reset', 'Codex'],
    classifierVersion: 'rules-v1',
  };
}

function eventFixture(level: SignalEvent['level']): SignalEvent {
  return {
    id: `event-${level}`,
    postId: 'post-1',
    level,
    previousLevel: null,
    isEscalation: false,
    detectedAt: '2026-07-31T05:00:00.000Z',
  };
}

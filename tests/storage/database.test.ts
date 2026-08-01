import { afterEach, describe, expect, it } from 'vitest';
import { AppDatabase } from '../../src/main/storage/database';
import type { ClassificationResult, MonitoredPost, SignalEvent } from '../../src/shared/domain';

describe('AppDatabase', () => {
  let database: AppDatabase | null = null;

  afterEach(() => {
    database?.close();
    database = null;
  });

  it('applies migrations and exposes initial app settings', () => {
    database = new AppDatabase(':memory:');

    expect(database.schemaVersion()).toBe(1);
    expect(database.getSettings()).toMatchObject({
      pollIntervalMinutes: 5,
      browserSourceEnabled: false,
      publicRssEnabled: true,
      startAtLogin: true,
      closeToTray: true,
      baselineComplete: false,
    });
  });

  it('merges evidence from two sources without duplicating a post', () => {
    database = new AppDatabase(':memory:');

    database.upsertPost(postFixture(['public-rss']));
    database.upsertPost(postFixture(['x-browser']));

    expect(database.listPosts()).toHaveLength(1);
    expect(database.getPost('post-1')?.sourceIds).toEqual(['public-rss', 'x-browser']);
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

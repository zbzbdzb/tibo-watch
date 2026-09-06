import { describe, expect, it, vi } from 'vitest';

import { MailRetryWorker } from '../../src/main/notifications/retryWorker';
import { AppDatabase } from '../../src/main/storage/database';
import type { DeliveryReceipt, SignalEvent } from '../../src/shared/domain';

describe('MailRetryWorker', () => {
  it('advances 1/5/15 minute retries and marks the third retry final', async () => {
    const database = new AppDatabase(':memory:');
    database.upsertPost({
      id: 'retry-post', authorHandle: 'thsottiaux', text: 'Codex reset now',
      createdAt: '2026-07-31T04:53:19.000Z', url: 'https://x.com/thsottiaux/status/700',
      kind: 'original', quotedText: null, sourceIds: ['public-rss'],
    });
    const event: SignalEvent = {
      id: 'retry-event', postId: 'retry-post', level: 'confirmed', previousLevel: null,
      isEscalation: false, detectedAt: '2026-07-31T05:00:00.000Z',
    };
    database.insertSignalEvent(event);
    const failed: DeliveryReceipt = { channel: 'email', state: 'failed', deliveredAt: null, errorCode: 'ECONNREFUSED' };
    const email = { deliver: vi.fn(async () => failed) };
    const finalFailure = vi.fn();
    const worker = new MailRetryWorker(database, email as never, finalFailure);
    const queueId = database.enqueueMail(event.id, 1, '2026-07-31T05:01:00.000Z');

    await worker.processDue(new Date('2026-07-31T05:01:00.000Z'));
    expect(database.listMailQueue()[0]).toMatchObject({ attempt: 2, nextAttemptAt: '2026-07-31T05:06:00.000Z' });
    await worker.processDue(new Date('2026-07-31T05:06:00.000Z'));
    expect(database.listMailQueue()[0]).toMatchObject({ attempt: 3, nextAttemptAt: '2026-07-31T05:21:00.000Z' });
    await worker.processDue(new Date('2026-07-31T05:21:00.000Z'));
    expect(database.listMailQueue().find((item) => item.id === queueId)?.status).toBe('failed');
    expect(finalFailure).toHaveBeenCalledWith({ ...event, postId: '700' });
    database.close();
  });
});

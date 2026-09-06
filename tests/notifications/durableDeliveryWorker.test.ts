import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppDatabase } from '../../src/main/storage/database';
import { DurableDeliveryWorker } from '../../src/main/notifications/durableDeliveryWorker';
import { MonitorCoordinator } from '../../src/main/monitoring/monitorCoordinator';
import type { ClassificationResult, DeliveryChannel, MonitoredPost, SignalEvent } from '../../src/shared/domain';

const now = new Date('2026-09-05T10:00:00.000Z');
const post: MonitoredPost = { id: '42', authorHandle: 'thsottiaux', text: 'Codex reset now', quotedText: null, kind: 'original', createdAt: '2026-09-05T09:00:00.000Z', url: 'https://x.com/thsottiaux/status/42', sourceIds: ['public-rss'] };
const classification: ClassificationResult = { level: 'confirmed', score: 10, reasons: ['immutable reason'], matchedTerms: ['reset'], classifierVersion: 'test-v1' };
const event: SignalEvent = { id: 'event-42', postId: '42', level: 'confirmed', previousLevel: null, isEscalation: false, detectedAt: now.toISOString() };
const windows = (): DeliveryChannel => ({ id: 'windows', deliver: vi.fn(async () => ({ channel: 'windows' as const, state: 'sent' as const, deliveredAt: now.toISOString(), errorCode: null })) });

describe('durable delivery', () => {
  const databases: AppDatabase[] = [];
  const directories: string[] = [];
  afterEach(() => { for (const db of databases.splice(0)) db.close(); for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });
  function setup(path = ':memory:') {
    const db = new AppDatabase(path); databases.push(db);
    db.updateSettings({ baselineComplete: true, emailEnabled: true, emailRecipients: ['a@example.com', 'b@example.com'] });
    db.upsertPost(post);
    db.recordClassificationAndSignal(post.id, classification, 'hash', event);
    return db;
  }

  it('resumes after onSignal failure and restart without reclassifying unchanged input', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tibo-delivery-')); directories.push(dir);
    const path = join(dir, 'db.sqlite');
    let db = new AppDatabase(path); db.updateSettings({ baselineComplete: true });
    const classify = vi.fn(async () => classification);
    const coordinator = new MonitorCoordinator({ database: db, classifier: { id: 'test', classify }, sources: [{ id: 'rss', check: async ({ checkedAt }) => ({ sourceId: 'rss', state: 'online', posts: [post, { ...post, id: '43', url: 'https://x.com/thsottiaux/status/43' }], latencyMs: 0, errorCode: null, checkedAt }) }], onSignal: async () => { throw new Error('wakeup failed'); } });
    await expect(coordinator.checkNow(now.toISOString())).resolves.toMatchObject({ signalsEmitted: 2 });
    expect(db.listDeliveryStatuses().filter((row) => row.state === 'pending')).toHaveLength(2);
    db.close(); db = new AppDatabase(path); databases.push(db);
    const channel = windows();
    const worker = new DurableDeliveryWorker({ database: db, windows: channel });
    await worker.processDue(now);
    expect(channel.deliver).toHaveBeenCalledTimes(2);
    expect(classify).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent workers and persists each accepted recipient before retrying only failures', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tibo-concurrent-')); directories.push(dir);
    const path = join(dir, 'db.sqlite');
    const db = setup(path); const other = new AppDatabase(path); databases.push(other); const channel = windows();
    const deliverRecipients = vi.fn(async (_event: SignalEvent, recipients: string[]) => recipients.map((recipient) => ({ recipient, accepted: recipient === 'a@example.com', errorCode: recipient === 'a@example.com' ? null : 'SMTP_RECIPIENT_REJECTED' })));
    const worker = new DurableDeliveryWorker({ database: db, windows: channel, email: { deliverRecipients } });
    const secondWorker = new DurableDeliveryWorker({ database: other, windows: channel, email: { deliverRecipients } });
    await Promise.all([worker.processDue(now), worker.processDue(now), secondWorker.processDue(now)]);
    expect(channel.deliver).toHaveBeenCalledTimes(1);
    expect(db.listDeliveryStatuses().find((row) => row.channel === 'email')).toMatchObject({ state: 'partial', acceptedRecipientCount: 1, pendingRecipientCount: 1 });
    await worker.processDue(new Date(now.getTime() + 60_000));
    expect(deliverRecipients.mock.calls.map((call) => call[1])).toEqual([['a@example.com'], ['b@example.com'], ['b@example.com']]);
  });

  it.each(['irrelevant', 'preview'] as const)('cancels a queued confirmation after downgrade to %s', async (level) => {
    const db = setup(); db.recordClassification(post.id, { ...classification, level });
    const channel = windows(); const email = { deliverRecipients: vi.fn() };
    await new DurableDeliveryWorker({ database: db, windows: channel, email }).processDue(now);
    expect(channel.deliver).not.toHaveBeenCalled(); expect(email.deliverRecipients).not.toHaveBeenCalled();
    expect(db.listDeliveryStatuses().every((row) => row.state === 'cancelled')).toBe(true);
  });

  it('respects removed recipients, disabled email, and expired posts without replaying', async () => {
    const db = setup(); db.updateSettings({ emailRecipients: ['b@example.com', 'new@example.com'] });
    const email = { deliverRecipients: vi.fn(async (_event: SignalEvent, recipients: string[]) => recipients.map((recipient) => ({ recipient, accepted: true, errorCode: null }))) };
    await new DurableDeliveryWorker({ database: db, windows: windows(), email }).processDue(now);
    expect(email.deliverRecipients.mock.calls.map((call) => call[1])).toEqual([['b@example.com']]);
    expect(db.listDeliveryStatuses().find((row) => row.channel === 'email')).toMatchObject({ acceptedRecipientCount: 1 });
  });

  it('reclaims interrupted in-flight work with uncertainty while retaining accepted recipient success', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tibo-inflight-')); directories.push(dir);
    const path = join(dir, 'db.sqlite'); let db = setup(path);
    const jobs = db.listDueDeliveryJobs(now.toISOString());
    const accepted = jobs.find((job) => job.recipient === 'a@example.com')!;
    const interrupted = jobs.find((job) => job.recipient === 'b@example.com')!;
    db.claimDeliveryJob(accepted.id, now.toISOString()); db.finishDeliveryJob(accepted.id, 'submitted', now.toISOString());
    db.claimDeliveryJob(interrupted.id, now.toISOString());
    db.close(); databases.splice(databases.indexOf(db), 1);
    db = new AppDatabase(path); databases.push(db);
    const email = { deliverRecipients: vi.fn(async (_event: SignalEvent, recipients: string[]) => recipients.map((recipient) => ({ recipient, accepted: true, errorCode: null }))) };
    await new DurableDeliveryWorker({ database: db, windows: windows(), email }).processDue(now);
    expect(email.deliverRecipients.mock.calls.map((call) => call[1])).toEqual([['b@example.com']]);
    expect(db.listDeliveryStatuses().find((row) => row.channel === 'email')).toMatchObject({ state: 'submitted', uncertain: true, acceptedRecipientCount: 2 });
  });

  it('commits neither classification nor signal when intent insertion fails', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tibo-atomic-')); directories.push(dir);
    const path = join(dir, 'db.sqlite'); const db = new AppDatabase(path); databases.push(db); db.upsertPost(post);
    const raw = new DatabaseSync(path);
    raw.exec("CREATE TRIGGER fail_intent BEFORE INSERT ON delivery_jobs BEGIN SELECT RAISE(ABORT, 'fixture failure'); END");
    expect(() => db.recordClassificationAndSignal(post.id, classification, 'hash', event)).toThrow('fixture failure');
    expect(db.getLatestClassification(post.id)).toBeUndefined(); expect(db.listSignalEvents()).toHaveLength(0);
    expect(raw.prepare('SELECT COUNT(*) AS n FROM event_snapshots').get()).toMatchObject({ n: 0 });
    raw.close();
  });

  it('retries at 1/5/15 minutes and finishes permanently after the third retry, then allows explicit per-event retry', async () => {
    const db = setup(); const final = vi.fn();
    const email = { deliverRecipients: vi.fn(async (_event: SignalEvent, recipients: string[]) => recipients.map((recipient) => ({ recipient, accepted: false, errorCode: 'EAUTH' }))) };
    const worker = new DurableDeliveryWorker({ database: db, windows: windows(), email, onFinalFailure: final });
    for (const minutes of [0, 1, 6, 21]) await worker.processDue(new Date(now.getTime() + minutes * 60_000));
    expect(db.listDeliveryStatuses().find((row) => row.channel === 'email')).toMatchObject({ state: 'failed', failedRecipientCount: 2, nextAttemptAt: null });
    expect(email.deliverRecipients).toHaveBeenCalledTimes(8);
    expect(final).toHaveBeenCalledTimes(1);
    await worker.retryFailed(new Date(now.getTime() + 22 * 60_000), 'different-event');
    expect(email.deliverRecipients).toHaveBeenCalledTimes(8);
    await worker.retryFailed(new Date(now.getTime() + 22 * 60_000), event.id);
    expect(email.deliverRecipients).toHaveBeenCalledTimes(10);
  });

  it.each(['disabled', 'expired'] as const)('cancels %s work before sending', async (mode) => {
    const db = setup(); if (mode === 'disabled') db.updateSettings({ emailEnabled: false });
    const email = { deliverRecipients: vi.fn() };
    await new DurableDeliveryWorker({ database: db, windows: windows(), email }).processDue(mode === 'expired' ? new Date('2026-09-06T10:00:00.000Z') : now);
    expect(email.deliverRecipients).not.toHaveBeenCalled();
    expect(db.listDeliveryStatuses().find((row) => row.channel === 'email')).toMatchObject({ state: 'cancelled', lastError: mode === 'expired' ? 'EVENT_EXPIRED' : 'EMAIL_DISABLED' });
  });
});

import type { Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmailChannel } from '../../src/main/notifications/emailChannel';
import { AppDatabase } from '../../src/main/storage/database';
import type { SignalEvent } from '../../src/shared/domain';

describe('SMTP recipient accounting', () => {
  const databases: AppDatabase[] = [];
  afterEach(() => { for (const db of databases.splice(0)) db.close(); });
  const event: SignalEvent = { id: 'event', postId: '1', level: 'confirmed', previousLevel: null, isEscalation: false, detectedAt: '2026-09-05T10:00:00.000Z' };
  function setup(info: { accepted: string[]; rejected: string[] } | Error) {
    const database = new AppDatabase(':memory:'); databases.push(database);
    database.updateSettings({ emailEnabled: true, emailRecipients: ['a@example.com', 'b@example.com'], smtpHost: 'fixture.invalid', smtpUsername: 'dummy', smtpFrom: 'sender@example.com' });
    database.upsertPost({ id: '1', text: 'immutable original evidence', quotedText: null, kind: 'original', createdAt: '2026-09-05T09:00:00.000Z', url: 'https://x.com/thsottiaux/status/1', authorHandle: 'thsottiaux', sourceIds: ['rss'] });
    database.recordClassificationAndSignal('1', { level: 'confirmed', score: 10, reasons: ['immutable reason'], matchedTerms: ['reset'], classifierVersion: 'v1' }, 'hash', event);
    const sendMail = vi.fn(async () => { if (info instanceof Error) throw info; return info; });
    const close = vi.fn();
    const createTransport = vi.fn(() => ({ sendMail, close }) as unknown as Transporter<SMTPTransport.SentMessageInfo>);
    return { database, sendMail, close, createTransport, channel: new EmailChannel({ database, getPassword: () => 'dummy-password-never-log', createTransport }) };
  }

  it.each([
    { info: { accepted: ['a@example.com', 'b@example.com'], rejected: [] }, state: 'sent' },
    { info: { accepted: ['a@example.com'], rejected: ['b@example.com'] }, state: 'partial' },
    { info: { accepted: [], rejected: ['a@example.com', 'b@example.com'] }, state: 'failed' },
  ])('reports $state for direct send and test mail from actual accepted/rejected lists', async ({ info, state }) => {
    const { channel, close, createTransport } = setup(info);
    expect(await channel.deliver(event)).toMatchObject({ state, acceptedRecipients: info.accepted, rejectedRecipients: info.rejected });
    expect(await channel.sendTestEmail()).toMatchObject({ state, acceptedRecipients: info.accepted, rejectedRecipients: info.rejected });
    expect(close).toHaveBeenCalledTimes(2);
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000, logger: false, debug: false }));
  });

  it('does not treat an exception or arbitrary exception text as an accepted delivery or a safe error code', async () => {
    const error = Object.assign(new Error('dummy-password-never-log'), { code: 'dummy-password-never-log' });
    const { channel } = setup(error);
    const receipt = await channel.deliver(event);
    expect(receipt).toMatchObject({ state: 'failed', errorCode: 'SMTP_SEND_FAILED', acceptedRecipients: [] });
    expect(JSON.stringify(receipt)).not.toContain('dummy-password');
  });

  it('uses immutable snapshots and stable per-event/recipient Message-ID across retries', async () => {
    const { database, channel, sendMail } = setup({ accepted: ['a@example.com'], rejected: [] });
    database.upsertPost({ ...database.getPost('1')!, text: 'newer and longer text that was never in original evidence' });
    database.recordClassification('1', { level: 'confirmed', score: 10, reasons: ['newer reason'], matchedTerms: ['newer'], classifierVersion: 'v2' });
    await channel.deliverRecipients(event, ['a@example.com']); await channel.deliverRecipients(event, ['a@example.com']);
    const calls = sendMail.mock.calls as unknown as [[{ text: string; messageId: string }], [{ text: string; messageId: string }]];
    expect(calls[0][0].text).toContain('immutable original evidence');
    expect(calls[0][0].text).toContain('immutable reason');
    expect(calls[0][0].text).not.toContain('newer');
    expect(calls[0][0].messageId).toEqual(calls[1][0].messageId);
    expect(calls[0][0].messageId).toMatch(/^<tibo-[a-f0-9]{64}@tibo-watch.local>$/);
  });
});

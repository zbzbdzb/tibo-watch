import nodemailer from 'nodemailer';
import { SMTPServer } from 'smtp-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EmailChannel } from '../../src/main/notifications/emailChannel';
import { AppDatabase } from '../../src/main/storage/database';
import { DurableDeliveryWorker } from '../../src/main/notifications/durableDeliveryWorker';
import type { SignalEvent } from '../../src/shared/domain';

describe('EmailChannel with a local SMTP server', () => {
  const messages: string[] = [];
  const envelopes: string[][] = [];
  const rejectedRecipients = new Set<string>();
  const server = new SMTPServer({
    authOptional: true,
    onAuth(_auth, _session, callback) { callback(null, { user: 'sender@example.com' }); },
    onRcptTo(address, _session, callback) {
      if (rejectedRecipients.has(address.address)) callback(Object.assign(new Error('fixture recipient rejected'), { responseCode: 550 }));
      else callback();
    },
    onData(stream, session, callback) {
      let raw = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => { raw += chunk; });
      stream.on('end', () => { messages.push(raw); envelopes.push(session.envelope.rcptTo.map((recipient) => recipient.address)); callback(); });
    },
  });
  let port: number;
  let database: AppDatabase | undefined;
  let channel: EmailChannel;

  beforeAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.server.address();
    if (!address || typeof address === 'string') throw new Error('SMTP test server has no TCP port');
    port = address.port;
    database = new AppDatabase(':memory:');
    database.updateSettings({
      emailEnabled: true,
      smtpHost: '127.0.0.1',
      smtpPort: port,
      smtpSecure: false,
      smtpUsername: 'sender@example.com',
      smtpFrom: 'Tibo Watch <sender@example.com>',
      emailRecipients: ['first@example.com', 'second@example.com'],
    });
    database.upsertPost({
      id: 'smtp-post', authorHandle: 'thsottiaux', text: 'Codex reset now',
      createdAt: '2026-07-31T04:53:19.000Z', url: 'https://x.com/thsottiaux/status/600',
      kind: 'original', quotedText: null, sourceIds: ['public-rss'],
    });
    database.recordClassification('smtp-post', {
      level: 'confirmed', score: 10, reasons: ['明确确认'], matchedTerms: ['Codex', 'reset'], classifierVersion: 'rules-v1',
    });
    channel = new EmailChannel({
      database,
      getPassword: () => 'app-password',
      createTransport: (options) => nodemailer.createTransport({
        ...options,
        tls: { rejectUnauthorized: false },
      }),
    });
  });

  afterAll(async () => {
    database?.close();
    await new Promise<void>((resolve) => server.close(resolve));
  });

  it('delivers a confirmed message to multiple recipients', async () => {
    const event: SignalEvent = {
      id: 'smtp-event', postId: 'smtp-post', level: 'confirmed', previousLevel: null,
      isEscalation: false, detectedAt: '2026-07-31T05:00:00.000Z',
    };
    expect(await channel.deliver(event)).toMatchObject({ state: 'sent', errorCode: null });
    expect(messages[0]).toContain('first@example.com');
    expect(messages[0]).toContain('second@example.com');
    expect(messages[0]).not.toContain('app-password');
  });

  it('delivers a test email through the same SMTP configuration', async () => {
    expect(await channel.sendTestEmail()).toMatchObject({ state: 'sent', errorCode: null });
    expect(messages[1]).toContain('Tibo Watch');
  });

  it('reports mixed SMTP RCPT acceptance as partial, including test mail, and all-reject as failed', async () => {
    rejectedRecipients.add('second@example.com');
    const event: SignalEvent = { id: 'partial-event', postId: 'smtp-post', level: 'confirmed', previousLevel: null, isEscalation: false, detectedAt: '2026-07-31T05:00:00.000Z' };
    expect(await channel.deliver(event)).toMatchObject({ state: 'partial', acceptedRecipients: ['first@example.com'], rejectedRecipients: ['second@example.com'] });
    expect(await channel.sendTestEmail()).toMatchObject({ state: 'partial', errorCode: 'SMTP_PARTIAL_ACCEPTANCE' });
    rejectedRecipients.add('first@example.com');
    expect(await channel.deliver(event)).toMatchObject({ state: 'failed', acceptedRecipients: [], errorCode: 'EENVELOPE' });
    rejectedRecipients.clear();
  });

  it('durably retains accepted A and sends only B on a local SMTP retry', async () => {
    if (!database) throw new Error('fixture database missing');
    const event: SignalEvent = { id: 'durable-smtp-event', postId: 'smtp-post', level: 'confirmed', previousLevel: null, isEscalation: false, detectedAt: '2026-07-31T05:00:00.000Z' };
    database.recordClassificationAndSignal('smtp-post', database.getLatestClassification('smtp-post')!, 'local-smtp-hash', event);
    const worker = new DurableDeliveryWorker({ database, email: channel, windows: { id: 'windows', deliver: async () => ({ channel: 'windows', state: 'sent', deliveredAt: event.detectedAt, errorCode: null }) } });
    rejectedRecipients.add('second@example.com');
    const start = envelopes.length;
    await Promise.all([worker.processDue(new Date(event.detectedAt)), worker.processDue(new Date(event.detectedAt))]);
    expect(database.listDeliveryStatuses().find((row) => row.eventId === event.id && row.channel === 'email')).toMatchObject({ state: 'partial', acceptedRecipientCount: 1, pendingRecipientCount: 1 });
    rejectedRecipients.clear();
    await worker.processDue(new Date('2026-07-31T05:01:00.000Z'));
    expect(envelopes.slice(start)).toEqual([['first@example.com'], ['second@example.com']]);
    expect(database.listDeliveryStatuses().find((row) => row.eventId === event.id && row.channel === 'email')).toMatchObject({ state: 'submitted', acceptedRecipientCount: 2, pendingRecipientCount: 0 });
    const ids = messages.slice(start).map((message) => message.replace(/\r?\n[ \t]+/g, '').match(/^Message-ID:\s*(.+)$/im)?.[1]);
    expect(ids.every((id) => id?.includes('@tibo-watch.local>'))).toBe(true);
    expect(new Set(ids).size).toBe(2);
  });
});

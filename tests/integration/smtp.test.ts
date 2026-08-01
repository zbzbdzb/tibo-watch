import nodemailer from 'nodemailer';
import { SMTPServer } from 'smtp-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EmailChannel } from '../../src/main/notifications/emailChannel';
import { AppDatabase } from '../../src/main/storage/database';
import type { SignalEvent } from '../../src/shared/domain';

describe('EmailChannel with a local SMTP server', () => {
  const messages: string[] = [];
  const server = new SMTPServer({
    authOptional: true,
    onAuth(_auth, _session, callback) { callback(null, { user: 'sender@example.com' }); },
    onData(stream, _session, callback) {
      let raw = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => { raw += chunk; });
      stream.on('end', () => { messages.push(raw); callback(); });
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
});

import { createHash, randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import type { DeliveryChannel, DeliveryReceipt, SignalEvent } from '../../shared/domain';
import type { AppDatabase } from '../storage/database';
import { buildEmailMessage, emailSettingsSchema } from './email';

export interface EmailChannelOptions {
  database: AppDatabase;
  getPassword: () => string | null;
  createTransport?: (options: SMTPTransport.Options) => Transporter<SMTPTransport.SentMessageInfo>;
}
export interface RecipientOutcome { recipient: string; accepted: boolean; errorCode: string | null }

export class EmailChannel implements DeliveryChannel {
  readonly id = 'email' as const;
  private readonly database: AppDatabase;
  private readonly getPassword: EmailChannelOptions['getPassword'];
  private readonly createTransport: NonNullable<EmailChannelOptions['createTransport']>;

  constructor(options: EmailChannelOptions) {
    this.database = options.database;
    this.getPassword = options.getPassword;
    this.createTransport = options.createTransport ?? ((config) => nodemailer.createTransport(config));
  }

  async deliver(event: SignalEvent): Promise<DeliveryReceipt> {
    return receiptFromOutcomes(await this.deliverRecipients(event, this.database.getSettings().emailRecipients));
  }

  async deliverRecipients(event: SignalEvent, recipients: string[]): Promise<RecipientOutcome[]> {
    const snapshot = this.database.getEventSnapshot(event.id);
    const post = snapshot?.post ?? this.database.getPost(event.postId);
    const classification = snapshot?.classification ?? this.database.getLatestClassification(event.postId);
    if (!post || !classification) return rejected(recipients, 'EVIDENCE_MISSING');
    return this.send(event.id, recipients, buildEmailMessage(event, post, classification));
  }

  async sendTestEmail(): Promise<DeliveryReceipt> {
    const recipients = this.database.getSettings().emailRecipients;
    return receiptFromOutcomes(await this.send(`test-${randomUUID()}`, recipients, {
      subject: '[Tibo Watch] 测试邮件',
      text: `Tibo Watch 邮件通知配置正常。\n\n发送时间：${new Date().toISOString()}`,
    }));
  }

  private async send(eventId: string, recipients: string[], message: { subject: string; text: string }): Promise<RecipientOutcome[]> {
    const settings = this.database.getSettings();
    const normalized = [...new Set(recipients.map((value) => value.trim().toLowerCase()))];
    let password: string | null;
    try { password = this.getPassword(); } catch { return rejected(normalized, 'EMAIL_NOT_CONFIGURED'); }
    if (!settings.emailEnabled || !password || !normalized.length) return rejected(normalized, 'EMAIL_NOT_CONFIGURED');
    let transporter: Transporter<SMTPTransport.SentMessageInfo> | undefined;
    try {
      const config = emailSettingsSchema.parse({ host: settings.smtpHost, port: settings.smtpPort, secure: settings.smtpSecure, username: settings.smtpUsername, from: settings.smtpFrom, recipients: normalized });
      transporter = this.createTransport({
        host: config.host, port: config.port, secure: config.secure, requireTLS: !config.secure,
        auth: { user: config.username, pass: password },
        connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 20_000,
        logger: false, debug: false,
      });
      // Worker calls with one recipient, giving each durable job a stable identity.
      const messageId = `<tibo-${createHash('sha256').update(`${eventId}:${config.recipients.slice().sort().join(',')}`).digest('hex')}@tibo-watch.local>`;
      const info = await transporter.sendMail({ from: config.from, to: config.recipients, subject: message.subject, text: message.text, messageId });
      const accepted = new Set((info.accepted ?? []).map(normalizeAddress));
      const denied = new Set((info.rejected ?? []).map(normalizeAddress));
      return config.recipients.map((recipient) => ({ recipient, accepted: accepted.has(recipient) && !denied.has(recipient), errorCode: accepted.has(recipient) && !denied.has(recipient) ? null : 'SMTP_RECIPIENT_REJECTED' }));
    } catch (error) {
      return rejected(normalized, safeSmtpError(error));
    } finally {
      try { transporter?.close(); } catch { /* Cleanup cannot erase a server acceptance. */ }
    }
  }
}

function normalizeAddress(value: string | { address: string }): string { return (typeof value === 'string' ? value : value.address).trim().toLowerCase(); }
function rejected(recipients: string[], errorCode: string): RecipientOutcome[] { return recipients.map((recipient) => ({ recipient, accepted: false, errorCode })); }
function safeSmtpError(error: unknown): string {
  const allowed = new Set(['EAUTH', 'ECONNECTION', 'ECONNREFUSED', 'ETIMEDOUT', 'ESOCKET', 'EENVELOPE', 'EMESSAGE', 'EDNS', 'EPROTOCOL']);
  const code = error instanceof Error && 'code' in error ? String(error.code) : '';
  return allowed.has(code) ? code : 'SMTP_SEND_FAILED';
}
function receiptFromOutcomes(outcomes: RecipientOutcome[]): DeliveryReceipt {
  const acceptedRecipients = outcomes.filter((item) => item.accepted).map((item) => item.recipient);
  const rejectedRecipients = outcomes.filter((item) => !item.accepted).map((item) => item.recipient);
  const allAccepted = outcomes.length > 0 && !rejectedRecipients.length;
  return { channel: 'email', state: allAccepted ? 'sent' : acceptedRecipients.length ? 'partial' : 'failed', deliveredAt: acceptedRecipients.length ? new Date().toISOString() : null, errorCode: allAccepted ? null : acceptedRecipients.length ? 'SMTP_PARTIAL_ACCEPTANCE' : outcomes[0]?.errorCode ?? 'EMAIL_NOT_CONFIGURED', acceptedRecipients, rejectedRecipients };
}

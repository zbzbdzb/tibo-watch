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
    const settings = this.database.getSettings();
    const password = this.getPassword();
    const post = this.database.getPost(event.postId);
    const classification = this.database.getLatestClassification(event.postId);
    if (!settings.emailEnabled || !password || !post || !classification) {
      return { channel: this.id, state: 'failed', deliveredAt: null, errorCode: 'EMAIL_NOT_CONFIGURED' };
    }

    try {
      const config = emailSettingsSchema.parse({
        host: settings.smtpHost,
        port: settings.smtpPort,
        secure: settings.smtpSecure,
        username: settings.smtpUsername,
        from: settings.smtpFrom,
        recipients: settings.emailRecipients,
      });
      const transporter = this.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        requireTLS: !config.secure,
        auth: { user: config.username, pass: password },
        connectionTimeout: 15_000,
        greetingTimeout: 15_000,
        socketTimeout: 20_000,
        logger: false,
        debug: false,
      });
      const message = buildEmailMessage(event, post, classification);
      await transporter.sendMail({
        from: config.from,
        to: config.recipients,
        subject: message.subject,
        text: message.text,
      });
      return { channel: this.id, state: 'sent', deliveredAt: new Date().toISOString(), errorCode: null };
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? String(error.code) : 'SMTP_SEND_FAILED';
      return { channel: this.id, state: 'failed', deliveredAt: null, errorCode: code };
    }
  }

  async sendTestEmail(): Promise<DeliveryReceipt> {
    const event: SignalEvent = {
      id: 'test-email',
      postId: 'test-email',
      level: 'preview',
      previousLevel: null,
      isEscalation: false,
      detectedAt: new Date().toISOString(),
    };
    const settings = this.database.getSettings();
    const password = this.getPassword();
    if (!settings.emailEnabled || !password) {
      return { channel: this.id, state: 'failed', deliveredAt: null, errorCode: 'EMAIL_NOT_CONFIGURED' };
    }
    try {
      const config = emailSettingsSchema.parse({
        host: settings.smtpHost,
        port: settings.smtpPort,
        secure: settings.smtpSecure,
        username: settings.smtpUsername,
        from: settings.smtpFrom,
        recipients: settings.emailRecipients,
      });
      const transporter = this.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        requireTLS: !config.secure,
        auth: { user: config.username, pass: password },
      });
      await transporter.sendMail({
        from: config.from,
        to: config.recipients,
        subject: '[Tibo Watch] 测试邮件',
        text: `Tibo Watch 邮件通知配置正常。\n\n发送时间：${event.detectedAt}`,
      });
      return { channel: this.id, state: 'sent', deliveredAt: new Date().toISOString(), errorCode: null };
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? String(error.code) : 'SMTP_TEST_FAILED';
      return { channel: this.id, state: 'failed', deliveredAt: null, errorCode: code };
    }
  }
}

import type { SignalEvent } from '../../shared/domain';
import type { AppDatabase } from '../storage/database';
import type { EmailChannel } from './emailChannel';
import { retryDelayMinutes } from './email';

export class MailRetryWorker {
  constructor(
    private readonly database: AppDatabase,
    private readonly email: EmailChannel,
    private readonly onFinalFailure: (event: SignalEvent) => void | Promise<void>,
  ) {}

  enqueue(event: SignalEvent, attempt = 1): void {
    const delay = retryDelayMinutes(attempt - 1);
    if (delay === null) return;
    this.database.enqueueMail(event.id, attempt, addMinutes(new Date(), delay).toISOString());
  }

  async processDue(now = new Date()): Promise<void> {
    for (const item of this.database.listDueMail(now.toISOString())) {
      const event = this.database.getSignalEvent(item.eventId);
      if (!event) {
        this.database.markMailFinal(item.id);
        continue;
      }
      const receipt = await this.email.deliver(event);
      this.database.recordDelivery(event.id, receipt);
      if (receipt.state === 'sent') {
        this.database.markMailSent(item.id);
        continue;
      }
      const nextDelay = retryDelayMinutes(item.attempt);
      if (nextDelay === null) {
        this.database.markMailFinal(item.id);
        await this.onFinalFailure(event);
      } else {
        this.database.rescheduleMail(
          item.id,
          item.attempt + 1,
          addMinutes(now, nextDelay).toISOString(),
          receipt.errorCode ?? 'SMTP_SEND_FAILED',
        );
      }
    }
  }
}

function addMinutes(value: Date, minutes: number): Date {
  return new Date(value.getTime() + minutes * 60_000);
}

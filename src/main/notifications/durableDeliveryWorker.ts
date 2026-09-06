import type { DeliveryChannel, SignalEvent } from '../../shared/domain';
import type { AppDatabase, DeliveryJob } from '../storage/database';
import type { EmailChannel } from './emailChannel';
import { retryDelayMinutes } from './email';

export interface DurableDeliveryWorkerOptions {
  database: AppDatabase;
  windows?: DeliveryChannel;
  email?: Pick<EmailChannel, 'deliverRecipients'>;
  onChanged?: () => void | Promise<void>;
  onFinalFailure?: (event: SignalEvent) => void | Promise<void>;
}

/** One claim per recipient/channel. SMTP submission is not an inbox delivery guarantee. */
export class DurableDeliveryWorker {
  private active: Promise<void> | null = null;
  private stopped = false;
  constructor(private readonly options: DurableDeliveryWorkerOptions) {}

  processDue(now = new Date()): Promise<void> {
    if (this.stopped) return this.active ?? Promise.resolve();
    if (this.active) return this.active;
    this.active = this.run(now).finally(() => { this.active = null; });
    return this.active;
  }

  async drain(): Promise<void> { await this.active; }
  async stop(): Promise<void> { this.stopped = true; await this.drain(); }

  async retryFailed(now = new Date(), eventId?: string): Promise<void> {
    if (this.active) await this.active;
    if (this.stopped) return;
    this.options.database.retryFailedDeliveryJobs(now.toISOString(), eventId);
    await this.processDue(now);
  }

  private async run(now: Date): Promise<void> {
    const { database } = this.options;
    const due = database.listDueDeliveryJobs(now.toISOString());
    const finalFailures = new Map<string, SignalEvent>();
    // Channels operate independently; email failure/latency does not block Windows.
    await Promise.all((['windows', 'email'] as const).map(async (channel) => {
      for (const job of due.filter((item) => item.channel === channel)) {
        if (this.stopped) break;
        if (!database.claimDeliveryJob(job.id, now.toISOString())) continue;
        const failure = await this.deliverJob(job, now);
        if (failure) finalFailures.set(failure.id, failure);
      }
    }));
    for (const event of finalFailures.values()) {
      try { await this.options.onFinalFailure?.(event); } catch { /* Failure alert is best effort. */ }
    }
    try { await this.options.onChanged?.(); } catch { /* UI failure does not roll back outcomes. */ }
  }

  private async deliverJob(job: DeliveryJob, now: Date): Promise<SignalEvent | undefined> {
    const { database } = this.options;
    const stamp = now.toISOString();
    const invalid = database.deliveryInvalidReason(job, stamp);
    if (invalid) { database.finishDeliveryJob(job.id, 'cancelled', stamp, invalid); return; }
    const event = database.getSignalEvent(job.eventId)!;
    let accepted = false;
    let error = 'DELIVERY_CHANNEL_UNAVAILABLE';
    try {
      if (job.channel === 'windows' && this.options.windows) {
        const receipt = await this.options.windows.deliver(event);
        accepted = receipt.state === 'sent';
        error = receipt.errorCode ?? 'WINDOWS_DELIVERY_FAILED';
      } else if (job.channel === 'email' && this.options.email) {
        const outcomes = await this.options.email.deliverRecipients(event, [job.recipient]);
        const outcome = outcomes.find((item) => item.recipient.toLowerCase() === job.recipient);
        accepted = outcome?.accepted === true;
        error = outcome?.errorCode ?? 'SMTP_RECIPIENT_REJECTED';
      }
    } catch { error = job.channel === 'email' ? 'SMTP_SEND_FAILED' : 'WINDOWS_DELIVERY_FAILED'; }
    if (accepted) { database.finishDeliveryJob(job.id, 'submitted', stamp); return; }
    const delay = retryDelayMinutes(job.attempt);
    if (delay !== null) database.finishDeliveryJob(job.id, 'pending', stamp, error, new Date(now.getTime() + delay * 60_000).toISOString());
    else {
      database.finishDeliveryJob(job.id, 'failed', stamp, error);
      return event;
    }
  }
}

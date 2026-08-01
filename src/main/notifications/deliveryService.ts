import type { DeliveryChannel, DeliveryReceipt, SignalEvent } from '../../shared/domain';

export interface DeliveryServiceOptions {
  channels: DeliveryChannel[];
  enqueueRetry: (event: SignalEvent, attempt: number) => void | Promise<void>;
}

export class DeliveryService {
  private readonly channels: DeliveryChannel[];
  private readonly enqueueRetry: DeliveryServiceOptions['enqueueRetry'];

  constructor(options: DeliveryServiceOptions) {
    this.channels = options.channels;
    this.enqueueRetry = options.enqueueRetry;
  }

  async deliver(event: SignalEvent): Promise<DeliveryReceipt[]> {
    const channels = event.level === 'related'
      ? this.channels.filter((channel) => channel.id === 'windows')
      : this.channels;
    const receipts = await Promise.all(
      channels.map(async (channel): Promise<DeliveryReceipt> => {
        try {
          return await channel.deliver(event);
        } catch {
          return {
            channel: channel.id,
            state: 'failed',
            deliveredAt: null,
            errorCode: `${channel.id.toUpperCase()}_DELIVERY_FAILED`,
          };
        }
      }),
    );

    return Promise.all(
      receipts.map(async (receipt): Promise<DeliveryReceipt> => {
        if (receipt.channel !== 'email' || receipt.state !== 'failed') return receipt;
        await this.enqueueRetry(event, 1);
        return { ...receipt, state: 'queued' };
      }),
    );
  }
}

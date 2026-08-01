import { describe, expect, it, vi } from 'vitest';

import { DeliveryService } from '../../src/main/notifications/deliveryService';
import type { DeliveryChannel, SignalEvent } from '../../src/shared/domain';

const event: SignalEvent = {
  id: 'event-500',
  postId: '500',
  level: 'confirmed',
  previousLevel: null,
  isEscalation: false,
  detectedAt: '2026-07-31T05:00:00.000Z',
};

function channel(id: DeliveryChannel['id'], state: 'sent' | 'failed'): DeliveryChannel {
  return {
    id,
    deliver: vi.fn(async () => ({
      channel: id,
      state,
      deliveredAt: state === 'sent' ? '2026-07-31T05:00:01.000Z' : null,
      errorCode: state === 'failed' ? 'SMTP_CONNECT_FAILED' : null,
    })),
  };
}

describe('DeliveryService', () => {
  it('delivers Windows notifications even when email fails and queues email retry', async () => {
    const windows = channel('windows', 'sent');
    const email = channel('email', 'failed');
    const enqueueRetry = vi.fn();
    const service = new DeliveryService({ channels: [windows, email], enqueueRetry });

    const receipts = await service.deliver(event);

    expect(receipts.map((receipt) => receipt.state)).toEqual(['sent', 'queued']);
    expect(windows.deliver).toHaveBeenCalledWith(event);
    expect(enqueueRetry).toHaveBeenCalledWith(event, 1);
  });

  it('sends related signals only through the Windows channel', async () => {
    const related = { ...event, level: 'related' as const };
    const windows = channel('windows', 'sent');
    const email = channel('email', 'sent');
    const service = new DeliveryService({ channels: [windows, email], enqueueRetry: vi.fn() });
    await service.deliver(related);
    expect(windows.deliver).toHaveBeenCalled();
    expect(email.deliver).not.toHaveBeenCalled();
  });
});

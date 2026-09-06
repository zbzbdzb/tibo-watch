import { deliveryLabel, deliveryTone, latestDelivery } from '../../src/renderer/deliveryStatus';
import type { DeliveryStatusView } from '../../src/shared/api';

const status: DeliveryStatusView = {
  eventId: 'e', postId: 'p', channel: 'email', state: 'partial', acceptedRecipientCount: 1,
  failedRecipientCount: 1, pendingRecipientCount: 0, lastError: 'SMTP_REJECTED',
  createdAt: '2026-09-05T00:00:00Z', updatedAt: '2026-09-05T00:00:00Z', nextAttemptAt: null, uncertain: false,
};
it('never reports a baseline or missing delivery as sent', () => {
  expect(deliveryLabel()).toContain('无发送记录');
  expect(deliveryTone()).toBe('status-disabled');
});
it('shows partial acceptance and uncertainty rather than inbox delivery', () => {
  expect(deliveryLabel(status)).toContain('已接受 1 / 待发送 0 / 失败 1');
  expect(deliveryTone(status)).toBe('status-error');
  expect(deliveryLabel({ ...status, state: 'submitted', uncertain: true })).toContain('结果不确定');
  expect(deliveryLabel({ ...status, state: 'submitted' })).toContain('SMTP 已接受');
});
it('selects status for the exact post and channel', () => {
  expect(latestDelivery([status], 'email', 'different')).toBeUndefined();
  expect(latestDelivery([status], 'windows', 'p')).toBeUndefined();
  expect(latestDelivery([status], 'email', 'p')).toBe(status);
});

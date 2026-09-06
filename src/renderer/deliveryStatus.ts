import type { DeliveryStatusView } from '../shared/api';

export function deliveryLabel(status?: DeliveryStatusView): string {
  if (!status) return '无发送记录（历史基线或未触发提醒）';
  const labels: Record<DeliveryStatusView['state'], string> = {
    pending: '等待发送', sending: '发送中', submitted: status.channel === 'email' ? 'SMTP 已接受' : '已提交系统通知',
    partial: '部分收件人发送失败', failed: '发送失败', cancelled: '已取消发送', 'not-sent': '未发送',
  };
  const counts = status.channel === 'email'
    ? status.acceptedRecipientCount + status.pendingRecipientCount + status.failedRecipientCount > 0
      ? ` · 已接受 ${status.acceptedRecipientCount} / 待发送 ${status.pendingRecipientCount} / 失败 ${status.failedRecipientCount}`
      : ['submitted', 'failed'].includes(status.state) ? ' · 旧版记录（无逐收件人明细）' : ''
    : '';
  return `${labels[status.state]}${counts}${status.uncertain ? ' · 上次发送结果不确定' : ''}`;
}

export function deliveryTone(status?: DeliveryStatusView): string {
  if (!status || ['cancelled', 'not-sent'].includes(status.state)) return 'status-disabled';
  if (status.uncertain || ['failed', 'partial'].includes(status.state)) return 'status-error';
  return status.state === 'submitted' ? '' : 'status-pending';
}

export function latestDelivery(items: DeliveryStatusView[], channel: 'windows' | 'email', postId?: string) {
  return items.filter((item) => item.channel === channel && (!postId || item.postId === postId))
    .reduce<DeliveryStatusView | undefined>((latest, item) => !latest || item.createdAt > latest.createdAt ? item : latest, undefined);
}

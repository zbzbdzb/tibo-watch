import { Notification } from 'electron';

import type { DeliveryChannel, DeliveryReceipt, SignalEvent } from '../../shared/domain';
import { windowsNotificationPreferences, type AppDatabase } from '../storage/database';

export class WindowsChannel implements DeliveryChannel {
  readonly id = 'windows' as const;

  constructor(
    private readonly database: AppDatabase,
    private readonly onClick: (postId: string) => void,
  ) {}

  async deliver(event: SignalEvent): Promise<DeliveryReceipt> {
    const preferences = windowsNotificationPreferences(this.database.getSettings(), event.level);
    if (!preferences.enabled) {
      return { channel: this.id, state: 'failed', deliveredAt: null, errorCode: 'WINDOWS_NOTIFICATION_DISABLED' };
    }
    if (!Notification.isSupported()) {
      return { channel: this.id, state: 'failed', deliveredAt: null, errorCode: 'WINDOWS_NOTIFICATION_UNAVAILABLE' };
    }
    const post = this.database.getEventSnapshot(event.id)?.post ?? this.database.getPost(event.postId);
    const title = event.level === 'confirmed'
      ? 'Codex 重置已确认'
      : event.level === 'preview'
        ? '可能即将重置 Codex'
        : 'Tibo 发布了 Codex 相关动态';
    const notification = new Notification({
      title,
      body: post?.text ?? '打开 Tibo Watch 查看详情。',
      silent: !preferences.sound,
      urgency: event.level === 'related' ? 'normal' : 'critical',
      timeoutType: event.level === 'related' ? 'default' : 'never',
    });
    notification.on('click', () => this.onClick(event.postId));
    notification.show();
    return { channel: this.id, state: 'sent', deliveredAt: new Date().toISOString(), errorCode: null };
  }
}

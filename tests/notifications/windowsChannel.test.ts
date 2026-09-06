import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AppDatabase } from '../../src/main/storage/database';
import { WindowsChannel } from '../../src/main/notifications/windowsChannel';
import type { SignalEvent } from '../../src/shared/domain';

const notification = vi.hoisted(() => ({ options: vi.fn(), show: vi.fn(), on: vi.fn(), isSupported: vi.fn(() => true) }));
vi.mock('electron', () => ({
  Notification: class {
    static isSupported = notification.isSupported;
    constructor(options: unknown) { notification.options(options); }
    on = notification.on;
    show = notification.show;
  },
}));

const keys = {
  confirmed: { enabled: 'windowsConfirmedEnabled', sound: 'windowsConfirmedSound', defaultSound: true },
  preview: { enabled: 'windowsPreviewEnabled', sound: 'windowsPreviewSound', defaultSound: true },
  related: { enabled: 'windowsRelatedEnabled', sound: 'windowsRelatedSound', defaultSound: false },
} as const;
const event = (level: SignalEvent['level']): SignalEvent => ({ id: 'event', postId: '1', level, previousLevel: null, isEscalation: false, detectedAt: '2026-09-05T10:00:00.000Z' });

describe('Windows notification controls', () => {
  beforeEach(() => { vi.clearAllMocks(); notification.isSupported.mockReturnValue(true); });

  it.each(['confirmed', 'preview', 'related'] as const)('honors default and explicit sound settings for %s independently of email settings', async (level) => {
    const database = new AppDatabase(':memory:');
    try {
      database.updateSettings({ emailEnabled: false });
      const channel = new WindowsChannel(database, vi.fn());
      expect(await channel.deliver(event(level))).toMatchObject({ state: 'sent' });
      expect(notification.options).toHaveBeenLastCalledWith(expect.objectContaining({ silent: !keys[level].defaultSound }));
      for (const sound of [true, false]) {
        database.updateSettings({ [keys[level].sound]: sound });
        await channel.deliver(event(level));
        expect(notification.options).toHaveBeenLastCalledWith(expect.objectContaining({ silent: !sound }));
      }
      expect(notification.show).toHaveBeenCalledTimes(3);
    } finally { database.close(); }
  });

  it.each(['confirmed', 'preview', 'related'] as const)('does not construct or show a directly requested disabled %s notification', async (level) => {
    const database = new AppDatabase(':memory:');
    try {
      database.updateSettings({ [keys[level].enabled]: false, emailEnabled: true });
      const receipt = await new WindowsChannel(database, vi.fn()).deliver(event(level));
      expect(receipt).toEqual({ channel: 'windows', state: 'failed', deliveredAt: null, errorCode: 'WINDOWS_NOTIFICATION_DISABLED' });
      expect(notification.options).not.toHaveBeenCalled();
      expect(notification.show).not.toHaveBeenCalled();
    } finally { database.close(); }
  });
});

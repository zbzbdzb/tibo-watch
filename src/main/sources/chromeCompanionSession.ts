import type { MonitoredPost } from '../../shared/domain';
import type { XBrowserAdapter } from './xBrowserSource';
import { ChromeCompanionStore, type ChromeCollectionStatus } from './chromeCompanionBridge';

export { ChromeCompanionStore } from './chromeCompanionBridge';

export class ChromeCompanionSession implements XBrowserAdapter {
  constructor(
    private readonly store: Pick<ChromeCompanionStore, 'isConnected' | 'readPosts' | 'clear'> &
      Partial<Pick<ChromeCompanionStore, 'collectionStatus' | 'setMonitoringEnabled'>>,
    private readonly showSetup: () => void,
    private readonly revokeCollection: () => void = () => undefined,
  ) {}

  async isLoggedIn(): Promise<boolean> {
    return this.store.isConnected();
  }

  async readPosts(signal: AbortSignal): Promise<MonitoredPost[]> {
    if (signal.aborted) throw new Error('Chrome companion check aborted');
    return this.store.readPosts();
  }

  collectionStatus(): ChromeCollectionStatus {
    return this.store.collectionStatus?.() ?? {
      state: this.store.isConnected() ? 'online' : 'needs_login',
      errorCode: this.store.isConnected() ? null : 'X_SESSION_EXPIRED',
    };
  }

  openLogin(): void {
    this.showSetup();
  }

  async logout(): Promise<void> {
    this.revokeCollection();
    this.store.setMonitoringEnabled?.(false);
    this.store.clear();
  }
}

import { BrowserWindow, session } from 'electron';

import type { MonitoredPost } from '../../shared/domain';
import type { XBrowserAdapter } from './xBrowserSource';
import { X_DOM_SELECTORS } from './xDomParser';

const PARTITION = 'persist:x-monitor';
const ALLOWED_HOSTS = ['x.com', 'twitter.com'];

export class ElectronXSession implements XBrowserAdapter {
  private loginWindow: BrowserWindow | null = null;

  async isLoggedIn(): Promise<boolean> {
    const cookies = await session.fromPartition(PARTITION).cookies.get({ name: 'auth_token' });
    return cookies.length > 0;
  }

  openLogin(): void {
    if (this.loginWindow && !this.loginWindow.isDestroyed()) {
      this.loginWindow.show();
      this.loginWindow.focus();
      return;
    }
    this.loginWindow = this.createRestrictedWindow({ width: 1050, height: 780, show: true });
    this.loginWindow.setTitle('登录 X · Tibo Watch 隔离会话');
    this.loginWindow.on('closed', () => { this.loginWindow = null; });
    void this.loginWindow.loadURL('https://x.com/i/flow/login');
  }

  async logout(): Promise<void> {
    await session.fromPartition(PARTITION).clearStorageData();
    this.loginWindow?.close();
  }

  async readPosts(signal: AbortSignal): Promise<MonitoredPost[]> {
    const window = this.createRestrictedWindow({ width: 1080, height: 800, show: false });
    const abort = () => window.destroy();
    signal.addEventListener('abort', abort, { once: true });
    try {
      await window.loadURL('https://x.com/thsottiaux/with_replies');
      await waitForTimeline(window, signal);
      return await window.webContents.executeJavaScript(buildExtractionScript(), true) as MonitoredPost[];
    } finally {
      signal.removeEventListener('abort', abort);
      if (!window.isDestroyed()) window.destroy();
    }
  }

  private createRestrictedWindow(options: { width: number; height: number; show: boolean }): BrowserWindow {
    const window = new BrowserWindow({
      ...options,
      backgroundColor: '#070b0e',
      webPreferences: {
        partition: PARTITION,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        backgroundThrottling: false,
      },
    });
    const isolatedSession = window.webContents.session;
    isolatedSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    window.webContents.on('will-navigate', (event, url) => {
      if (!isAllowedXUrl(url)) event.preventDefault();
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    return window;
  }
}

function isAllowedXUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ALLOWED_HOSTS.some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
    );
  } catch {
    return false;
  }
}

async function waitForTimeline(window: BrowserWindow, signal: AbortSignal): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15_000) {
    if (signal.aborted || window.isDestroyed()) throw new Error('X timeline check aborted');
    const found = await window.webContents.executeJavaScript(
      `Boolean(document.querySelector(${JSON.stringify(X_DOM_SELECTORS.tweet)}))`,
      true,
    ) as boolean;
    if (found) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('X timeline did not load in time');
}

function buildExtractionScript(): string {
  const selectors = JSON.stringify(X_DOM_SELECTORS);
  return `(() => {
    const s = ${selectors};
    const handle = 'thsottiaux';
    const clean = (node) => node?.textContent?.trim() || '';
    return [...document.querySelectorAll(s.tweet)].flatMap((article) => {
      const links = [...article.querySelectorAll(s.statusLink)];
      const permalink = links.find((link) => new RegExp('/' + handle + '/status/\\\\d+', 'i').test(link.getAttribute('href') || ''));
      const match = permalink?.getAttribute('href')?.match(/\\/([^/]+)\\/status\\/(\\d+)/i);
      if (!match || match[1].toLowerCase() !== handle) return [];
      if (clean(article.querySelector(s.socialContext)).toLowerCase().includes('repost')) return [];
      const textNodes = [...article.querySelectorAll(s.tweetText)];
      const primary = textNodes.find((node) => !node.closest(s.quoteTweet));
      const quote = article.querySelector(s.quoteTweet + ' ' + s.tweetText);
      const createdAt = permalink?.querySelector('time')?.getAttribute('datetime');
      if (!primary || !createdAt) return [];
      const kind = article.querySelector(s.reply) || /Replying to/i.test(article.textContent || '') ? 'reply' : quote ? 'quote' : 'original';
      return [{ id: match[2], authorHandle: match[1], text: clean(primary), createdAt,
        url: 'https://x.com/' + match[1] + '/status/' + match[2], kind,
        quotedText: quote ? clean(quote) : null, sourceIds: ['x-browser'] }];
    });
  })()`;
}

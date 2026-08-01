import { join } from 'node:path';

import {
  app, BrowserWindow, ipcMain, Menu, nativeImage, safeStorage, shell, Tray,
  type IpcMainInvokeEvent,
} from 'electron';
import { z } from 'zod';

import type { AppSnapshot, RendererSettings, SettingsUpdate } from '../shared/api';
import type { PostSource } from '../shared/domain';
import { RuleClassifier } from './classifier/ruleClassifier';
import { MonitorCoordinator } from './monitoring/monitorCoordinator';
import { DeliveryService } from './notifications/deliveryService';
import { EmailChannel } from './notifications/emailChannel';
import { MailRetryWorker } from './notifications/retryWorker';
import { WindowsChannel } from './notifications/windowsChannel';
import { CredentialStore } from './security/credentialStore';
import { ConfiguredSource } from './sources/configuredRssSource';
import { ElectronXSession } from './sources/electronXSession';
import { PublicRssSource } from './sources/publicRssSource';
import { XBrowserSource } from './sources/xBrowserSource';
import { AppDatabase, type AppSettings } from './storage/database';

app.setAppUserModelId('com.tibowatch.desktop');
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

const settingsUpdateSchema = z.object({
  pollIntervalMinutes: z.number().int().min(1).max(60).optional(),
  browserSourceEnabled: z.boolean().optional(),
  publicRssEnabled: z.boolean().optional(),
  startAtLogin: z.boolean().optional(),
  closeToTray: z.boolean().optional(),
  baselineComplete: z.boolean().optional(),
  onboardingComplete: z.boolean().optional(),
  emailEnabled: z.boolean().optional(),
  emailRecipients: z.array(z.string()).optional(),
  smtpHost: z.string().max(255).optional(),
  smtpPort: z.number().int().min(1).max(65_535).optional(),
  smtpSecure: z.boolean().optional(),
  smtpUsername: z.string().max(255).optional(),
  smtpFrom: z.string().max(255).optional(),
  smtpPassword: z.string().max(2048).optional(),
}).strict();

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let database: AppDatabase;
let credentials: CredentialStore;
let xSession: ElectronXSession;
let coordinator: MonitorCoordinator;
let emailChannel: EmailChannel;
let retryWorker: MailRetryWorker;
let scheduleTimer: NodeJS.Timeout | null = null;
let retryTimer: NodeJS.Timeout | null = null;
let paused = false;
let checking = false;
let quitting = false;
let lastCheckedAt: string | null = null;
let nextCheckAt: string | null = null;

app.on('second-instance', () => showMainWindow());

app.whenReady().then(async () => {
  database = new AppDatabase(join(app.getPath('userData'), 'tibo-watch.sqlite3'));
  credentials = new CredentialStore(database, safeStorage);
  xSession = new ElectronXSession();
  emailChannel = new EmailChannel({ database, getPassword: () => credentials.getSmtpPassword() });
  const windowsChannel = new WindowsChannel(database, (postId) => showMainWindow(postId));
  retryWorker = new MailRetryWorker(database, emailChannel, (event) => {
    new WindowsChannel(database, () => showMainWindow(event.postId)).deliver({ ...event, level: 'related' });
    tray?.displayBalloon({ title: 'Tibo Watch 邮件发送失败', content: '三次重试均失败，请打开通知记录手动检查 SMTP 配置。' });
  });
  const rssSource: PostSource = process.env.TIBO_WATCH_E2E === '1'
    ? createE2eSource()
    : new PublicRssSource();
  const rss = new ConfiguredSource(rssSource, () => database.getSettings().publicRssEnabled);
  const browser = new XBrowserSource(xSession, () => database.getSettings().browserSourceEnabled);
  coordinator = new MonitorCoordinator({
    database,
    sources: [browser, rss],
    classifier: new RuleClassifier(),
    onSignal: async (event) => {
      const channels = database.getSettings().emailEnabled
        ? [windowsChannel, emailChannel]
        : [windowsChannel];
      const service = new DeliveryService({
        channels,
        enqueueRetry: (failedEvent, attempt) => retryWorker.enqueue(failedEvent, attempt),
      });
      const receipts = await service.deliver(event);
      for (const receipt of receipts) database.recordDelivery(event.id, receipt);
      await broadcastSnapshot();
    },
    onOutage: () => {
      tray?.displayBalloon({ title: 'Tibo Watch 监测中断', content: 'X 登录抓取和公共 RSS 已连续三个周期无成功数据。' });
    },
  });

  createMainWindow();
  createTray();
  registerIpc();
  applyLoginItem(database.getSettings());
  restartSchedule();
  if (process.env.TIBO_WATCH_E2E !== '1') {
    retryTimer = setInterval(() => void retryWorker.processDue(), 60_000);
  }
  await broadcastSnapshot();
});

app.on('activate', () => showMainWindow());
app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { if (process.platform !== 'win32') app.quit(); });
app.on('will-quit', () => {
  if (scheduleTimer) clearInterval(scheduleTimer);
  if (retryTimer) clearInterval(retryTimer);
  database?.close();
});

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 720,
    frame: false,
    show: false,
    backgroundColor: '#070b0e',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = process.env.VITE_DEV_SERVER_URL ?? `file://${join(__dirname, '../renderer/index.html')}`;
    if (!url.startsWith(allowed)) event.preventDefault();
  });
  mainWindow.on('close', (event) => {
    if (!quitting && database.getSettings().closeToTray) {
      event.preventDefault();
      mainWindow?.hide();
    } else if (!quitting) {
      quitting = true;
      app.quit();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.once('ready-to-show', () => {
    if (!app.getLoginItemSettings().wasOpenedAtLogin) mainWindow?.show();
  });
  const rendererUrl = process.env.VITE_DEV_SERVER_URL;
  if (rendererUrl) void mainWindow.loadURL(rendererUrl);
  else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
}

function createTray(): void {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="7" fill="#0a0f13"/><circle cx="16" cy="16" r="10" fill="none" stroke="#75df4b" stroke-width="3"/><path d="m11 16 3 3 7-8" fill="none" stroke="#75df4b" stroke-width="3"/></svg>';
  const icon = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('Tibo Watch · Codex 重置监测');
  tray.on('click', () => showMainWindow());
  rebuildTrayMenu();
}

function rebuildTrayMenu(): void {
  tray?.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 Tibo Watch', click: () => showMainWindow() },
    { label: '立即检查', enabled: !checking, click: () => void runCheck() },
    { label: paused ? '恢复监测' : '暂停监测', click: () => { paused = !paused; restartSchedule(); rebuildTrayMenu(); void broadcastSnapshot(); } },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit(); } },
  ]));
}

function registerIpc(): void {
  handle('app:get-snapshot', z.tuple([]), () => snapshot());
  handle('app:update-settings', z.tuple([settingsUpdateSchema]), async ([rawUpdate]) => {
    const { smtpPassword, ...update } = rawUpdate as SettingsUpdate;
    if (smtpPassword) credentials.setSmtpPassword(smtpPassword);
    database.updateSettings(update as Partial<AppSettings>);
    applyLoginItem(database.getSettings());
    restartSchedule();
    return snapshot();
  });
  handle('app:check-now', z.tuple([]), async () => { await runCheck(); return snapshot(); });
  handle('app:set-paused', z.tuple([z.boolean()]), async ([value]) => { paused = value; restartSchedule(); rebuildTrayMenu(); return snapshot(); });
  handle('app:open-x-login', z.tuple([]), async () => { xSession.openLogin(); return snapshot(); });
  handle('app:logout-x', z.tuple([]), async () => { await xSession.logout(); return snapshot(); });
  handle('app:test-email', z.tuple([]), async () => {
    const receipt = await emailChannel.sendTestEmail();
    return { ok: receipt.state === 'sent', errorCode: receipt.errorCode };
  });
  handle('app:open-post', z.tuple([z.url().refine(isAllowedPostUrl)]), async ([url]) => { await shell.openExternal(url); });
  handle('app:complete-onboarding', z.tuple([]), async () => {
    database.updateSettings({ onboardingComplete: true });
    await runCheck();
    return snapshot();
  });
  handle('app:retry-mail', z.tuple([z.string().min(1).max(128)]), async ([id]) => {
    const item = database.listMailQueue().find((candidate) => candidate.id === id);
    const event = item ? database.getSignalEvent(item.eventId) : undefined;
    if (!item || !event) throw new Error('Mail queue item was not found');
    const receipt = await emailChannel.deliver(event);
    database.recordDelivery(event.id, receipt);
    if (receipt.state === 'sent') database.markMailSent(item.id);
    else {
      database.rescheduleMail(
        item.id,
        1,
        new Date(Date.now() + 60_000).toISOString(),
        receipt.errorCode ?? 'SMTP_SEND_FAILED',
      );
    }
    return snapshot();
  });
  handle('window:action', z.tuple([z.enum(['minimize', 'maximize', 'close'])]), ([action]) => {
    if (action === 'minimize') mainWindow?.minimize();
    else if (action === 'maximize') {
      if (mainWindow?.isMaximized()) mainWindow.unmaximize();
      else mainWindow?.maximize();
    }
    else mainWindow?.close();
  });
}

function handle<T extends z.ZodTuple, R>(
  channel: string,
  schema: T,
  handler: (args: z.infer<T>, event: IpcMainInvokeEvent) => R | Promise<R>,
): void {
  ipcMain.handle(channel, async (event, ...args: unknown[]) => {
    assertTrustedSender(event);
    return handler(schema.parse(args), event);
  });
}

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error('Untrusted IPC sender');
}

async function runCheck(): Promise<void> {
  if (paused || checking) return;
  checking = true;
  rebuildTrayMenu();
  await broadcastSnapshot();
  try {
    lastCheckedAt = new Date().toISOString();
    await coordinator.checkNow(lastCheckedAt);
    nextCheckAt = new Date(Date.now() + database.getSettings().pollIntervalMinutes * 60_000).toISOString();
  } finally {
    checking = false;
    rebuildTrayMenu();
    await broadcastSnapshot();
  }
}

function restartSchedule(): void {
  if (scheduleTimer) clearInterval(scheduleTimer);
  scheduleTimer = null;
  if (paused) { nextCheckAt = null; return; }
  const interval = database.getSettings().pollIntervalMinutes * 60_000;
  nextCheckAt = new Date(Date.now() + interval).toISOString();
  if (process.env.TIBO_WATCH_E2E !== '1') {
    scheduleTimer = setInterval(() => void runCheck(), interval);
  }
}

async function snapshot(): Promise<AppSnapshot> {
  const settings = database.getSettings();
  const rendererSettings: RendererSettings = {
    ...settings,
    hasSmtpPassword: database.getEncryptedSecret('smtp-password') !== null,
  };
  return {
    settings: rendererSettings,
    posts: database.listPosts().map((post) => ({ post, classification: database.getLatestClassification(post.id) ?? null })),
    events: database.listSignalEvents(),
    sourceHealth: coordinator.health.list().map((health) => ({
      ...health,
      label: health.sourceId === 'x-browser' ? 'X 登录抓取' : '公共 RSS',
    })),
    mailQueue: database.listMailQueue(),
    paused,
    checking,
    xLoggedIn: await xSession.isLoggedIn(),
    lastCheckedAt,
    nextCheckAt,
    version: app.getVersion(),
  };
}

async function broadcastSnapshot(): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('app:snapshot', await snapshot());
}

function showMainWindow(postId?: string): void {
  if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
  mainWindow?.show();
  mainWindow?.restore();
  mainWindow?.focus();
  if (postId) mainWindow?.webContents.send('app:navigate-post', postId);
}

function applyLoginItem(settings: AppSettings): void {
  if (process.env.TIBO_WATCH_E2E === '1') return;
  app.setLoginItemSettings({ openAtLogin: settings.startAtLogin, openAsHidden: true });
}

function isAllowedPostUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['x.com', 'twitter.com'].includes(url.hostname) && /^\/thsottiaux\/status\/\d+/.test(url.pathname);
  } catch {
    return false;
  }
}

function createE2eSource(): PostSource {
  return {
    id: 'public-rss',
    check: async ({ checkedAt }) => ({
      sourceId: 'public-rss',
      checkedAt,
      state: 'online',
      latencyMs: 4,
      errorCode: null,
      posts: [
        {
          id: 'e2e-confirmed',
          authorHandle: 'thsottiaux',
          text: "I've reset usage limits for all ChatGPT Work and Codex users.",
          createdAt: '2026-07-31T04:53:19.000Z',
          url: 'https://x.com/thsottiaux/status/2083053369351090254',
          kind: 'original',
          quotedText: null,
          sourceIds: ['public-rss'],
        },
        {
          id: 'e2e-preview',
          authorHandle: 'thsottiaux',
          text: 'Codex resets will continue tomorrow.',
          createdAt: '2026-07-31T04:50:00.000Z',
          url: 'https://x.com/thsottiaux/status/2083053000000000000',
          kind: 'original',
          quotedText: null,
          sourceIds: ['public-rss'],
        },
      ],
    }),
  };
}

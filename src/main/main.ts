import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import {
  app, BrowserWindow, ipcMain, Menu, nativeImage, Notification, safeStorage, shell, Tray,
  type IpcMainInvokeEvent,
} from 'electron';
import { z } from 'zod';

import type { AppSnapshot, RendererSettings, SettingsUpdate } from '../shared/api';
import type { PostSource } from '../shared/domain';
import { RuleClassifier } from './classifier/ruleClassifier';
import { MonitorCoordinator } from './monitoring/monitorCoordinator';
import { DurableDeliveryWorker } from './notifications/durableDeliveryWorker';
import { EmailChannel } from './notifications/emailChannel';
import { WindowsChannel } from './notifications/windowsChannel';
import { CredentialStore } from './security/credentialStore';
import { ChromeCompanionBridge } from './sources/chromeCompanionBridge';
import { ChromeCompanionSession } from './sources/chromeCompanionSession';
import { ConfiguredSource } from './sources/configuredRssSource';
import { PublicRssSource } from './sources/publicRssSource';
import { XBrowserSource } from './sources/xBrowserSource';
import {
  buildLoginItemSettings,
  buildStartupShortcutDetails,
  isHiddenStartup,
  shouldShowForSecondInstance,
  startupShortcutWriteOperation,
} from './startup';
import { AppDatabase, type AppSettings } from './storage/database';

app.setAppUserModelId('com.tibowatch.desktop');
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
const startHidden = isHiddenStartup(process.argv);

const settingsUpdateSchema = z.object({
  pollIntervalMinutes: z.number().int().min(1).max(60).optional(),
  browserSourceEnabled: z.boolean().optional(),
  publicRssEnabled: z.boolean().optional(),
  startAtLogin: z.boolean().optional(),
  closeToTray: z.boolean().optional(),
  windowsConfirmedEnabled: z.boolean().optional(),
  windowsPreviewEnabled: z.boolean().optional(),
  windowsRelatedEnabled: z.boolean().optional(),
  windowsConfirmedSound: z.boolean().optional(),
  windowsPreviewSound: z.boolean().optional(),
  windowsRelatedSound: z.boolean().optional(),
  baselineComplete: z.boolean().optional(),
  onboardingComplete: z.boolean().optional(),
  emailEnabled: z.boolean().optional(),
  emailRecipients: z.array(z.email()).max(50).optional(),
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
let chromeCompanionBridge: ChromeCompanionBridge;
let xSession: ChromeCompanionSession;
let coordinator: MonitorCoordinator;
let emailChannel: EmailChannel;
let deliveryWorker: DurableDeliveryWorker;
let deliveryReady = false;
let scheduleTimer: NodeJS.Timeout | null = null;
let retryTimer: NodeJS.Timeout | null = null;
let paused = false;
let checking = false;
let quitting = false;
let lastCheckedAt: string | null = null;
let nextCheckAt: string | null = null;
let lastCheckError: string | null = null;
let runningCheck: Promise<void> | null = null;
let shutdownReady = false;
let shutdownStarted = false;
let lastChromeDiagnostic = '';

app.on('second-instance', (_event, commandLine) => {
  if (shouldShowForSecondInstance(commandLine)) showMainWindow();
});

app.whenReady().then(async () => {
  database = new AppDatabase(join(app.getPath('userData'), 'tibo-watch.sqlite3'));
  credentials = new CredentialStore(database, safeStorage);
  chromeCompanionBridge = new ChromeCompanionBridge({
    ...(process.env.TIBO_WATCH_E2E === '1' ? { port: 0 } : {}),
    onCollectionChanged: () => {
      // Opt-in local diagnostics contain only collection state/counts, never
      // page text, account details, SMTP settings or authentication material.
      if (process.env.TIBO_WATCH_DIAGNOSTICS === '1') {
        const status = { ...chromeCompanionBridge.store.collectionStatus(), pages: chromeCompanionBridge.store.diagnostics() };
        const signature = JSON.stringify(status);
        if (signature !== lastChromeDiagnostic) {
          lastChromeDiagnostic = signature;
          console.info(JSON.stringify({ diagnostic: 'chrome-collection', at: new Date().toISOString(),
            ...status, postCount: chromeCompanionBridge.readPosts().length }));
        }
      }
      if (coordinator && mainWindow && !quitting) void broadcastSnapshot().catch(() => {});
    },
  });
  syncCollectionEnabled();
  try {
    await chromeCompanionBridge.start();
  } catch (error) {
    console.error('Chrome companion bridge failed to start', error);
  }
  xSession = new ChromeCompanionSession(
    chromeCompanionBridge.store,
    showChromeCompanionSetup,
    () => chromeCompanionBridge.setMonitoringEnabled(false),
  );
  emailChannel = new EmailChannel({ database, getPassword: () => credentials.getSmtpPassword() });
  const windowsChannel = new WindowsChannel(database, (postId) => showMainWindow(postId));
  deliveryWorker = new DurableDeliveryWorker({
    database, windows: windowsChannel, email: emailChannel,
    onChanged: () => broadcastSnapshot(),
    onFinalFailure: () => {
      tray?.displayBalloon({ title: 'Tibo Watch 通知发送失败', content: '重试失败，请打开通知记录查看失败收件人与配置。' });
    },
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
    onSignal: async () => { if (deliveryReady) await deliveryWorker.processDue(); },
    onOutage: () => {
      tray?.displayBalloon({ title: 'Tibo Watch 监测中断', content: 'Chrome 登录共享和公共 RSS 已连续三个周期无成功数据。' });
    },
  });

  createMainWindow();
  createTray();
  registerIpc();
  await coordinator.reclassifyStoredPosts();
  deliveryReady = true;
  await deliveryWorker.processDue();
  applyLoginItem(database.getSettings());
  restartSchedule();
  if (process.env.TIBO_WATCH_E2E !== '1') {
    retryTimer = setInterval(() => void deliveryWorker.processDue().catch(() => {
      lastCheckError = 'DELIVERY_WORKER_FAILED';
    }).finally(() => broadcastSnapshot()).catch(() => {}), 60_000);
  }
  await broadcastSnapshot();
});

app.on('activate', () => showMainWindow());
app.on('before-quit', (event) => {
  if (shutdownReady) return;
  event.preventDefault();
  if (shutdownStarted) return;
  shutdownStarted = true;
  quitting = true;
  chromeCompanionBridge?.setMonitoringEnabled(false);
  if (scheduleTimer) clearTimeout(scheduleTimer);
  if (retryTimer) clearInterval(retryTimer);
  void Promise.allSettled([runningCheck, deliveryWorker?.stop(), chromeCompanionBridge?.stop()]).then(() => {
    shutdownReady = true;
    app.quit();
  });
});
app.on('window-all-closed', () => { if (process.platform !== 'win32') app.quit(); });
app.on('will-quit', () => {
  if (scheduleTimer) clearInterval(scheduleTimer);
  if (retryTimer) clearInterval(retryTimer);
  void chromeCompanionBridge?.stop();
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
    if (!startHidden) mainWindow?.show();
  });
  const rendererUrl = process.env.VITE_DEV_SERVER_URL;
  if (rendererUrl) void mainWindow.loadURL(rendererUrl);
  else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
}

function createTray(): void {
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'tray-icon.png')
    : join(app.getAppPath(), 'build', 'icon.png');
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
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
  handle('app:open-x-login', z.tuple([]), async () => {
    database.updateSettings({ browserSourceEnabled: true });
    syncCollectionEnabled();
    xSession.openLogin();
    return snapshot();
  });
  handle('app:logout-x', z.tuple([]), async () => {
    database.updateSettings({ browserSourceEnabled: false });
    syncCollectionEnabled();
    await xSession.logout();
    return snapshot();
  });
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
    const eventId = database.getSignalEvent(id)?.id
      ?? database.listMailQueue().find((item) => item.id === id)?.eventId;
    if (!eventId) throw new Error('DELIVERY_EVENT_NOT_FOUND');
    await deliveryWorker.retryFailed(new Date(), eventId);
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
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) throw new Error('Untrusted IPC sender');
}

function runCheck(): Promise<void> {
  if (runningCheck) return runningCheck;
  if (paused || quitting) return Promise.resolve();
  runningCheck = performCheck().finally(() => { runningCheck = null; });
  return runningCheck;
}

async function performCheck(): Promise<void> {
  checking = true;
  lastCheckError = null;
  if (scheduleTimer) clearTimeout(scheduleTimer);
  nextCheckAt = null;
  rebuildTrayMenu();
  try {
    await broadcastSnapshot();
    lastCheckedAt = new Date().toISOString();
    await coordinator.checkNow(lastCheckedAt);
    await deliveryWorker.processDue();
  } catch {
    lastCheckError = 'CHECK_FAILED';
  } finally {
    checking = false;
    restartSchedule();
    rebuildTrayMenu();
    await broadcastSnapshot();
  }
}

function restartSchedule(): void {
  syncCollectionEnabled();
  if (scheduleTimer) clearTimeout(scheduleTimer);
  scheduleTimer = null;
  if (paused || checking || quitting) { nextCheckAt = null; return; }
  const interval = database.getSettings().pollIntervalMinutes * 60_000;
  nextCheckAt = new Date(Date.now() + interval).toISOString();
  if (process.env.TIBO_WATCH_E2E !== '1') {
    scheduleTimer = setTimeout(() => void runCheck(), interval);
  }
}

function syncCollectionEnabled(): void {
  chromeCompanionBridge?.setMonitoringEnabled(!paused && !quitting && database.getSettings().browserSourceEnabled);
}

async function snapshot(): Promise<AppSnapshot> {
  const settings = database.getSettings();
  const chromeStatus = xSession.collectionStatus();
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
      ...(health.sourceId === 'x-browser' && settings.browserSourceEnabled ? {
        ...chromeStatus,
        consecutiveFailures: ['online', 'syncing', 'partial'].includes(chromeStatus.state) ? 0 : health.consecutiveFailures,
        lastSuccessAt: chromeCompanionBridge.store.lastSuccessfulCollectionAt() ?? health.lastSuccessAt,
        collectionDiagnostics: chromeCompanionBridge.store.diagnostics(),
      } : {}),
      ...(!(health.sourceId === 'x-browser' ? settings.browserSourceEnabled : settings.publicRssEnabled) ? { state: 'disabled' as const, errorCode: null } : {}),
      label: health.sourceId === 'x-browser' ? 'Chrome 登录共享' : '公共 RSS',
    })),
    mailQueue: database.listMailQueue(),
    deliveries: database.listDeliveryStatuses(),
    windowsNotificationsSupported: Notification.isSupported(),
    lastCheckError,
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
  if (process.platform !== 'win32') {
    app.setLoginItemSettings(buildLoginItemSettings(
      settings.startAtLogin,
      process.platform,
      process.execPath,
    ));
    return;
  }

  // Remove the legacy Run entry. Windows can retain its old command line across
  // upgrades, which caused login launches to lose the --hidden argument.
  app.setLoginItemSettings(buildLoginItemSettings(false, 'win32', process.execPath));

  const shortcutPath = join(
    app.getPath('appData'),
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'Startup',
    'Tibo Watch.lnk',
  );
  if (!settings.startAtLogin) {
    rmSync(shortcutPath, { force: true });
    return;
  }

  const shortcutWritten = shell.writeShortcutLink(
    shortcutPath,
    startupShortcutWriteOperation(existsSync(shortcutPath)),
    buildStartupShortcutDetails(process.execPath),
  );
  if (!shortcutWritten) console.error('Failed to create the Tibo Watch startup shortcut');
}

function showChromeCompanionSetup(): void {
  if (process.env.TIBO_WATCH_E2E === '1') return;
  const extensionDirectory = app.isPackaged
    ? join(process.resourcesPath, 'chrome-extension')
    : join(app.getAppPath(), 'chrome-extension');
  shell.showItemInFolder(join(extensionDirectory, 'manifest.json'));

  const candidates = [
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter((value): value is string => Boolean(value));
  const chromeExecutable = candidates.find((candidate) => existsSync(candidate));
  if (chromeExecutable) {
    spawn(chromeExecutable, ['chrome://extensions', 'https://x.com/thsottiaux/with_replies'], {
      detached: true,
      stdio: 'ignore',
    }).unref();
  } else {
    void shell.openExternal('https://x.com/thsottiaux/with_replies');
  }
}

function isAllowedPostUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['x.com', 'twitter.com'].includes(url.hostname) && /^\/thsottiaux\/status\/\d+\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

function createE2eSource(): PostSource {
  return {
    id: 'public-rss',
    check: async ({ checkedAt }) => {
      const previewCreatedAt = new Date(Date.parse(checkedAt) - 3 * 60_000).toISOString();
      return {
        sourceId: 'public-rss',
        checkedAt,
        state: 'online',
        latencyMs: 4,
        errorCode: null,
        posts: [
          {
            id: '2083053369351090254',
            authorHandle: 'thsottiaux',
            text: "I've reset usage limits for all ChatGPT Work and Codex users.",
            createdAt: checkedAt,
            url: 'https://x.com/thsottiaux/status/2083053369351090254',
            kind: 'original',
            quotedText: null,
            sourceIds: ['public-rss'],
          },
          {
            id: '2083053000000000000',
            authorHandle: 'thsottiaux',
            text: 'Codex resets will continue tomorrow.',
            createdAt: previewCreatedAt,
            url: 'https://x.com/thsottiaux/status/2083053000000000000',
            kind: 'original',
            quotedText: null,
            sourceIds: ['public-rss'],
          },
        ],
      };
    },
  };
}

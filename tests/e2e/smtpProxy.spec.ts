import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

test('Electron resolves SMTP proxy policy, follows proxy changes, and renders actionable failure', async () => {
  const requests: Array<{ url: string; headers: unknown }> = [];
  const sockets = new Set<Socket>();
  let rejectProxy = false;
  const proxy = createServer();
  proxy.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  proxy.on('connect', (request, socket) => {
    requests.push({ url: request.url!, headers: request.headers });
    socket.write(rejectProxy ? 'HTTP/1.1 407 Proxy Authentication Required\r\n\r\n' : 'HTTP/1.1 200 Connection Established\r\n\r\n');
  });
  await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
  const address = proxy.address();
  if (!address || typeof address === 'string') throw new Error('Missing proxy fixture port');
  const profile = await mkdtemp(join(tmpdir(), 'tibo-watch-smtp-proxy-'));
  let instance: ElectronApplication | undefined;
  try {
    const executablePath = process.env.TIBO_WATCH_EXECUTABLE;
    instance = await electron.launch({ ...(executablePath ? { executablePath } : {}),
      args: [...(executablePath ? [] : ['.']), `--user-data-dir=${profile}`],
      env: { ...process.env, TIBO_WATCH_E2E: '1' },
    });
    const page = await instance.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await expect(page.getByRole('heading', { name: '开始监测 Codex 重置' })).toBeVisible();
    await page.getByRole('button', { name: '建立历史基线并开始' }).click();
    const result = await instance.evaluate(async ({ app, session }, port) => {
      const { createRequire } = process.getBuiltinModule('module');
      const load = createRequire(`${app.getAppPath()}/package.json`);
      const { createSystemSmtpSocket } = load('./dist/main/notifications/smtpProxy.js') as typeof import('../../src/main/notifications/smtpProxy');
      const isolated = session.fromPartition('smtp-proxy-e2e', { cache: false });
      const modes: string[] = [];
      const getSocket = createSystemSmtpSocket(() => ({
        setProxy: async config => { modes.push(config.mode!); await isolated.setProxy({ mode: 'fixed_servers', proxyRules: `127.0.0.1:${port}` }); },
        forceReloadProxyConfig: isolated.forceReloadProxyConfig.bind(isolated),
        resolveProxy: isolated.resolveProxy.bind(isolated),
      }));
      const open = () => new Promise<boolean>((resolve, reject) => getSocket({ host: 'smtp-proxy.invalid', port: 465, connectionTimeout: 2_000 }, (error, options) => {
        if (error) { reject(error); return; }
        const tunneled = Boolean(options.connection); options.connection?.destroy(); resolve(tunneled);
      }));
      const tunnel = await open();
      await isolated.setProxy({ mode: 'direct' });
      const direct = !(await open());
      await isolated.setProxy({ mode: 'fixed_servers', proxyRules: `127.0.0.1:${port}` });
      const changedBack = await open();
      return { modes, tunnel, direct, changedBack };
    }, address.port);
    expect(result).toEqual({ modes: ['system'], tunnel: true, direct: true, changedBack: true });
    expect(requests).toHaveLength(2);
    expect(requests.every(request => request.url === 'smtp-proxy.invalid:465' && !JSON.stringify(request.headers).includes('cookie'))).toBe(true);

    rejectProxy = true;
    // Only this disposable test-profile IPC handler is replaced. A real proxy
    // failure drives the UI, with no SMTP authentication or real email sent.
    await instance.evaluate(({ app, ipcMain, session }, port) => {
      const { createRequire } = process.getBuiltinModule('module');
      const load = createRequire(`${app.getAppPath()}/package.json`);
      const { createSystemSmtpSocket } = load('./dist/main/notifications/smtpProxy.js') as typeof import('../../src/main/notifications/smtpProxy');
      const isolated = session.fromPartition('smtp-ui-error-e2e', { cache: false });
      const getSocket = createSystemSmtpSocket(() => ({
        setProxy: async () => { await isolated.setProxy({ mode: 'fixed_servers', proxyRules: `127.0.0.1:${port}` }); },
        forceReloadProxyConfig: isolated.forceReloadProxyConfig.bind(isolated), resolveProxy: isolated.resolveProxy.bind(isolated),
      }));
      ipcMain.removeHandler('app:test-email');
      ipcMain.handle('app:test-email', () => new Promise(resolve => getSocket({ host: 'smtp-proxy.invalid', port: 465, connectionTimeout: 2_000 }, error => resolve({ ok: !error, errorCode: error?.message ?? null }))));
    }, address.port);
    await page.evaluate(() => window.tiboWatch!.updateSettings({ emailEnabled: true, smtpHost: 'smtp-proxy.invalid', emailRecipients: ['fixture@example.com'] }));
    // Direct fixture setup bypasses React's save callback; reload its snapshot.
    await page.reload();
    await expect(page.getByRole('heading', { name: '监测总览' })).toBeVisible();
    await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '通知', exact: true }).click();
    await page.getByRole('button', { name: '发送测试邮件' }).click();
    await expect(page.getByRole('status')).toContainText('系统代理要求额外身份验证');
    await expect(page.getByRole('status')).toContainText('EMAIL_PROXY_AUTH_REQUIRED');
    await expect(page.getByRole('button', { name: '发送测试邮件' })).toBeEnabled();
    expect(page.url()).toMatch(/^file:.*index\.html/);
    expect(await page.title()).toBe('Tibo Watch');
    expect(errors).toEqual([]);
    expect(await page.locator('vite-error-overlay').count()).toBe(0);
    await page.screenshot({ path: join(process.env.TIBO_WATCH_SCREENSHOT_DIR ?? tmpdir(), 'smtp-proxy-error-explained.png'), scale: 'css' });
  } finally {
    await instance?.close();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => proxy.close(error => error ? reject(error) : resolve()));
    assert.equal(dirname(resolve(profile)), resolve(tmpdir()));
    assert.ok(basename(profile).startsWith('tibo-watch-smtp-proxy-'));
    await rm(profile, { recursive: true, force: true });
  }
});

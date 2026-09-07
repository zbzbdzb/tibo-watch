import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, expect, test } from '@playwright/test';
import { demoSnapshot } from '../../src/renderer/demoData';

test('rendered collection states stay distinct in overview, details and settings in both themes', async () => {
  const root = resolve('dist/renderer');
  const server = createServer((request, response) => {
    const pathname = new URL(request.url!, 'http://localhost').pathname;
    if (pathname === '/favicon.ico') { response.writeHead(204).end(); return; }
    const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(root + sep)) { response.writeHead(403).end(); return; }
    void readFile(file).then((content) => {
      response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
      response.end(content);
    }).catch(() => response.writeHead(404).end());
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server');
  const browser = await chromium.launch({ ...(process.env.TIBO_WATCH_CHROMIUM ? { executablePath: process.env.TIBO_WATCH_CHROMIUM } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    const snapshot = structuredClone(demoSnapshot);
    snapshot.version = '0.2.16';
    snapshot.sourceHealth[0]!.state = 'syncing';
    snapshot.sourceHealth[0]!.errorCode = 'X_COLLECTION_POSTS_LOADING';
    snapshot.sourceHealth[0]!.collectionDiagnostics = [{ view: 'posts', extensionVersion: '0.2.16', collectorRevision: 1,
      result: 'loading', reason: 'pinned_only', checkedAt: '2026-09-07T08:00:00Z', receivedAt: '2026-09-07T08:00:01Z',
      postCount: 1, pendingDetails: 0, samples: 10 }];
    snapshot.sourceHealth[1]!.state = 'error';
    await page.addInitScript((initial) => {
      let listener: ((value: typeof initial) => void) | undefined;
      Object.assign(window, {
        tiboWatch: {
          getSnapshot: async () => initial,
          onSnapshot: (callback: typeof listener) => { listener = callback; return () => {}; },
          onNavigatePost: () => () => {},
        },
        setTestState: (state: typeof initial.sourceHealth[0]['state'], code: string) => {
          initial.sourceHealth[0]!.state = state;
          initial.sourceHealth[0]!.errorCode = code;
          listener?.(structuredClone(initial));
        },
      });
    }, snapshot);
    const url = `http://127.0.0.1:${address.port}/`;
    await page.goto(url);
    await expect(page).toHaveURL(url);
    await expect(page).toHaveTitle(/Tibo Watch/);
    await expect(page.getByText('同步中', { exact: true })).toBeVisible();
    const warning = page.getByText('同步中', { exact: true });
    for (const theme of ['dark', 'light']) {
      if (theme === 'light') await page.getByRole('button', { name: '切换到浅色模式' }).click();
      expect(await warning.evaluate((node) => getComputedStyle(node).color)).not.toBe(
        await page.getByText('采集异常', { exact: true }).evaluate((node) => getComputedStyle(node).color));
      await page.screenshot({ path: join(tmpdir(), `tibo-watch-0.2.16-status-${theme}.png`) });
    }
    await page.getByRole('button', { name: '查看详细状态' }).click();
    await expect(page.getByText(/帖子页尚未加载完成/)).toBeVisible();
    await expect(page.getByText('运行扩展：0.2.16 · 采集器：1')).toBeVisible();
    await expect(page.getByText('目前仅识别到置顶帖，尚未确认后续时间线')).toBeVisible();
    expect(await page.getByText('同步中', { exact: true }).evaluate(node => getComputedStyle(node).color)).toBe('rgb(137, 89, 0)');
    expect(await page.getByText('采集异常', { exact: true }).evaluate(node => getComputedStyle(node).color)).toBe('rgb(180, 35, 50)');
    for (const [state, code, label] of [
      ['partial', 'X_COLLECTION_DETAILS_PENDING', '部分采集完成'],
      ['error', 'X_COLLECTION_POSTS_LOADING_INCOMPLETE', '采集未完成'],
      ['partial', 'X_COMPANION_COLLECTOR_NEEDS_REFRESH', '需重载扩展'],
      ['stale', 'X_COLLECTION_REPORT_STALE', '数据已超时'],
      ['needs_login', 'X_SESSION_EXPIRED', '需重新登录'],
      ['online', '', '在线'],
    ]) {
      await page.evaluate(([state, code]) => {
        (window as unknown as { setTestState: (state: string, code: string) => void }).setTestState(state!, code!);
      }, [state, code]);
      await expect(page.getByText(label!, { exact: true })).toBeVisible();
      if (state === 'error') {
        await page.setViewportSize({ width: 1080, height: 720 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        expect(await page.locator('.source-grid section').evaluateAll(nodes => nodes.every(node => node.scrollWidth <= node.clientWidth))).toBe(true);
        await page.screenshot({ path: join(tmpdir(), 'tibo-watch-0.2.16-status-details.png') });
      }
    }
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await expect(page.locator('.login-status').getByText('在线', { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
  }
});

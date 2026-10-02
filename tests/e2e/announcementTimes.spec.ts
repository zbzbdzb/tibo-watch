import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, expect, test } from '@playwright/test';
import type { TiboWatchApi } from '../../src/shared/api';
import { demoSnapshot } from '../../src/renderer/demoData';

test('preview announcements convert the announced instant, preserve the original and remember the target zone', async () => {
  // A fixed PST announcement keeps its original wall time and offset; the
  // source-zone publication date, not the machine's date, anchors "tomorrow".
  const announcement = 'Global reset landing tomorrow 10am PST for all paid ChatGPT accounts.';
  const dateOnly = 'Codex reset will land tomorrow.';
  const snapshot = structuredClone(demoSnapshot);
  const preview = snapshot.posts.find(item => item.classification?.level === 'preview')!;
  preview.post.text = announcement;
  preview.post.createdAt = '2026-10-02T02:14:00.000Z';
  const undated = structuredClone(preview);
  undated.post.id = 'announcement-date-only';
  undated.post.url = 'https://x.com/thsottiaux/status/announcement-date-only';
  undated.post.text = dateOnly;
  snapshot.posts.push(undated);

  const root = resolve('dist/renderer');
  const server = createServer((request, response) => {
    const pathname = new URL(request.url!, 'http://localhost').pathname;
    if (pathname === '/favicon.ico') { response.writeHead(204).end(); return; }
    const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(root + sep)) { response.writeHead(403).end(); return; }
    void readFile(file).then(content => {
      response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
      response.end(content);
    }).catch(() => response.writeHead(404).end());
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture port');
  const browser = await chromium.launch({ ...(process.env.TIBO_WATCH_CHROMIUM ? { executablePath: process.env.TIBO_WATCH_CHROMIUM } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1536, height: 1024 }, locale: 'zh-CN', reducedMotion: 'reduce' });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()); });
    // Only the desktop IPC boundary is replaced; the built renderer, parsing,
    // date arithmetic, target selector and localStorage remain real.
    await page.addInitScript(({ initial, previewId }) => {
      let listener: ((value: typeof initial) => void) | undefined;
      const actions: string[] = [];
      const actionSnapshot = async (name: string) => { actions.push(name); return structuredClone(initial); };
      const api: TiboWatchApi = {
        getSnapshot: async () => structuredClone(initial),
        updateSettings: async () => actionSnapshot('updateSettings'),
        checkNow: async () => actionSnapshot('checkNow'),
        setPaused: async () => actionSnapshot('setPaused'),
        openXLogin: async () => actionSnapshot('openXLogin'),
        logoutX: async () => actionSnapshot('logoutX'),
        sendTestEmail: async () => { actions.push('sendTestEmail'); return { ok: true, errorCode: null }; },
        openPost: async () => { actions.push('openPost'); },
        completeOnboarding: async () => actionSnapshot('completeOnboarding'),
        retryMail: async () => actionSnapshot('retryMail'),
        windowAction: async () => { actions.push('windowAction'); },
        onSnapshot: callback => { listener = callback; return () => { if (listener === callback) listener = undefined; }; },
        onNavigatePost: () => () => {},
      };
      Object.assign(window, {
        tiboWatch: api,
        announcementTest: {
          actions,
          pushPreviewText: (text: string) => {
            initial.posts.find(item => item.post.id === previewId)!.post.text = text;
            listener?.(structuredClone(initial));
          },
        },
      });
    }, { initial: snapshot, previewId: preview.post.id });

    const url = `http://127.0.0.1:${address.port}/`;
    const openPreview = async () => {
      await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '动态收件箱', exact: true }).click();
      await page.getByRole('button', { name: `阅读：${announcement}`, exact: true }).click();
    };
    const card = page.getByRole('region', { name: '预告时间', exact: true });
    const target = card.getByLabel('预告目标时区', { exact: true });
    const result = card.getByLabel('预告时间换算', { exact: true });
    const assertNoExternalActions = async () => {
      expect(await page.evaluate(() => (window as unknown as { announcementTest: { actions: string[] } }).announcementTest.actions)).toEqual([]);
      expect(await page.evaluate(async () => (await window.tiboWatch!.getSnapshot()).settings)).toEqual(snapshot.settings);
    };

    await page.goto(url);
    await expect(page).toHaveURL(url);
    await expect(page).toHaveTitle('Tibo Watch');
    await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
    await openPreview();
    await expect(page.getByLabel('动态原文', { exact: true })).toHaveText(announcement);
    await expect(target).toHaveValue('Asia/Shanghai');
    await expect(card.locator('time').first()).toHaveText('2026-10-02 10:00');
    await expect(card).not.toContainText('2026-10-02 11:00');
    await expect(card).not.toContainText('PDT');
    await expect(card).toContainText('PST');
    const postTimes = page.locator('.author-line time');
    await expect(postTimes.nth(0)).toHaveText('2026-10-02 10:14 北京时间');
    await expect(postTimes.nth(1)).toContainText('2026-10-01 18:14');
    await expect(postTimes.nth(1)).toContainText('PST');
    await expect(postTimes.nth(1)).toContainText(/UTC[−-]0?8/);
    await expect(result).toContainText('2026-10-03 02:00');
    await target.selectOption('Asia/Tokyo');
    await expect(result).toContainText('2026-10-03 03:00');
    await target.selectOption('UTC');
    await expect(result).toContainText('2026-10-02 18:00');
    await target.selectOption('America/New_York');
    await expect(result).toContainText('2026-10-02 14:00');
    await assertNoExternalActions();

    await page.reload();
    await expect(page).toHaveURL(url);
    await expect(page).toHaveTitle('Tibo Watch');
    await openPreview();
    await expect(target).toHaveValue('America/New_York');
    await expect(result).toContainText('2026-10-02 14:00');
    await expect(page.getByLabel('动态原文', { exact: true })).toHaveText(announcement);
    await target.selectOption('Asia/Shanghai');

    const output = process.env.TIBO_WATCH_SCREENSHOT_DIR ?? tmpdir();
    for (const theme of ['dark', 'light']) {
      if (theme === 'light') await page.getByRole('button', { name: '切换到浅色模式', exact: true }).click();
      for (const size of [{ width: 1536, height: 1024 }, { width: 1080, height: 720 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(size);
        if (theme === 'dark' && size.width === 1080) {
          await target.selectOption('Pacific/Port_Moresby');
          await expect(result).toContainText('2026-10-03 04:00');
        }
        await card.scrollIntoViewIfNeeded();
        await expect(card).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        expect(await page.locator('.reader-scroll').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
        expect(await card.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
        const bounds = await target.boundingBox();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(size.width);
        await result.scrollIntoViewIfNeeded();
        await expect(result).toBeInViewport({ ratio: 1 });
        if (theme === 'dark' && size.width === 1080) await target.selectOption('Asia/Shanghai');
        await expect(result).toContainText('2026-10-03 02:00');
        if ((theme === 'dark' && size.width === 1536) || (theme === 'light' && size.width === 390)) {
          await card.scrollIntoViewIfNeeded();
          await page.screenshot({ path: join(output, `announcement-${theme}-${size.width}.png`), scale: 'css' });
        }
      }
      await page.setViewportSize({ width: 1536, height: 1024 });
    }

    // A date without a clock time is useful context, never an invented midnight.
    await page.getByRole('button', { name: `阅读：${dateOnly}`, exact: true }).click();
    await expect(page.getByLabel('动态原文', { exact: true })).toHaveText(dateOnly);
    await expect(card).toContainText('未提供具体时间');
    await expect(card).not.toContainText('00:00');
    await expect(card).not.toContainText(/2026-10-\d{2} \d{2}:\d{2}/);

    // A snapshot correction to the same post must remove the previous instant.
    await page.getByRole('button', { name: `阅读：${announcement}`, exact: true }).click();
    await expect(result).toContainText('2026-10-03 02:00');
    // Omitted zones default to fixed PST; explicitly supplied PDT or PT must
    // still use their own offset rather than being overwritten by the default.
    for (const [text, sourceLabel, expected] of [
      ['Global reset landing tomorrow 10am for all paid ChatGPT accounts.', 'PST', '2026-10-03 02:00'],
      ['Global reset landing tomorrow 10am PDT for all paid ChatGPT accounts.', 'PDT', '2026-10-03 01:00'],
      ['Global reset landing tomorrow 10am PT for all paid ChatGPT accounts.', 'PDT', '2026-10-03 01:00'],
    ]) {
      await page.evaluate(text => {
        (window as unknown as { announcementTest: { pushPreviewText: (text: string) => void } }).announcementTest.pushPreviewText(text);
      }, text!);
      await expect(page.getByLabel('动态原文', { exact: true })).toHaveText(text!);
      await expect(card.locator('time').first()).toHaveText('2026-10-02 10:00');
      await expect(card.locator('.announcement-time-grid')).toContainText(sourceLabel!);
      await expect(result).toContainText(expected!);
    }
    await page.evaluate(() => {
      (window as unknown as { announcementTest: { pushPreviewText: (text: string) => void } }).announcementTest.pushPreviewText('Codex usage limits may change soon.');
    });
    await expect(page.getByLabel('动态原文', { exact: true })).toHaveText('Codex usage limits may change soon.');
    await expect(card).toHaveCount(0);
    await assertNoExternalActions();
    await expect(page.locator('vite-error-overlay, nextjs-portal, .webpack-error-overlay')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
  }
});

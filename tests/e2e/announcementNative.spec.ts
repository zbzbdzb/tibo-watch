import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

test('native announcement card converts a pushed preview without changing stored posts or notification settings', async () => {
  const tempRoot = resolve(tmpdir());
  const userData = await mkdtemp(join(tempRoot, 'tibo-announcement-native-'));
  const cleanupTarget = resolve(userData);
  if (!cleanupTarget.startsWith(tempRoot + sep) || !basename(cleanupTarget).startsWith('tibo-announcement-native-')) {
    throw new Error('Refusing to use or remove an unexpected native-test profile path');
  }
  const executablePath = process.env.TIBO_WATCH_EXECUTABLE;
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({
      ...(executablePath ? { executablePath } : {}),
      args: [...(executablePath ? [] : ['.']), `--user-data-dir=${userData}`],
      env: { ...process.env, TIBO_WATCH_E2E: '1' },
    });
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(page).toHaveTitle('Tibo Watch');
    expect(page.url()).toMatch(/^file:.*\/renderer\/index\.html$/);

    // Normal onboarding populates this disposable profile from the existing
    // E2E RSS source. Establish the backend baseline before the UI-only fixture.
    await expect(page.getByRole('heading', { name: '开始监测 Codex 重置', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '建立历史基线并开始', exact: true }).click();
    await expect(page.getByRole('heading', { name: '开始监测 Codex 重置', exact: true })).toHaveCount(0);
    await expect.poll(async () => (await page.evaluate(() => window.tiboWatch!.getSnapshot())).posts.length).toBeGreaterThan(0);
    const before = await page.evaluate(() => window.tiboWatch!.getSnapshot());
    expect(before.settings.emailEnabled).toBe(false);
    const fixture = structuredClone(before);
    const preview = fixture.posts[0]!;
    const announcement = 'Global reset landing tomorrow 10am PST for all paid ChatGPT accounts.';
    preview.post.text = announcement;
    preview.post.createdAt = '2026-10-02T02:14:00.000Z';
    preview.classification = {
      level: 'preview', score: 8, reasons: ['明确预告未来额度重置。'],
      matchedTerms: ['reset', 'tomorrow', 'ChatGPT accounts'],
      classifierVersion: preview.classification?.classifierVersion ?? 'rules-v9',
    };
    // Verified against preload's real subscription; do not insert the fixture
    // into SQLite or replace the exposed desktop API.
    await app.evaluate(({ BrowserWindow }, snapshot) => {
      BrowserWindow.getAllWindows()[0]!.webContents.send('app:snapshot', snapshot);
    }, fixture);
    const dismissToast = page.getByRole('button', { name: '关闭提示', exact: true });
    if (await dismissToast.count()) await dismissToast.click();
    await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '动态收件箱', exact: true }).click();
    await page.getByRole('button', { name: `阅读：${announcement}`, exact: true }).click();

    const card = page.getByRole('region', { name: '预告时间', exact: true });
    const target = card.getByLabel('预告目标时区', { exact: true });
    const result = card.getByLabel('预告时间换算', { exact: true });
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
    await expect(page.getByLabel('动态原文', { exact: true })).toHaveText(announcement);
    await target.selectOption('Asia/Shanghai');

    for (const size of [{ width: 1536, height: 1024 }, { width: 1080, height: 720 }]) {
      const actual = await app.evaluate(({ BrowserWindow, screen }, dimensions) => {
        const window = BrowserWindow.getAllWindows()[0]!;
        window.setSize(dimensions.width, dimensions.height);
        const bounds = window.getBounds();
        return {
          size: window.getSize(), contentSize: window.getContentSize(), bounds,
          contentBounds: window.getContentBounds(),
          scaleFactor: screen.getDisplayMatching(bounds).scaleFactor,
        };
      }, size);
      const rendered = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio }));
      console.log(JSON.stringify({ diagnostic: 'native-announcement-window', requested: size, actual, rendered }));
      // Windows at 150% scaling reports a one-DIP outer-border difference
      // and rounds the native minimum height up two DIPs. Bound those
      // observed differences; compare the real DOM to content, not requests.
      for (const [axis, requested] of [[0, size.width], [1, size.height]] as const) {
        expect(Math.abs(actual.size[axis]! - requested)).toBeLessThanOrEqual(2);
        expect(Math.abs(actual.contentSize[axis]! - requested)).toBeLessThanOrEqual(2);
      }
      expect([actual.bounds.width, actual.bounds.height]).toEqual(actual.size);
      expect([actual.contentBounds.width, actual.contentBounds.height]).toEqual(actual.contentSize);
      expect(actual.contentSize[0]).toBeGreaterThanOrEqual(1080);
      const content = { width: actual.contentSize[0], height: actual.contentSize[1] };
      await expect.poll(() => page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual(content);
      await card.scrollIntoViewIfNeeded();
      await expect(card).toBeVisible();
      await expect(result).toContainText('2026-10-03 02:00');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await page.locator('.reader-scroll').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      expect(await card.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      await result.scrollIntoViewIfNeeded();
      await expect(result).toBeInViewport({ ratio: 1 });
      if (size.width === 1536) {
        await card.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: join(process.env.TIBO_WATCH_SCREENSHOT_DIR ?? tmpdir(), 'announcement-native-dark-1536.png'),
          scale: 'css',
        });
      }
    }

    const after = await page.evaluate(() => window.tiboWatch!.getSnapshot());
    expect(after.settings).toEqual(before.settings);
    expect(after.posts).toEqual(before.posts);
    expect(after.events).toEqual(before.events);
    expect(after.mailQueue).toEqual(before.mailQueue);
    expect(after.deliveries).toEqual(before.deliveries);
    await expect(page.locator('vite-error-overlay, nextjs-portal, .webpack-error-overlay')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    try { await app?.close(); }
    finally {
      await rm(cleanupTarget, { recursive: true, force: true });
    }
  }
});

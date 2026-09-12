import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, expect, test } from '@playwright/test';

test('settings scrolling and time-zone converter work in both themes and desktop/mobile sizes', async () => {
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
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture port');
  const browser = await chromium.launch({ ...(process.env.TIBO_WATCH_CHROMIUM ? { executablePath: process.env.TIBO_WATCH_CHROMIUM } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1536, height: 1024 }, locale: 'zh-CN', reducedMotion: 'reduce' });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const url = `http://127.0.0.1:${address.port}/`;
    await page.goto(url);
    await expect(page).toHaveURL(url); await expect(page).toHaveTitle('Tibo Watch');
    const nav = (name: string) => page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name, exact: true }).click();
    await nav('通知');
    await expect(page.getByText('决定哪些变化值得打扰，以及用什么方式。')).toHaveCount(0);
    await expect(page.getByText('开关修改即时保存')).toHaveCount(0);
    await nav('设置');
    await expect(page.getByText('显示时间', { exact: true })).toHaveCount(0);
    await expect(page.getByText('让 Tibo Watch 按照你的习惯，安静运行。')).toHaveCount(0);
    await expect(page.getByText('在及时性和安静运行之间，找到你的平衡。')).toHaveCount(0);
    const category = (name: string) => page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name, exact: true }).click();
    await category('外观');
    await expect(page.getByText('一种清晰的秩序，两种舒适的光线。')).toHaveCount(0);
    await category('时区换算');
    await page.getByLabel('来源日期', { exact: true }).fill('2026-09-12');
    await page.getByLabel('来源时间', { exact: true }).fill('14:00');
    const result = page.getByLabel('换算结果', { exact: true });
    await expect(result).toContainText('2026-09-13 05:00');
    await expect(result).toContainText('PDT'); await expect(result).toContainText('次日');
    const output = process.env.TIBO_WATCH_SCREENSHOT_DIR ?? tmpdir();
    const scroll = page.getByRole('region', { name: '设置内容' });
    for (const theme of ['dark', 'light']) {
      if (theme === 'light') await page.getByRole('button', { name: '切换到浅色模式' }).click();
      for (const size of [{ width: 1536, height: 1024 }, { width: 1080, height: 720 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(size);
        await scroll.evaluate(node => { node.scrollTop = 0; });
        const heading = await page.getByRole('heading', { name: '设置', exact: true }).boundingBox();
        const navigation = await page.getByRole('navigation', { name: '设置分类' }).boundingBox();
        const before = await scroll.evaluate(node => ({ top: node.scrollTop, max: node.scrollHeight - node.clientHeight }));
        await scroll.hover(); await page.mouse.wheel(0, 800);
        if (before.max > 1) await expect.poll(() => scroll.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
        expect((await page.getByRole('heading', { name: '设置', exact: true }).boundingBox())!.y).toBe(heading!.y);
        expect((await page.getByRole('navigation', { name: '设置分类' }).boundingBox())!.y).toBe(navigation!.y);
        expect(await page.locator('.app-main').evaluate(node => node.scrollTop)).toBe(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        expect(await scroll.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
        expect(await scroll.evaluate(node => getComputedStyle(node, '::-webkit-scrollbar').width)).toBe('12px');
        if (before.max > 1) {
          await scroll.focus(); await page.keyboard.press('End');
          await expect.poll(() => scroll.evaluate(node => Math.abs(node.scrollHeight - node.clientHeight - node.scrollTop))).toBeLessThan(2);
        }
        if (size.width !== 1080) await page.screenshot({ path: join(output, `timezone-${theme}-${size.width}.png`), scale: 'css' });
      }
      await page.setViewportSize({ width: 1536, height: 1024 });
    }
    await page.getByRole('button', { name: '交换来源与目标时区' }).click();
    await expect(result).toContainText('2026-09-12 14:00'); await expect(result).toContainText('前一日');
    await page.getByRole('button', { name: '交换来源与目标时区' }).click();
    await page.getByLabel('来源日期', { exact: true }).fill('2026-11-01');
    await page.getByLabel('来源时间', { exact: true }).fill('01:30');
    await expect(result).toContainText('选择具体时刻');
    await page.getByLabel('重复时间的具体时刻').selectOption('1');
    await expect(result).toContainText('2026-11-01 17:30');
    await page.getByLabel('来源日期', { exact: true }).fill('2026-03-08');
    await page.getByLabel('来源时间', { exact: true }).fill('02:30');
    await expect(page.getByRole('alert')).toContainText('不存在');
    await expect(page.getByRole('button', { name: '交换来源与目标时区' })).toBeDisabled();
    await page.getByRole('button', { name: '使用当前时间' }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '交换来源与目标时区' })).toBeEnabled();
    expect(errors).toEqual([]); await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  } finally {
    await browser.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

test.describe.serial('Tibo Watch Electron app', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let userDataDir: string;

  test.beforeAll(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), 'tibo-watch-e2e-'));
    const packagedExecutable = process.env.TIBO_WATCH_EXECUTABLE;
    electronApp = await electron.launch({
      ...(packagedExecutable ? { executablePath: packagedExecutable } : {}),
      args: packagedExecutable ? [`--user-data-dir=${userDataDir}`] : ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, TIBO_WATCH_E2E: '1' },
    });
    page = await electronApp.firstWindow();
  });

  test.afterAll(async () => {
    await electronApp.close();
    await rm(userDataDir, { recursive: true, force: true });
  });

  test('completes onboarding and creates a silent historical baseline', async () => {
    await expect(page.getByRole('heading', { name: '开始监测 Codex 重置' })).toBeVisible();
    await page.getByRole('button', { name: '建立历史基线并开始' }).click();
    await expect(page.getByRole('heading', { name: '已确认重置' })).toBeVisible();
    await expect(page.getByText('共 2 条记录')).toBeVisible();
  });

  test('restores the sidebar and persists the selected theme', async () => {
    const app = page.locator('.app');

    await page.getByRole('button', { name: '收起导航' }).click();
    await expect(app).toHaveClass(/sidebar-collapsed/);
    await page.getByRole('button', { name: '展开导航' }).click();
    await expect(app).not.toHaveClass(/sidebar-collapsed/);

    await page.getByRole('button', { name: '切换到浅色模式' }).click();
    await expect(app).toHaveAttribute('data-theme', 'light');
    await page.reload();
    await expect(page.locator('.app')).toHaveAttribute('data-theme', 'light');
    await page.getByRole('button', { name: '切换到深色模式' }).click();
    await expect(page.locator('.app')).toHaveAttribute('data-theme', 'dark');
  });

  test('filters the feed and opens the selected detail', async () => {
    await page.getByRole('button', { name: '预告', exact: true }).click();
    await expect(page.getByText('Codex resets will continue tomorrow.')).toBeVisible();
    await expect(page.getByText("I've reset usage limits for all ChatGPT Work and Codex users.")).toHaveCount(1);
  });

  test('saves monitoring and SMTP settings through the restricted preload API', async () => {
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByLabel('检查间隔').selectOption('10');
    await page.getByRole('switch', { name: '启用 X 登录抓取' }).click();
    await page.getByLabel('SMTP 主机').fill('smtp.test.local');
    await page.getByLabel('端口').fill('465');
    await page.getByLabel('加密方式').selectOption('ssl');
    await page.getByRole('button', { name: '保存设置' }).click();
    await page.getByRole('button', { name: '总览', exact: true }).click();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await expect(page.getByLabel('检查间隔')).toHaveValue('10');
    await expect(page.getByRole('switch', { name: '启用 X 登录抓取' })).toBeChecked();
    await expect(page.getByLabel('SMTP 主机')).toHaveValue('smtp.test.local');
  });

  test('routes notification clicks and continues running after close-to-tray', async () => {
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('app:navigate-post', 'e2e-preview');
    });
    await expect(page.getByRole('heading', { name: '当前状态' })).toBeVisible();
    await expect(page.locator('.timeline-row.selected')).toContainText('Codex resets will continue tomorrow.');
    await page.getByRole('button', { name: '关闭' }).click();
    await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible())).toBe(false);
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.show());
    await expect(page.getByRole('heading', { name: '当前状态' })).toBeVisible();
  });
});

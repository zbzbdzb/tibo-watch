import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

test.describe.serial('Tibo Watch Electron app', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let userDataDir: string;
  const pageErrors: string[] = [];

  test.beforeAll(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), 'tibo-watch-e2e-'));
    const packagedExecutable = process.env.TIBO_WATCH_EXECUTABLE;
    electronApp = await electron.launch({
      ...(packagedExecutable ? { executablePath: packagedExecutable } : {}),
      args: packagedExecutable ? [`--user-data-dir=${userDataDir}`] : ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, TIBO_WATCH_E2E: '1' },
    });
    page = await electronApp.firstWindow();
    page.on('pageerror', (error) => pageErrors.push(error.message));
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
    await expect(page.getByText('无发送记录（历史基线或未触发提醒）')).toBeVisible();
    await page.screenshot({ path: join(tmpdir(), 'tibo-watch-0.2.12-overview-1440.png') });
  });

  test('contains long summary text inside the current-state panel', async () => {
    const onboarding = page.getByRole('button', { name: '建立历史基线并开始' });
    if (await onboarding.count() === 1) await onboarding.click();
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1194, 720);
    });
    try {
      await page.locator('.signal-summary p').evaluate((element) => {
        element.textContent = "That's right, GPT-5.6 Sol is awesome and can be used pretty much anywhere, including a deliberately very long dashboard summary.";
      });
      const layout = await page.evaluate(() => {
        const summary = document.querySelector<HTMLElement>('.signal-summary p');
        const currentState = document.querySelector<HTMLElement>('.current-state');
        if (!summary || !currentState) throw new Error('Current-state layout is incomplete');
        return {
          summaryRight: summary.getBoundingClientRect().right,
          currentRight: currentState.getBoundingClientRect().right,
          summaryScrollWidth: summary.scrollWidth,
          summaryClientWidth: summary.clientWidth,
        };
      });
      expect(layout.summaryRight).toBeLessThanOrEqual(layout.currentRight);
      expect(layout.summaryScrollWidth).toBeGreaterThan(layout.summaryClientWidth);
    } finally {
      await electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setSize(1440, 900);
      });
    }
  });

  test('vertically aligns the detail timestamp with its status icon', async () => {
    const onboarding = page.getByRole('button', { name: '建立历史基线并开始' });
    if (await onboarding.count() === 1) await onboarding.click();
    const centers = await page.evaluate(() => {
      const detailTime = document.querySelector<HTMLElement>('.detail-heading time');
      const detailIcon = document.querySelector<SVGElement>('.detail-heading svg');
      if (!detailTime || !detailIcon) throw new Error('Detail heading is incomplete');
      const timeRect = detailTime.getBoundingClientRect();
      const iconRect = detailIcon.getBoundingClientRect();
      return {
        time: timeRect.top + timeRect.height / 2,
        icon: iconRect.top + iconRect.height / 2,
      };
    });
    expect(Math.abs(centers.time - centers.icon)).toBeLessThanOrEqual(1);
  });

  test('keeps the overview fixed while only the message timeline scrolls', async () => {
    const onboarding = page.getByRole('button', { name: '建立历史基线并开始' });
    if (await onboarding.count() === 1) await onboarding.click();
    await page.getByRole('button', { name: '总览', exact: true }).click();
    const toolbar = page.locator('.feed-toolbar');
    await expect(toolbar).toBeVisible();
    await expect(toolbar.getByText('共 2 条记录')).toBeVisible();

    await page.locator('.timeline').evaluate((timeline) => {
      const row = timeline.querySelector('.timeline-row');
      if (!row) throw new Error('Timeline fixture row is missing');
      for (let index = 0; index < 12; index += 1) timeline.append(row.cloneNode(true));
    });
    const layout = await page.evaluate(() => {
      const content = document.querySelector<HTMLElement>('.content');
      const timeline = document.querySelector<HTMLElement>('.timeline');
      const toolbar = document.querySelector<HTMLElement>('.feed-toolbar');
      if (!content || !timeline || !toolbar) throw new Error('Overview scrolling layout is incomplete');
      const toolbarTop = toolbar.getBoundingClientRect().top;
      timeline.scrollTop = timeline.scrollHeight;
      return {
        contentOverflowY: getComputedStyle(content).overflowY,
        contentScrollHeight: content.scrollHeight,
        contentClientHeight: content.clientHeight,
        timelineScrollTop: timeline.scrollTop,
        toolbarTop,
        toolbarTopAfterScroll: toolbar.getBoundingClientRect().top,
      };
    });

    expect(layout.contentOverflowY).toBe('hidden');
    expect(layout.contentScrollHeight).toBeLessThanOrEqual(layout.contentClientHeight + 1);
    expect(layout.timelineScrollTop).toBeGreaterThan(0);
    expect(layout.toolbarTopAfterScroll).toBe(layout.toolbarTop);
    await page.locator('.timeline-row').evaluateAll((rows) => {
      rows.slice(2).forEach((row) => row.remove());
    });
  });

  test('opens source details and gives immediate feedback while checking', async () => {
    const onboarding = page.getByRole('button', { name: '建立历史基线并开始' });
    if (await onboarding.count() === 1) await onboarding.click();
    await page.getByRole('button', { name: '总览', exact: true }).click();
    await page.getByRole('button', { name: '查看详细状态' }).click();
    await expect(page.getByRole('heading', { name: '数据源' })).toBeVisible();

    await page.getByRole('button', { name: '立即检查全部' }).click();
    const checkingButton = page.getByRole('button', { name: '检查中…' });
    await expect(checkingButton).toBeVisible();
    await expect(checkingButton).toBeDisabled();
    await expect(checkingButton.locator('svg')).toHaveClass(/spin/);
    await expect(page.getByRole('button', { name: '立即检查全部' })).toBeEnabled();
  });

  test('persists the public RSS switch immediately across page changes', async () => {
    const onboarding = page.getByRole('button', { name: '建立历史基线并开始' });
    if (await onboarding.count() === 1) await onboarding.click();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    const publicRss = page.getByRole('switch', { name: '启用公共 RSS' });
    await expect(publicRss).toBeChecked();

    await publicRss.click();
    await expect(publicRss).not.toBeChecked();
    await page.getByRole('button', { name: '动态', exact: true }).click();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await expect(page.getByRole('switch', { name: '启用公共 RSS' })).not.toBeChecked();

    await page.getByRole('switch', { name: '启用公共 RSS' }).click();
    await page.getByRole('button', { name: '总览', exact: true }).click();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await expect(page.getByRole('switch', { name: '启用公共 RSS' })).toBeChecked();
  });

  test('shows a clearly scoped global save action outside the email section', async () => {
    const onboarding = page.getByRole('button', { name: '建立历史基线并开始' });
    if (await onboarding.count() === 1) await onboarding.click();
    await page.getByRole('button', { name: '设置', exact: true }).click();

    const saveAll = page.getByRole('button', { name: '保存全部设置' });
    await expect(saveAll).toBeVisible();
    const placement = await saveAll.evaluate((button) => ({
      inEmailSection: Boolean(button.closest('.settings-section')),
      inGlobalBar: Boolean(button.closest('.settings-save-bar')),
    }));
    expect(placement.inEmailSection).toBe(false);
    expect(placement.inGlobalBar).toBe(true);
    await expect(page.getByText('保存监测、启动与邮件等全部配置')).toBeVisible();

    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1080, 720);
    });
    const compactPlacement = await saveAll.evaluate((button) => {
      const saveBar = button.closest('.settings-save-bar')!.getBoundingClientRect();
      const statusBar = document.querySelector('.statusbar')!.getBoundingClientRect();
      return { saveBarBottom: saveBar.bottom, statusBarTop: statusBar.top };
    });
    expect(compactPlacement.saveBarBottom).toBeLessThanOrEqual(compactPlacement.statusBarTop);
    await page.screenshot({ path: join(tmpdir(), 'tibo-watch-0.2.12-settings-1080.png') });
  });

  test('validates recipients before saving or attempting a test delivery', async () => {
    await page.getByRole('button', { name: '设置', exact: true }).click();
    const recipients = page.getByLabel('收件人地址（多个用逗号或换行分隔）');
    await recipients.fill('invalid-email');
    await page.getByRole('button', { name: '发送测试邮件' }).click();
    await expect(page.getByText('测试失败：请检查邮箱配置后重试。')).toBeVisible();
    await recipients.fill('one@example.com, ');
    await expect(recipients).toHaveValue('one@example.com, ');
    await page.getByRole('switch', { name: '启用公共 RSS' }).click();
    await expect(recipients).toHaveValue('one@example.com, ');
    await page.getByRole('switch', { name: '启用公共 RSS' }).click();
    await recipients.fill('');
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

  test('persists independent Windows controls immediately and retains them after restart', async () => {
    await page.getByRole('button', { name: '设置', exact: true }).click();
    const confirmed = page.getByRole('switch', { name: '确认重置通知' });
    await expect(confirmed).toBeChecked();
    await confirmed.click();
    await expect(page.getByText('Windows 通知设置已即时保存。')).toBeVisible();
    await expect(page.getByRole('combobox', { name: '确认重置声音' })).toBeDisabled();
    await page.getByRole('combobox', { name: '预告声音' }).selectOption('silent');
    await expect(page.getByRole('button', { name: '保存全部设置' })).toBeEnabled();
    await page.getByRole('button', { name: '总览', exact: true }).click();
    await expect(page.getByText('部分启用')).toBeVisible();
    await electronApp.close();
    const packagedExecutable = process.env.TIBO_WATCH_EXECUTABLE;
    electronApp = await electron.launch({
      ...(packagedExecutable ? { executablePath: packagedExecutable } : {}),
      args: packagedExecutable ? [`--user-data-dir=${userDataDir}`] : ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, TIBO_WATCH_E2E: '1' },
    });
    page = await electronApp.firstWindow();
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await expect(page.locator('.app')).toBeVisible();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await expect(page.getByRole('switch', { name: '确认重置通知' })).not.toBeChecked();
    await expect(page.getByRole('combobox', { name: '预告声音' })).toHaveValue('silent');
    const section = page.locator('.settings-section').filter({ has: page.getByRole('heading', { name: 'Windows 通知', exact: true }) });
    await section.scrollIntoViewIfNeeded();
    await section.screenshot({ path: join(tmpdir(), 'tibo-watch-0.2.13-notifications.png') });
    await page.getByRole('switch', { name: '确认重置通知' }).click();
    await expect(page.getByRole('combobox', { name: '预告声音' })).toBeEnabled();
    await page.getByRole('combobox', { name: '预告声音' }).selectOption('sound');
    await expect(page.getByRole('button', { name: '保存全部设置' })).toBeEnabled();
  });

  test('uses distinct semantic colors for light-theme runtime states', async () => {
    const onboarding = page.getByRole('button', { name: '建立历史基线并开始' });
    if (await onboarding.count() === 1) await onboarding.click();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    const sharing = page.getByRole('switch', { name: '启用 Chrome 登录共享' });
    if (!(await sharing.isChecked())) await sharing.click();
    await page.getByRole('button', { name: '保存全部设置' }).click();
    await page.getByRole('button', { name: '总览', exact: true }).click();
    await page.getByRole('button', { name: '刷新', exact: true }).click();
    await expect(page.getByText('等待扩展')).toBeVisible();
    await page.getByRole('button', { name: '切换到浅色模式' }).click();

    const colors = await page.evaluate(() => {
      const online = document.querySelector<HTMLElement>('.health-row em:not(.status-error):not(.status-disabled)');
      const error = document.querySelector<HTMLElement>('.health-row .status-error');
      const disabled = document.querySelector<HTMLElement>('.health-row .status-disabled');
      if (!online || !error || !disabled) throw new Error('Runtime semantic states are incomplete');
      return {
        online: getComputedStyle(online).color,
        error: getComputedStyle(error).color,
        disabled: getComputedStyle(disabled).color,
      };
    });
    expect(colors.error).not.toBe(colors.online);
    expect(colors.disabled).not.toBe(colors.online);
    await page.screenshot({ path: join(tmpdir(), 'tibo-watch-0.2.12-light-1080.png') });
    await page.getByRole('button', { name: '切换到深色模式' }).click();
  });

  test('filters the feed and opens the selected detail', async () => {
    await page.getByRole('button', { name: '预告', exact: true }).click();
    await expect(page.getByText('Codex resets will continue tomorrow.')).toBeVisible();
    await expect(page.locator('.timeline-row')).toHaveCount(1);
  });

  test('saves monitoring and SMTP settings through the restricted preload API', async () => {
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByLabel('检查间隔').selectOption('10');
    const sharing = page.getByRole('switch', { name: '启用 Chrome 登录共享' });
    if (!(await sharing.isChecked())) await sharing.click();
    await page.getByLabel('SMTP 主机').fill('smtp.test.local');
    await page.getByLabel('端口').fill('465');
    await page.getByLabel('加密方式').selectOption('ssl');
    await page.getByRole('button', { name: '保存全部设置' }).click();
    await page.getByRole('button', { name: '总览', exact: true }).click();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await expect(page.getByLabel('检查间隔')).toHaveValue('10');
    await expect(page.getByRole('switch', { name: '启用 Chrome 登录共享' })).toBeChecked();
    await expect(page.getByLabel('SMTP 主机')).toHaveValue('smtp.test.local');
  });

  test('routes notification clicks and continues running after close-to-tray', async () => {
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('app:navigate-post', '2083053000000000000');
    });
    await expect(page.getByRole('heading', { name: '当前状态' })).toBeVisible();
    await expect(page.locator('.timeline-row.selected')).toContainText('Codex resets will continue tomorrow.');
    await page.getByRole('button', { name: '关闭' }).click();
    await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible())).toBe(false);
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.show());
    await expect(page.getByRole('heading', { name: '当前状态' })).toBeVisible();
  });

  test('opens Chrome companion setup without creating an embedded X window', async () => {
    const onboarding = page.getByRole('button', { name: '建立历史基线并开始' });
    if (await onboarding.count() === 1) await onboarding.click();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Chrome 登录共享' })).toBeVisible();
    const sharing = page.getByRole('switch', { name: '启用 Chrome 登录共享' });
    if (await sharing.isChecked()) {
      await sharing.click();
      await page.getByRole('button', { name: '保存全部设置' }).click();
    }
    await expect(sharing).not.toBeChecked();
    await page.getByRole('button', { name: '安装/打开扩展' }).click();
    await expect(sharing).toBeChecked();
    await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().length)).toBe(1);
    expect(pageErrors).toEqual([]);
  });
});

test.describe('Tibo Watch hidden startup', () => {
  test('keeps the main window hidden when launched by the login item', async () => {
    const hiddenUserDataDir = await mkdtemp(join(tmpdir(), 'tibo-watch-hidden-e2e-'));
    const packagedExecutable = process.env.TIBO_WATCH_EXECUTABLE;
    const hiddenApp = await electron.launch({
      ...(packagedExecutable ? { executablePath: packagedExecutable } : {}),
      args: packagedExecutable
        ? ['--hidden', `--user-data-dir=${hiddenUserDataDir}`]
        : ['.', '--hidden', `--user-data-dir=${hiddenUserDataDir}`],
      env: { ...process.env, TIBO_WATCH_E2E: '1' },
    });

    try {
      const hiddenPage = await hiddenApp.firstWindow();
      await expect(hiddenPage.locator('.app')).toBeAttached();
      await hiddenPage.evaluate(() => new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }));
      const startupState = await hiddenApp.evaluate(({ BrowserWindow }) => ({
        argv: process.argv,
        visible: BrowserWindow.getAllWindows()[0]?.isVisible(),
      }));
      expect(startupState.argv).toContain('--hidden');
      expect(startupState.visible).toBe(false);
    } finally {
      await hiddenApp.close();
      await rm(hiddenUserDataDir, { recursive: true, force: true });
    }
  });
});

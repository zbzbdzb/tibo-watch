import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

test.describe.serial('Tibo Watch production redesign', () => {
 let app: ElectronApplication, page: Page, userData: string;
 const errors: string[] = [];
 const output = process.env.TIBO_WATCH_SCREENSHOT_DIR ?? tmpdir();
 const nav = async (name: string) => page.getByRole('navigation', { name:'主导航' }).getByRole('button', { name,exact:true }).click();
 const launch = async () => {
   const executablePath = process.env.TIBO_WATCH_EXECUTABLE;
   app = await electron.launch({ ...(executablePath ? { executablePath } : {}), args: [...(executablePath ? [] : ['.']), `--user-data-dir=${userData}`], env: { ...process.env, TIBO_WATCH_E2E:'1' } });
   page = await app.firstWindow(); page.on('pageerror', e => errors.push(e.message));
   await page.emulateMedia({ reducedMotion: 'reduce' });
 };
 test.beforeAll(async () => { userData = await mkdtemp(join(tmpdir(),'tibo-redesign-e2e-')); await launch(); });
 test.afterAll(async () => { await app.close(); await rm(userData,{recursive:true,force:true}); });

 test('onboards silently, shows true summary and leaves complete originals in the inbox', async () => {
   await expect(page.getByRole('heading',{name:'开始监测 Codex 重置'})).toBeVisible();
   await page.getByRole('button',{name:'建立历史基线并开始'}).click();
   await expect(page.getByRole('heading',{name:'新一轮重置，已宣布执行'})).toBeVisible();
   await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]!.setSize(1536,1024));
   const toast = page.getByRole('button',{name:'关闭提示'});
   if (await toast.count()) await toast.click();
   await page.screenshot({path:join(output,'production-dark-overview.png'), scale:'css'});
   await nav('动态收件箱');
   await expect(page.getByRole('tab')).toHaveCount(4);
   await expect(page.getByText('共 2 条记录')).toBeVisible();
   await expect(page.getByText('无发送记录（历史基线或未触发提醒）')).toBeVisible();
   await expect(page.getByLabel('动态原文')).toContainText("I've reset usage limits");
   await expect(page.getByText(/收藏/)).toHaveCount(0);
   await expect(page.getByRole('heading',{name:'判定证据'})).toHaveCount(0);
   await page.screenshot({path:join(output,'production-dark-inbox.png'), scale:'css'});
 });

 test('keeps timeline and reader actions fixed and contains long text', async () => {
   const toolbar = page.locator('.feed-toolbar'), footer = page.locator('.reader-bottom');
   await page.locator('.inbox-scroll').evaluate(el => { const row=el.querySelector('.post-row')!; for(let i=0;i<20;i++)el.append(row.cloneNode(true)); });
   const before = await toolbar.boundingBox(), actions = await footer.boundingBox();
   await page.locator('.inbox-scroll').evaluate(el => {el.scrollTop=el.scrollHeight;});
   expect((await toolbar.boundingBox())!.y).toBe(before!.y);
   expect((await footer.boundingBox())!.y).toBe(actions!.y);
   await page.locator('.inbox-scroll .post-row').evaluateAll(rows => rows.slice(2).forEach(row=>row.remove()));
   await nav('总览');
   await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]!.setSize(1080,720));
   await page.locator('.monitor-copy > p').evaluate(el=>{el.textContent='A very long public update '.repeat(35);});
   const bounds = await page.locator('.monitor-copy > p').evaluate(el=>({right:el.getBoundingClientRect().right,parent:el.closest('.monitor-banner')!.getBoundingClientRect().right,scroll:el.scrollWidth,client:el.clientWidth}));
   expect(bounds.right).toBeLessThan(bounds.parent); expect(bounds.scroll).toBeGreaterThan(bounds.client);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 });

 test('checks with visible progress, pauses and resumes using real IPC', async () => {
   await page.getByRole('button',{name:'暂停监测'}).click();
   await expect(page.getByRole('button',{name:'恢复监测'})).toBeEnabled();
   await page.getByRole('button',{name:'恢复监测'}).click();
   await expect(page.getByRole('button',{name:'暂停监测'})).toBeEnabled();
   await page.getByRole('button',{name:'查看详细状态'}).click();
   await page.getByRole('button',{name:'检查全部来源'}).click();
   await expect(page.getByRole('button',{name:'正在检查…'}).first()).toBeDisabled();
   await expect(page.getByRole('button',{name:'检查全部来源'})).toBeEnabled();
 });

 test('persists source toggles immediately and keeps native companion setup', async () => {
   await nav('数据源');
   const rss=page.getByRole('switch',{name:'启用公共 RSS'});
   await rss.click(); await expect(rss).not.toBeChecked(); await expect(rss).toBeEnabled();
   await nav('设置'); await nav('数据源'); await expect(rss).not.toBeChecked();
   await rss.click(); await expect(rss).toBeChecked(); await expect(rss).toBeEnabled();
   const chrome=page.getByRole('switch',{name:'启用 Chrome 登录共享'});
   if(await chrome.isChecked()){ await chrome.click(); await expect(chrome).not.toBeChecked(); await expect(chrome).toBeEnabled(); }
   await page.getByRole('button',{name:'安装 / 重载扩展'}).click();
   await expect(chrome).toBeChecked();
   expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length)).toBe(1);
 });

 test('separates notification and SMTP saves; validates email and preserves encrypted password', async () => {
   await nav('通知');
   await page.getByRole('button',{name:'添加',exact:true}).click();
   await page.getByLabel('邮箱地址').fill('invalid-email');
   await page.getByRole('button',{name:'添加收件人',exact:true}).click();
   await expect(page.getByRole('alert')).toContainText('请输入完整邮箱');
   await page.getByLabel('邮箱地址').fill('one@example.com');
   await page.getByRole('button',{name:'添加收件人',exact:true}).click();
   await expect(page.getByRole('dialog')).toHaveCount(0);
   await page.getByRole('button',{name:'编辑 SMTP 配置'}).click();
   await page.getByLabel('SMTP 主机').fill('draft.invalid'); await page.getByRole('button',{name:'取消',exact:true}).click();
   await page.getByRole('button',{name:'编辑 SMTP 配置'}).click();
   await expect(page.getByLabel('SMTP 主机')).not.toHaveValue('draft.invalid');
   await page.getByLabel('SMTP 主机').fill('smtp.test.local');
   await page.getByLabel('用户名').fill('test-user');
   await page.getByLabel('应用密码').fill('E2E-ONLY-TEST-SECRET');
   await page.getByRole('button',{name:'保存邮件配置'}).click();
   await expect(page.getByRole('dialog')).toHaveCount(0);
   await page.getByRole('switch',{name:'确认重置通知'}).click();
   await expect(page.getByRole('button',{name:'确认重置声音已开启'})).toBeDisabled();
   await expect(page.getByRole('switch',{name:'预告通知'})).toBeEnabled();
   await page.getByRole('button',{name:'预告声音已开启'}).click();
   await expect(page.getByRole('button',{name:'预告声音已关闭'})).toBeEnabled();
   await page.getByRole('button',{name:'编辑 SMTP 配置'}).click();
   await expect(page.getByLabel('SMTP 主机')).toHaveValue('smtp.test.local');
   await expect(page.getByLabel('应用密码')).toHaveValue('');
   await expect(page.getByLabel('应用密码')).toHaveAttribute('placeholder','已安全保存；留空则不修改');
   await page.getByRole('button',{name:'保存邮件配置'}).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
   const snapshot=await page.evaluate(()=>window.tiboWatch!.getSnapshot());
   expect(snapshot.settings.hasSmtpPassword).toBe(true);
   expect(snapshot.settings.emailRecipients).toEqual(['one@example.com']);
   expect(snapshot.settings.publicRssEnabled).toBe(true);
   // Never click send-test-email: this test must not send mail.
 });

 test('converts Pacific time in Electron without changing application settings', async () => {
   const before = await page.evaluate(async () => (await window.tiboWatch!.getSnapshot()).settings);
   await nav('设置');
   await expect(page.getByText('显示时间', { exact: true })).toHaveCount(0);
   await page.getByRole('button', { name: '时区换算', exact: true }).click();
   await page.getByLabel('来源日期', { exact: true }).fill('2026-09-12');
   await page.getByLabel('来源时间', { exact: true }).fill('14:00');
   await expect(page.getByLabel('换算结果', { exact: true })).toContainText('2026-09-13 05:00');
   await expect(page.getByLabel('换算结果', { exact: true })).toContainText('PDT');
   await page.getByRole('button', { name: '交换来源与目标时区' }).click();
   await expect(page.getByLabel('换算结果', { exact: true })).toContainText('2026-09-12 14:00');
   await page.getByRole('button', { name: '交换来源与目标时区' }).click();
   await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900));
   await page.screenshot({ path: join(output, 'timezone-native-dark.png'), scale: 'css' });
   expect(await page.evaluate(async () => (await window.tiboWatch!.getSnapshot()).settings)).toEqual(before);
   await page.getByRole('button', { name: '常规与启动', exact: true }).click();
 });

 test('retains native configuration and theme across restart', async () => {
   await nav('设置'); await page.getByLabel('检查间隔').selectOption('10');
   await expect(page.getByLabel('检查间隔')).toBeEnabled();
   await page.getByRole('button',{name:'切换到浅色模式'}).click();
   await app.close(); await launch();
   await expect(page.getByRole('heading',{name:'监测总览'})).toBeVisible();
   await expect(page.locator('.app')).toHaveAttribute('data-theme','light');
   await nav('设置'); await expect(page.getByLabel('检查间隔')).toHaveValue('10');
   await expect(page.getByRole('button',{name:'识别与状态'})).toHaveCount(0);
   await nav('通知');
   await expect(page.getByRole('switch',{name:'确认重置通知'})).not.toBeChecked();
   await expect(page.getByRole('button',{name:'预告声音已关闭'})).toBeVisible();
   await expect(page.getByText('one@example.com',{exact:true})).toBeVisible();
   await nav('总览');
   await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]!.setSize(1536,1024));
   await page.screenshot({path:join(output,'production-light-overview.png'), scale:'css'});
   await page.getByRole('button',{name:'切换到深色模式'}).click();
   expect(await page.locator('.app').evaluate(el=>getComputedStyle(el).getPropertyValue('--bg').trim())).toBe('#151619');
   expect(await page.locator('.app').evaluate(el=>getComputedStyle(el).getPropertyValue('--accent').trim())).toBe('#8ab4ff');
 });

 test('routes notification clicks and still closes to tray', async () => {
   await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]!.webContents.send('app:navigate-post','2083053000000000000'));
   await expect(page.getByRole('heading',{name:'动态收件箱'})).toBeVisible();
   await expect(page.getByLabel('动态原文')).toHaveText('Codex resets will continue tomorrow.');
   await page.getByRole('button',{name:'关闭',exact:true}).click();
   await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]!.isVisible())).toBe(false);
   await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]!.show());
   await expect(page.getByLabel('动态原文')).toBeVisible();
   expect(errors).toEqual([]);
 });
});

test('hidden startup still keeps the desktop window invisible', async () => {
 const userData=await mkdtemp(join(tmpdir(),'tibo-hidden-redesign-'));
 const executablePath=process.env.TIBO_WATCH_EXECUTABLE;
 const app=await electron.launch({...(executablePath?{executablePath}:{}),args:[...(executablePath?[]:['.']),'--hidden',`--user-data-dir=${userData}`],env:{...process.env,TIBO_WATCH_E2E:'1'}});
 try{
  const page=await app.firstWindow(); await expect(page.locator('.app')).toBeAttached();
  expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]!.isVisible())).toBe(false);
 }finally{await app.close();await rm(userData,{recursive:true,force:true});}
});

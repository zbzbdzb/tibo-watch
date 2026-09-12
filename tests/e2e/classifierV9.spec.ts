import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { AppDatabase } from '../../src/main/storage/database';
import type { MonitoredPost } from '../../src/shared/domain';
import corpus from '../fixtures/classifier-public-posts-2026-09-12.json';

test('upgrades v8 history in the native app and removes the seven decorative slogans', async () => {
  const userData = await mkdtemp(join(tmpdir(),'tibo-v9-ui-'));
  const database = new AppDatabase(join(userData,'tibo-watch.sqlite3'));
  database.updateSettings({baselineComplete:true,onboardingComplete:true,browserSourceEnabled:false,publicRssEnabled:false,
    emailEnabled:false,windowsConfirmedEnabled:false,windowsPreviewEnabled:false});
  for (const item of corpus.cases) {
    database.upsertPost(item.post as MonitoredPost);
    database.recordClassification(item.post.id,{level:'related',score:3,reasons:['old rules'],matchedTerms:['reset'],classifierVersion:'rules-v8'});
  }
  database.close();
  const executablePath = process.env.TIBO_WATCH_EXECUTABLE;
  const app = await electron.launch({...(executablePath?{executablePath}:{}),args:[...(executablePath?[]:['.']),`--user-data-dir=${userData}`],env:{...process.env,TIBO_WATCH_E2E:'1'}});
  try {
    const page = await app.firstWindow(), errors:string[]=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
    await page.emulateMedia({reducedMotion:'reduce'});
    await expect(page).toHaveTitle(/Tibo Watch/);
    expect(page.url()).toMatch(/^file:/);
    const nav = (name:string)=>page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name,exact:true}).click();
    await nav('动态收件箱');
    await expect(page.getByText('共 2 条记录')).toBeVisible();
    await expect(page.getByLabel('动态原文')).toHaveText('Reset all propagated. Sweet dreams.');
    await expect(page.locator('.reader-header')).toContainText('确认重置');
    await page.getByRole('tab',{name:/预告/}).click();
    await page.locator('.inbox-list .post-row').click();
    await expect(page.getByLabel('动态原文')).toContainText('a reset is also landing by midnight today.');
    await expect(page.locator('.reader-header')).toContainText('预告');
    await page.getByRole('tab',{name:/全部/}).click();
    const output = process.env.TIBO_WATCH_SCREENSHOT_DIR ?? tmpdir();
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]!.setSize(1536,1024));
    await page.screenshot({path:join(output,'v9-recognized-preview.png'),scale:'css'});
    for (const name of ['总览','动态收件箱','数据源','通知']) {
      await nav(name);
      await expect(page.getByText(/只关注重要的变化|每一条公告，都有|两条独立的采集路径|连接正常，不等于|即使不在电脑前|让重要的公告被听见/)).toHaveCount(0);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    }
    await page.screenshot({path:join(output,'v9-notifications-clean.png'),scale:'css'});
    await page.getByRole('button',{name:/送达记录/}).click();
    await expect(page.getByText('每一次提醒，都有迹可循')).toHaveCount(0);
    await nav('数据源');
    await page.getByRole('button',{name:'切换到浅色模式'}).click();
    await page.screenshot({path:join(output,'v9-sources-clean-light.png'),scale:'css'});
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]!.setSize(520,844));
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:join(output,'v9-sources-narrow.png'),scale:'css'});
    const snapshot = await page.evaluate(()=>window.tiboWatch!.getSnapshot());
    expect(snapshot.posts.every(item=>item.classification?.classifierVersion==='rules-v9')).toBe(true);
    expect(errors).toEqual([]);
  } finally { await app.close(); await rm(userData,{recursive:true,force:true}); }
});

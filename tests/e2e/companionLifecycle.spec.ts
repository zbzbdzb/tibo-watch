import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, expect, test, type BrowserContext, type Worker } from '@playwright/test';
import { ChromeCompanionBridge } from '../../src/main/sources/chromeCompanionBridge';

test('real collector reuses focused monitor tabs and completes repost/long-text timelines without a third tab', async () => {
  test.setTimeout(90_000);
  const temp = await mkdtemp(join(tmpdir(), 'tibo-companion-lifecycle-'));
  const bridge = new ChromeCompanionBridge({ port: 0 });
  let browser: BrowserContext | undefined;
  try {
    await bridge.start();
    const extensionDir = join(temp, 'extension');
    await mkdir(extensionDir);
    const manifest = JSON.parse(await readFile('chrome-extension/manifest.json', 'utf8'));
    manifest.host_permissions = ['https://x.com/*', 'http://127.0.0.1/*'];
    await writeFile(join(extensionDir, 'manifest.json'), JSON.stringify(manifest));
    // Only redirect the bridge to an ephemeral test port. The collector and all
    // tab/readiness logic are the real shipped module, not a mock implementation.
    const script = (await readFile('chrome-extension/service-worker.js', 'utf8')).replace('http://127.0.0.1:47652', bridge.url());
    await writeFile(join(extensionDir, 'service-worker.js'), script + '\nglobalThis.testScan = ensureMonitorTabs;\n');
    browser = await chromium.launchPersistentContext(join(temp, 'profile'), {
      ...(process.env.TIBO_WATCH_CHROMIUM ? { executablePath: process.env.TIBO_WATCH_CHROMIUM } : { channel: 'chromium' }),
      headless: true, args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
    });
    const card = (id: string, text: string, extra = '', author = 'thsottiaux') =>
      `<article data-testid="tweet"><div data-testid="User-Name">@${author}</div><a href="/${author}/status/${id}"><time datetime="2026-09-07T00:00:00Z"></time></a><div data-testid="tweetText">${text}</div>${extra}</article>`;
    // No real X request, login, cookie or account data is involved.
    await browser.route('https://x.com/**', route => {
      const path = new URL(route.request().url()).pathname;
      const body = path.includes('/status/') ? card('303', 'Full synthetic long text. Codex reset tomorrow.') :
        path.endsWith('/with_replies') ? card('303', 'Short...', '<button>Show more</button>') :
          card('100', 'Pinned.', '<div data-testid="socialContext">Pinned</div>') +
          card('202', 'Skipped repost.', '<div data-testid="socialContext">Tibo reposted</div>', 'other');
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><title>Tibo test timeline</title><main>${body}<div role="progressbar"></div></main>` });
    });
    const posts = await browser.newPage(); await posts.goto('https://x.com/thsottiaux');
    const replies = await browser.newPage(); await replies.goto('https://x.com/thsottiaux/with_replies');
    await posts.bringToFront();
    let worker: Worker = browser.serviceWorkers()[0] ?? await browser.waitForEvent('serviceworker');
    const scan = async () => worker.evaluate(() => (globalThis as unknown as { testScan: () => Promise<void> }).testScan());
    bridge.setMonitoringEnabled(true);
    await scan();
    expect(bridge.store.collectionStatus().state).toBe('online');
    expect(bridge.store.diagnostics().every(page => page.extensionVersion === '0.2.16')).toBe(true);
    expect(bridge.readPosts().some(post => post.id === '202')).toBe(false);
    expect(bridge.readPosts().find(post => post.id === '303')?.text).toContain('Full synthetic long text');
    const monitored = () => browser!.pages().filter(page => page.url().startsWith('https://x.com/'));
    expect(monitored()).toHaveLength(2);
    await replies.bringToFront();
    await scan();
    expect(monitored()).toHaveLength(2);
    expect(bridge.store.collectionStatus().state).toBe('online');
    expect(monitored().map(page => page.url()).sort()).toEqual(['https://x.com/thsottiaux', 'https://x.com/thsottiaux/with_replies']);
    // Reacquire the same real worker after focus changes; additional scans must
    // not create another selected view or a transient detail tab.
    worker = browser.serviceWorkers()[0]!;
    const pageCount = browser.pages().length;
    await scan();
    expect(browser.pages()).toHaveLength(pageCount);
  } finally {
    await browser?.close(); await bridge.stop();
    await rm(temp, { recursive: true, force: true });
  }
});

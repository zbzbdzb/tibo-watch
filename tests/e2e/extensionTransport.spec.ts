import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { chromium, expect, test, type BrowserContext } from '@playwright/test';

import {
  ChromeCompanionBridge, CHROME_COMPANION_EXTENSION_ID,
} from '../../src/main/sources/chromeCompanionBridge';

// This name exists only in the real extension worker evaluate callbacks below.
declare const chrome: { runtime: { id: string } };

test('real MV3 worker health GET and authenticated POST reach the loopback bridge', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'tibo-watch-extension-transport-'));
  const bridge = new ChromeCompanionBridge({ port: 0 });
  let browser: BrowserContext | undefined;
  try {
    await bridge.start();
    bridge.setMonitoringEnabled(true);
    const extensionDir = resolve('tests/fixtures/companion-transport');
    const executablePath = process.env.TIBO_WATCH_CHROMIUM;
    // Use a fresh profile and Chromium's extension-capable headless mode. If no
    // executable override/browser installation exists, fail with Playwright's
    // actionable installation error instead of silently skipping this coverage.
    browser = await chromium.launchPersistentContext(userDataDir, {
      ...(executablePath ? { executablePath } : { channel: 'chromium' }),
      headless: true,
      args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
    });
    const worker = browser.serviceWorkers()[0] ?? await browser.waitForEvent('serviceworker');
    const result = await worker.evaluate(async (url) => {
      // Do not manufacture an Origin header here. A real extension GET omits it;
      // its POST supplies chrome-extension://<id>. HTTP mocks masked this bug.
      const headers = { 'X-Tibo-Watch-Extension': chrome.runtime.id };
      const health = await fetch(`${url}/health`, {
        method: 'GET', credentials: 'omit', cache: 'no-store', headers,
      });
      if (!health.ok) return { id: chrome.runtime.id, health: health.status, posts: [] };
      const permission = await health.json() as { generation: number };
      const runId = crypto.randomUUID();
      const submitted: number[] = [];
      for (const view of ['posts', 'replies'] as const) {
        const response = await fetch(`${url}/posts`, {
          method: 'POST', credentials: 'omit',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            protocolVersion: 2, generation: permission.generation, runId,
            diagnostics: { extensionVersion: '0.2.16', collectorRevision: 1, reason: 'stable_timeline', samples: 5 },
            pageUrl: `https://x.com/thsottiaux${view === 'replies' ? '/with_replies' : ''}`,
            view, checkedAt: new Date().toISOString(), result: 'ready',
            posts: [{
              id: '123', authorHandle: 'thsottiaux', text: 'Synthetic transport test only',
              createdAt: new Date().toISOString(), url: 'https://x.com/thsottiaux/status/123',
              kind: 'original', quotedText: null, sourceIds: ['x-browser'],
            }],
          }),
        });
        submitted.push(response.status);
      }
      return { id: chrome.runtime.id, health: health.status, posts: submitted };
    }, bridge.url());

    expect(result).toEqual({ id: CHROME_COMPANION_EXTENSION_ID, health: 200, posts: [204, 204] });
    expect(bridge.store.collectionStatus()).toEqual({ state: 'online', errorCode: null });
    expect(bridge.readPosts()).toHaveLength(1);

    bridge.setMonitoringEnabled(false);
    const disabled = await worker.evaluate(async (url) => {
      const response = await fetch(`${url}/health`, {
        credentials: 'omit', headers: { 'X-Tibo-Watch-Extension': chrome.runtime.id },
      });
      return { status: response.status, permission: await response.json() };
    }, bridge.url());
    expect(disabled.status).toBe(409);
    expect(disabled.permission).toMatchObject({ collectionEnabled: false, protocolVersion: 2 });
    expect(bridge.store.collectionStatus().state).toBe('disabled');
  } finally {
    await browser?.close();
    await bridge.stop();
    // The only removed directory is the isolated test profile created above.
    await rm(userDataDir, { recursive: true, force: true });
  }
});

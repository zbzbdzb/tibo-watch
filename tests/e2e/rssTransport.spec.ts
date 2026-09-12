import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

test('real Electron RSS transport uses its proxy and preserves credential, cache, redirect and abort controls', async () => {
  const requests: Array<{ url: string; cookie: string | undefined }> = [];
  const proxy = createServer((request, response) => {
    requests.push({ url: request.url!, cookie: request.headers.cookie });
    if (request.url?.endsWith('/slow')) return;
    if (request.url?.endsWith('/redirect')) {
      response.writeHead(302, { location: 'http://rss-proxy.invalid/must-not-follow' }).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/rss+xml', 'cache-control': 'public, max-age=3600' });
    response.end(`<rss><channel><item><title>Test ${requests.length}</title><link>https://x.com/thsottiaux/status/101</link><pubDate>Sat, 12 Sep 2026 08:00:00 GMT</pubDate></item></channel></rss>`);
  });
  await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
  const address = proxy.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture proxy address');
  const profile = await mkdtemp(join(tmpdir(), 'tibo-watch-rss-proxy-'));
  let instance: ElectronApplication | undefined;
  try {
    const executablePath = process.env.TIBO_WATCH_EXECUTABLE;
    const args = [`--user-data-dir=${profile}`, '--hidden'];
    instance = await electron.launch({
      ...(executablePath ? { executablePath } : {}),
      args: executablePath ? args : ['.', ...args],
      env: { ...process.env, TIBO_WATCH_E2E: '1' },
    });
    const result = await instance.evaluate(async ({ app, session }, port) => {
      // Playwright's Electron evaluation context has no dynamic-import hook.
      const { createRequire } = process.getBuiltinModule('module');
      const load = createRequire(`${app.getAppPath()}/package.json`);
      const { createSystemRssFetcher } = load('./dist/main/sources/rssTransport.js') as typeof import('../../src/main/sources/rssTransport');
      const { parseNitterRss } = load('./dist/main/sources/publicRssSource.js') as typeof import('../../src/main/sources/publicRssSource');
      const rssSession = session.fromPartition('rss-proxy-test', { cache: false });
      // Only synthetic test-profile state; never reads Chrome or live app cookies.
      await rssSession.cookies.set({ url: 'http://rss-proxy.invalid', name: 'synthetic', value: 'must-not-send' });
      const modes: string[] = [];
      const fetcher = createSystemRssFetcher(() => ({
        fetch: rssSession.fetch.bind(rssSession),
        setProxy: async config => {
          modes.push(config.mode!);
          // Assert production requested system mode; use a deterministic local
          // proxy fixture without changing the user's Windows proxy settings.
          await rssSession.setProxy({ mode: 'fixed_servers', proxyRules: `127.0.0.1:${port}` });
        },
      }));
      const url = 'http://rss-proxy.invalid/thsottiaux/with_replies/rss';
      const first = parseNitterRss(await (await fetcher(url)).text(), 'public-rss');
      const second = parseNitterRss(await (await fetcher(url)).text(), 'public-rss');
      let redirectBlocked: boolean;
      try {
        const redirect = await fetcher('http://rss-proxy.invalid/redirect');
        redirectBlocked = redirect.status === 302;
        await redirect.body?.cancel();
      } catch (error) {
        // Chromium may reject manual redirects instead of exposing the 302.
        if (!(error instanceof Error) || !/Redirect was cancelled/.test(error.message)) throw error;
        redirectBlocked = true;
      }
      let aborted = false;
      try {
        await fetcher('http://rss-proxy.invalid/slow', { signal: AbortSignal.timeout(200) });
      } catch { aborted = true; }
      await rssSession.closeAllConnections();
      return { modes, first: first[0]?.text, second: second[0]?.text, redirectBlocked, aborted };
    }, address.port);
    expect(result).toEqual({ modes: ['system'], first: 'Test 1', second: 'Test 2', redirectBlocked: true, aborted: true });
    expect(requests.filter(request => request.url.endsWith('/rss'))).toHaveLength(2);
    expect(requests.some(request => request.url.endsWith('/must-not-follow'))).toBe(false);
    expect(requests.every(request => !request.cookie)).toBe(true);
  } finally {
    await instance?.close();
    proxy.closeAllConnections();
    await new Promise<void>((resolve, reject) => proxy.close(error => error ? reject(error) : resolve()));
    assert.equal(dirname(resolve(profile)), resolve(tmpdir()), 'Profile must remain in the test temp directory');
    assert.ok(basename(profile).startsWith('tibo-watch-rss-proxy-'));
    await rm(profile, { recursive: true, force: true });
  }
});

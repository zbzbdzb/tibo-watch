import { request, type IncomingHttpHeaders, type OutgoingHttpHeaders } from 'node:http';
import {
  ChromeCompanionBridge, CHROME_COMPANION_ORIGIN, CHROME_COMPANION_EXTENSION_ID,
} from '../../src/main/sources/chromeCompanionBridge';

const validPayload = {
  pageUrl: 'https://x.com/thsottiaux/with_replies',
  posts: [{
    id: '401', authorHandle: 'thsottiaux', text: 'Codex reset is coming.',
    createdAt: '2026-08-02T02:00:00.000Z', url: 'https://x.com/thsottiaux/status/401',
    kind: 'original', quotedText: null, sourceIds: ['x-browser'],
  }],
};
const headers = {
  'Content-Type': 'application/json', Origin: CHROME_COMPANION_ORIGIN,
  'X-Tibo-Watch-Extension': CHROME_COMPANION_EXTENSION_ID,
};

describe('Chrome companion loopback bridge', () => {
  test('accepts Chromium extension health GET without Origin but grants no CORS access', async () => {
    await withBridge(async (bridge) => {
      // Real MV3 worker GET fetch omits Origin even with an extension header;
      // its POST fetch does send chrome-extension://<id>.
      const workerHeaders = { 'X-Tibo-Watch-Extension': CHROME_COMPANION_EXTENSION_ID };
      const disabled = await requestBridge(`${bridge.url()}/health`, { method: 'GET', headers: workerHeaders });
      expect(disabled.status).toBe(409);
      expect(JSON.parse(disabled.body)).toMatchObject({ ok: true, collectionEnabled: false, protocolVersion: 2 });
      bridge.setMonitoringEnabled(true);
      const enabled = await requestBridge(`${bridge.url()}/health`, { method: 'GET', headers: workerHeaders });
      expect(enabled.status).toBe(200);
      expect(JSON.parse(enabled.body)).toMatchObject({ ok: true, collectionEnabled: true, protocolVersion: 2 });
      expect(enabled.headers['access-control-allow-origin']).toBeUndefined();
      expect(enabled.headers['access-control-allow-credentials']).toBeUndefined();
      expect(enabled.headers['cache-control']).toBe('no-store');
      expect(bridge.store.collectionStatus().errorCode).toBe('X_COMPANION_WAITING');
    });
  });

  test('keeps the absent-Origin exception restricted to the fixed-header read-only health probe', async () => {
    await withBridge(async (bridge) => {
      bridge.setMonitoringEnabled(true);
      const workerHeaders = { 'X-Tibo-Watch-Extension': CHROME_COMPANION_EXTENSION_ID };
      for (const requestHeaders of [
        {}, { 'X-Tibo-Watch-Extension': 'another-extension' },
        { ...workerHeaders, Origin: 'null' }, { ...workerHeaders, Origin: 'https://x.com' },
        { ...workerHeaders, Origin: 'chrome-extension://another-extension' },
      ]) {
        const rejected = await requestBridge(`${bridge.url()}/health`, { method: 'GET', headers: requestHeaders });
        expect(rejected.status).toBe(403);
        expect(rejected.headers['access-control-allow-origin']).toBeUndefined();
      }
      for (const [method, path] of [['POST', '/posts'], ['POST', '/health'], ['OPTIONS', '/health'], ['GET', '/posts']]) {
        expect((await requestBridge(`${bridge.url()}${path}`, {
          method: method!, headers: workerHeaders, ...(method === 'POST' ? { body: JSON.stringify(validPayload) } : {}),
        })).status).toBe(403);
      }
      expect(bridge.readPosts()).toEqual([]);
    });
  });

  test.each(['sync', 'async'])('notifies live UI after ingestion and toggles despite a failing %s callback', async (failure) => {
    const changed = vi.fn(() => {
      if (failure === 'sync') throw new Error('UI unavailable');
      return Promise.reject(new Error('UI unavailable'));
    });
    const bridge = new ChromeCompanionBridge({ port: 0, onCollectionChanged: changed });
    await bridge.start();
    try {
      bridge.setMonitoringEnabled(true);
      expect(changed).toHaveBeenCalledTimes(1);
      expect((await push(bridge, validPayload)).status).toBe(204);
      expect(changed).toHaveBeenCalledTimes(2);
      bridge.setMonitoringEnabled(false);
      expect(changed).toHaveBeenCalledTimes(3);
      expect((await push(bridge, validPayload)).status).toBe(409);
      expect(changed).toHaveBeenCalledTimes(3);
    } finally { await bridge.stop(); }
  });

  test('defaults disabled and reports JSON permission/generation only to the fixed extension', async () => {
    await withBridge(async (bridge) => {
      const before = await health(bridge);
      expect(before).toMatchObject({ ok: true, collectionEnabled: false, protocolVersion: 2 });
      const legacyProbe = await requestBridge(`${bridge.url()}/health`, { method: 'GET', headers });
      expect(legacyProbe.status).toBe(409);
      expect(legacyProbe.status >= 200 && legacyProbe.status < 300).toBe(false);
      expect(bridge.isConnected()).toBe(false);
      expect((await push(bridge, validPayload)).status).toBe(409);
      bridge.setMonitoringEnabled(true);
      const after = await health(bridge);
      expect(after.collectionEnabled).toBe(true);
      expect(after.generation).toBeGreaterThan(before.generation);
      expect((await requestBridge(`${bridge.url()}/health`, { method: 'GET', headers: { ...headers, Origin: 'https://x.com' } })).status).toBe(403);
      expect((await requestBridge(`${bridge.url()}/health`, { method: 'GET', headers: { Origin: CHROME_COMPANION_ORIGIN } })).status).toBe(403);
    });
  });

  test('accepts legacy batches as needs-refresh without marking both pages healthy', async () => {
    await withBridge(async (bridge) => {
      bridge.setMonitoringEnabled(true);
      expect((await push(bridge, validPayload)).status).toBe(204);
      expect(bridge.isConnected()).toBe(false);
      expect(bridge.store.collectionStatus().errorCode).toBe('X_COMPANION_LEGACY_NEEDS_REFRESH');
      expect(bridge.readPosts()).toEqual([]);
    });
  });

  test('requires both valid pages and revokes an in-flight generation across disable/re-enable', async () => {
    await withBridge(async (bridge) => {
      bridge.setMonitoringEnabled(true);
      const { generation } = await health(bridge);
      const reply = current(generation);
      expect((await push(bridge, reply)).status).toBe(204);
      expect(bridge.isConnected()).toBe(false);
      expect((await push(bridge, { ...reply, pageUrl: 'https://x.com/thsottiaux', view: 'posts' })).status).toBe(204);
      expect(bridge.isConnected()).toBe(true);
      bridge.setMonitoringEnabled(false);
      bridge.store.clear();
      expect((await push(bridge, reply)).status).toBe(409);
      expect((await push(bridge, validPayload)).status).toBe(409);
      bridge.setMonitoringEnabled(true);
      expect((await push(bridge, reply)).status).toBe(409);
      expect(bridge.readPosts()).toEqual([]);
      expect(bridge.isConnected()).toBe(false);
    });
  });

  test('rejects malformed authors, mismatched canonical IDs, view URLs, false ready and extra protocol fields', async () => {
    await withBridge(async (bridge) => {
      bridge.setMonitoringEnabled(true);
      const { generation } = await health(bridge);
      const payload = current(generation);
      for (const invalid of [
        { ...payload, posts: [{ ...validPayload.posts[0], authorHandle: 'someone' }] },
        { ...payload, posts: [{ ...validPayload.posts[0], id: '999' }] },
        { ...payload, view: 'posts' },
        { ...payload, posts: [] },
        { ...payload, cookies: 'must never be accepted' },
        { ...payload, protocolVersion: 1 },
        { ...payload, runId: '' },
      ]) expect((await push(bridge, invalid)).status).toBe(400);
      expect((await push(bridge, { ...payload, checkedAt: new Date(Date.now() + 120_000).toISOString() })).status).toBe(409);
      expect(bridge.readPosts()).toEqual([]);
    });
  });

  test('rejects foreign origins and bodies larger than 256 KiB', async () => {
    await withBridge(async (bridge) => {
      bridge.setMonitoringEnabled(true);
      expect((await requestBridge(`${bridge.url()}/posts`, {
        method: 'POST', headers: { ...headers, Origin: 'https://x.com' }, body: JSON.stringify(validPayload),
      })).status).toBe(403);
      expect((await push(bridge, { ...validPayload, padding: 'x'.repeat(262_144) })).status).toBe(413);
      expect(bridge.readPosts()).toEqual([]);
    });
  });

  test('allows fixed-origin CORS preflight without credentials', async () => {
    await withBridge(async (bridge) => {
      const response = await requestBridge(`${bridge.url()}/posts`, {
        method: 'OPTIONS', headers: { Origin: CHROME_COMPANION_ORIGIN },
      });
      expect(response.status).toBe(204);
      expect(response.headers['access-control-allow-origin']).toBe(CHROME_COMPANION_ORIGIN);
      expect(response.headers['access-control-allow-credentials']).toBeUndefined();
    });
  });
});

function current(generation: number) {
  return { ...validPayload, protocolVersion: 2, generation,
    diagnostics: { extensionVersion: '0.2.16', collectorRevision: 1, reason: 'stable_timeline', samples: 5 },
    runId: 'cfcbce1e-783e-45c5-aee8-98e848ff89a6', view: 'replies',
    checkedAt: new Date().toISOString(), result: 'ready' };
}

async function withBridge(test: (bridge: ChromeCompanionBridge) => Promise<void>) {
  const bridge = new ChromeCompanionBridge({ port: 0 });
  await bridge.start();
  try { await test(bridge); } finally { await bridge.stop(); }
}

async function health(bridge: ChromeCompanionBridge): Promise<{ ok: boolean; collectionEnabled: boolean; protocolVersion: number; generation: number }> {
  const response = await requestBridge(`${bridge.url()}/health`, { method: 'GET', headers });
  const parsed = JSON.parse(response.body);
  expect(response.status).toBe(parsed.collectionEnabled ? 200 : 409);
  return parsed;
}

function push(bridge: ChromeCompanionBridge, payload: unknown) {
  return requestBridge(`${bridge.url()}/posts`, { method: 'POST', headers, body: JSON.stringify(payload) });
}

function requestBridge(url: string, options: { method: string; headers: OutgoingHttpHeaders; body?: string }):
Promise<{ status: number; headers: IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const bridgeRequest = request(url, { method: options.method, headers: options.headers }, (response) => {
      let body = '';
      response.on('data', (chunk) => { body += String(chunk); });
      response.once('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body }));
    });
    bridgeRequest.once('error', reject);
    bridgeRequest.end(options.body);
  });
}

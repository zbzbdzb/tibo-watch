import { ChromeCompanionSession, ChromeCompanionStore } from '../../src/main/sources/chromeCompanionSession';
import { XBrowserSource } from '../../src/main/sources/xBrowserSource';
import type { ChromeCompanionPayload } from '../../src/main/sources/chromeCompanionBridge';

const runId = 'cfcbce1e-783e-45c5-aee8-98e848ff89a6';
const basePost = {
  id: '501', url: 'https://x.com/thsottiaux/status/501',
  authorHandle: 'thsottiaux', text: 'Visible post',
  createdAt: '2026-08-02T02:00:00.000Z', kind: 'original', quotedText: null,
  sourceIds: ['x-browser'],
} as const;

function payload(view: 'posts' | 'replies', now: number, result: 'ready' | 'empty' | 'loading' | 'error' | 'needs_login' = 'ready'): ChromeCompanionPayload {
  return {
    protocolVersion: 2, generation: 1, runId, view,
    pageUrl: view === 'posts' ? 'https://x.com/thsottiaux' : 'https://x.com/thsottiaux/with_replies',
    checkedAt: new Date(now).toISOString(), result,
    posts: result === 'ready' ? [{ ...basePost, sourceIds: ['x-browser'] }] : [],
  };
}

describe('Chrome companion session collection truth', () => {
  test('requires fresh success from both pages in the same run', async () => {
    let now = Date.parse('2026-09-05T00:00:00Z');
    const store = new ChromeCompanionStore({ now: () => now, freshnessMs: 600_000 });
    const session = new ChromeCompanionSession(store, () => undefined);
    store.ingest(payload('posts', now));
    expect(await session.isLoggedIn()).toBe(false);
    expect(store.collectionStatus().errorCode).toContain('REPLIES_WAITING');
    store.ingest(payload('replies', now));
    expect(await session.isLoggedIn()).toBe(true);
    now += 600_001;
    store.ingest({ ...payload('posts', now), runId: '4d658550-55cb-4731-96af-4cf6657b599a' });
    expect(await session.isLoggedIn()).toBe(false);
    expect(store.collectionStatus().errorCode).toContain('REPLIES_STALE');
  });

  test.each(['empty', 'loading', 'error'] as const)('does not make old cached posts healthy after a %s batch', (result) => {
    const now = Date.parse('2026-09-05T00:00:00Z');
    const store = new ChromeCompanionStore({ now: () => now });
    store.ingest(payload('posts', now));
    store.ingest(payload('replies', now));
    expect(store.isConnected()).toBe(true);
    store.ingest(payload('posts', now, result));
    expect(store.isConnected()).toBe(false);
    expect(store.collectionStatus()).toEqual({ state: 'stale', errorCode: `X_COLLECTION_POSTS_${result.toUpperCase()}` });
    expect(store.readPosts()).toHaveLength(1);
  });

  test('legacy empty and nonempty batches remain needs-refresh, never claim both pages succeeded', () => {
    const store = new ChromeCompanionStore();
    store.ingest({ pageUrl: 'https://x.com/thsottiaux', posts: [{ ...basePost, sourceIds: ['x-browser'] }] });
    store.ingest({ pageUrl: 'https://x.com/thsottiaux/with_replies', posts: [] });
    expect(store.isConnected()).toBe(false);
    expect(store.collectionStatus()).toEqual({ state: 'stale', errorCode: 'X_COMPANION_LEGACY_NEEDS_REFRESH' });
    expect(store.readPosts()).toHaveLength(0);
  });

  test('rejects empty ready payloads and mismatched view URLs even through direct ingestion', () => {
    const store = new ChromeCompanionStore();
    expect(() => store.ingest({ ...payload('posts', Date.now()), posts: [] })).toThrow();
    expect(() => store.ingest({ ...payload('posts', Date.now()), view: 'replies' } as ChromeCompanionPayload)).toThrow();
  });

  test('logout revokes collection before clearing and subsequent pushes cannot reactivate it', async () => {
    const store = new ChromeCompanionStore();
    store.ingest(payload('posts', Date.now()));
    let revoked = false;
    let setupOpened = false;
    const session = new ChromeCompanionSession(store, () => { setupOpened = true; }, () => { revoked = true; });
    session.openLogin();
    expect(setupOpened).toBe(true);
    await session.logout();
    expect(revoked).toBe(true);
    store.ingest(payload('replies', Date.now()));
    expect(store.readPosts()).toEqual([]);
    expect(await session.isLoggedIn()).toBe(false);
    expect(store.collectionStatus().state).toBe('disabled');
  });

  test('browser source exposes degraded diagnostics while preserving verified posts', async () => {
    const now = Date.now();
    const store = new ChromeCompanionStore();
    store.ingest(payload('posts', now));
    store.ingest(payload('replies', now, 'needs_login'));
    const session = new ChromeCompanionSession(store, () => undefined);
    const source = new XBrowserSource(session, () => true);
    expect(await source.check({ checkedAt: new Date(now).toISOString(), signal: new AbortController().signal }))
      .toMatchObject({ state: 'needs_login', errorCode: 'X_SESSION_EXPIRED', posts: [basePost] });
  });

  test('checks fresh collection timestamps rather than newly arriving old captures', () => {
    const now = Date.now();
    const store = new ChromeCompanionStore({ now: () => now, freshnessMs: 10 });
    store.ingest(payload('posts', now - 11));
    store.ingest(payload('replies', now - 11));
    expect(store.isConnected()).toBe(false);
    expect(store.collectionStatus().errorCode).toContain('STALE');
  });

  test('does not reuse an older successful page as success for a different polling run', () => {
    const now = Date.now();
    const store = new ChromeCompanionStore();
    store.ingest(payload('posts', now));
    store.ingest(payload('replies', now));
    store.ingest({ ...payload('posts', now), runId: '4d658550-55cb-4731-96af-4cf6657b599a' });
    expect(store.collectionStatus()).toEqual({ state: 'stale', errorCode: 'X_COLLECTION_PARTIAL_RUN' });
  });

  test('merges longest body and richest quote independently and commutatively', () => {
    const original = { ...basePost, text: 'A longer primary text about Codex.', sourceIds: ['x-browser'] as ['x-browser'] };
    const quote = { ...basePost, text: 'Short body', quotedText: 'Full quoted context.', kind: 'quote' as const, sourceIds: ['x-browser'] as ['x-browser'] };
    const results = [[original, quote], [quote, original]].map((posts) => {
      const store = new ChromeCompanionStore();
      for (const post of posts) store.ingest({ ...payload('posts', Date.now()), posts: [post] });
      return store.readPosts();
    });
    expect(results[0]).toEqual(results[1]);
    expect(results[0]).toEqual([expect.objectContaining({ text: original.text, quotedText: quote.quotedText, kind: 'quote' })]);
  });

  test('never inserts a legacy wrong-quote post and recovers only after current-protocol collection on both pages', () => {
    const store = new ChromeCompanionStore();
    const now = Date.now();
    store.ingest({ pageUrl: 'https://x.com/thsottiaux', posts: [{ ...basePost, text: 'Foreign primary claiming a reset.', sourceIds: ['x-browser'] }] });
    expect(store.readPosts()).toEqual([]);
    store.ingest(payload('posts', now));
    store.ingest(payload('replies', now));
    expect(store.isConnected()).toBe(true);
    expect(store.readPosts()[0]?.text).toBe(basePost.text);
  });

  test('first current-protocol capture replaces obsolete needs-reload with accurate per-page readiness', () => {
    const store = new ChromeCompanionStore();
    const now = Date.now();
    store.ingest({ pageUrl: 'https://x.com/thsottiaux', posts: [] });
    store.ingest({ pageUrl: 'https://x.com/thsottiaux/with_replies', posts: [] });
    expect(store.collectionStatus().errorCode).toBe('X_COMPANION_LEGACY_NEEDS_REFRESH');
    store.ingest(payload('posts', now, 'error'));
    expect(store.collectionStatus()).toEqual({ state: 'stale', errorCode: 'X_COLLECTION_POSTS_ERROR_REPLIES_WAITING' });
  });

  test('a delayed legacy request cannot undo a verified current-protocol reload', () => {
    const store = new ChromeCompanionStore();
    const now = Date.now();
    store.ingest(payload('posts', now));
    store.ingest({ pageUrl: 'https://x.com/thsottiaux/with_replies', posts: [] });
    expect(store.collectionStatus().errorCode).toContain('REPLIES_WAITING');
    store.ingest(payload('replies', now));
    store.ingest({ pageUrl: 'https://x.com/thsottiaux', posts: [] });
    expect(store.isConnected()).toBe(true);
    expect(store.readPosts()).toEqual([basePost]);
  });

  test.each(['clear', 'reenable'])('legacy protocol detection restarts after %s', (action) => {
    const store = new ChromeCompanionStore();
    store.ingest(payload('posts', Date.now()));
    if (action === 'clear') store.clear();
    else {
      store.setMonitoringEnabled(false);
      store.setMonitoringEnabled(true);
    }
    store.ingest({ pageUrl: 'https://x.com/thsottiaux', posts: [] });
    expect(store.collectionStatus().errorCode).toBe('X_COMPANION_LEGACY_NEEDS_REFRESH');
  });
});

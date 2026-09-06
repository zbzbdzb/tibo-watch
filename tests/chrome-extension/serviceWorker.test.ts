import { JSDOM } from 'jsdom';

type Post = { id: string; text: string; [key: string]: unknown };
type Snapshot = { posts: Post[]; expandableIds: string[]; result: string; hasUnpinned: boolean; loading: boolean };
interface WorkerModule {
  collectVisiblePosts(document: Document): Post[];
  findExpandablePostIds(document: Document): string[];
  captureTimeline(advance: boolean, expectedUrl: string | null, document: Document): Snapshot;
  expandLongPosts(posts: Post[], ids: string[]): Promise<Post[]>;
  ensureMonitorTabs(force?: boolean): Promise<void>;
}
const POSTS_URL = 'https://x.com/thsottiaux';
const REPLIES_URL = `${POSTS_URL}/with_replies`;
const OWNED_KEY = 'tiboWatchOwnedTabsV1';
const LAST_SCAN_KEY = 'tiboWatchLastCompletedScanV2';

async function loadWorker(): Promise<WorkerModule> {
  const url = new URL('../../chrome-extension/service-worker.js', import.meta.url);
  url.searchParams.set('test', `${Date.now()}-${Math.random()}`);
  return import(url.href) as Promise<WorkerModule>;
}

function article(id = '301', text = 'Codex limits reset now.', extra = '', author = 'thsottiaux') {
  return `<article data-testid="tweet"><div data-testid="User-Name">Author @${author}</div>
    <a href="/${author}/status/${id}"><time datetime="2026-09-04T00:00:00Z"></time></a>
    <div data-testid="tweetText">${text}</div>${extra}</article>`;
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('actual Chrome companion DOM parser', () => {
  test('preserves originals, own replies and quotes, while ignoring pure reposts and foreign primary posts', async () => {
    const worker = await loadWorker();
    const dom = new JSDOM(article() + article('302', 'Tomorrow too.', '<div>Replying to @openai</div>') +
      article('303', 'This is the plan.', '<div data-testid="quoteTweet"><div data-testid="tweetText">Usage context</div></div>') +
      article('304', 'Repost', '<div data-testid="socialContext">Tibo reposted</div>') + article('305', 'Foreign', '', 'someone'));
    expect(worker.collectVisiblePosts(dom.window.document)).toEqual([
      expect.objectContaining({ id: '301', kind: 'original', text: 'Codex limits reset now.', quotedText: null }),
      expect.objectContaining({ id: '302', kind: 'reply', text: 'Tomorrow too.' }),
      expect.objectContaining({ id: '303', kind: 'quote', quotedText: 'Usage context' }),
    ]);
  });

  test.each(['data-testid="quoteTweet"', 'role="link" tabindex="0"'])('rejects foreign primary reset text quoting Tibo (%s)', async (attributes) => {
    const worker = await loadWorker();
    const dom = new JSDOM(article('900', 'We will reset all Codex limits tomorrow.',
      `<button>Show more</button><div ${attributes}>${article('899', 'Small product update.')}</div>`, 'someone'));
    expect(worker.collectVisiblePosts(dom.window.document)).toEqual([]);
    expect(worker.findExpandablePostIds(dom.window.document)).toEqual([]);
  });

  test('uses only primary timestamps and controls even if the quoted Tibo link occurs first', async () => {
    const worker = await loadWorker();
    const dom = new JSDOM(`<article data-testid="tweet">
      <div data-testid="User-Name">Tibo @thsottiaux</div><div data-testid="tweetText">Worth reading.</div>
      <div data-testid="quoteTweet"><div>Replying to @other</div><button>Show more</button>
        <div data-testid="tweetText">Quoted reset.</div><a href="/thsottiaux/status/899"><time datetime="2026-09-03T00:00:00Z"></time></a></div>
      <button data-testid="reply" aria-label="Reply"></button>
      <a href="/thsottiaux/status/900"><time datetime="2026-09-04T00:00:00Z"></time></a></article>`);
    expect(worker.collectVisiblePosts(dom.window.document)).toEqual([expect.objectContaining({
      id: '900', kind: 'quote', text: 'Worth reading.', quotedText: 'Quoted reset.',
    })]);
    expect(worker.findExpandablePostIds(dom.window.document)).toEqual([]);
  });

  test.each([
    ['<div role="progressbar"></div>', POSTS_URL, 'loading'],
    ['<div data-testid="emptyState">No posts yet</div>', POSTS_URL, 'empty'],
    ['<div role="alert">Something went wrong. Try again.</div>', POSTS_URL, 'error'],
    ['<input autocomplete="username">', 'https://x.com/i/flow/login', 'needs_login'],
  ])('reports %s without claiming ready', async (html, url, result) => {
    const worker = await loadWorker();
    const dom = new JSDOM(html, { url });
    expect(worker.captureTimeline(false, POSTS_URL, dom.window.document).result).toBe(result);
  });
});

describe('actual worker lifecycle in synthetic browser contexts', () => {
  test('worker bootstrap only checks permission; offline/disabled startup and alarms cannot touch tabs', async () => {
    const fixture = browserFixture();
    fixture.enabled = false;
    const worker = await loadWorker();
    expect(fixture.fetcher).toHaveBeenCalled();
    expect(fixture.query).not.toHaveBeenCalled();
    fixture.startup[0]?.();
    fixture.alarms[0]?.({ name: 'tibo-watch-check' });
    await worker.ensureMonitorTabs();
    expect(fixture.query).not.toHaveBeenCalled();
    expect(fixture.created).toEqual([]);
    fixture.offline = true;
    fixture.enabled = true;
    await worker.ensureMonitorTabs();
    expect(fixture.query).not.toHaveBeenCalled();
    // No tab-complete listener is installed: navigation completion cannot bypass a lease.
    expect(fixture.updated).toHaveLength(0);
  });

  test('immediately bootstraps a fresh worker without waiting for install or a five-minute alarm', async () => {
    vi.useFakeTimers();
    const fixture = browserFixture();
    delete fixture.local[LAST_SCAN_KEY];
    const worker = await loadWorker();
    const bootstrap = worker.ensureMonitorTabs(false);
    await vi.runAllTimersAsync();
    await bootstrap;
    expect(fixture.submissions).toHaveLength(2);
    expect(fixture.local[LAST_SCAN_KEY]).toMatchObject({ generation: fixture.generation, version: '0.2.13' });
  });

  test('ordinary worker wakes preserve the alarm deadline and do not rescan a recently completed generation', async () => {
    const fixture = browserFixture();
    const deadline = fixture.alarmRecord?.scheduledTime;
    const first = await loadWorker();
    await first.ensureMonitorTabs(false);
    const next = await loadWorker();
    await next.ensureMonitorTabs(false);
    expect(fixture.alarmCreate).not.toHaveBeenCalled();
    expect(fixture.alarmRecord?.scheduledTime).toBe(deadline);
    expect(fixture.query).not.toHaveBeenCalled();
  });

  test('same-version unpacked reload forces an immediate scan even after a recent completed scan', async () => {
    vi.useFakeTimers();
    const fixture = browserFixture();
    const worker = await loadWorker();
    fixture.installed[0]?.({ reason: 'update' });
    const run = worker.ensureMonitorTabs(false);
    await vi.runAllTimersAsync();
    await run;
    expect(fixture.submissions).toHaveLength(2);
    expect(fixture.created).toHaveLength(2);
  });

  test('a scheduled poll is not skipped because the previous scan finished after its alarm start', async () => {
    vi.useFakeTimers();
    const fixture = browserFixture();
    const record = fixture.local[LAST_SCAN_KEY] as { completedAt: number };
    record.completedAt -= 5 * 60_000 - 15_000;
    const worker = await loadWorker();
    fixture.alarms[0]?.({ name: 'tibo-watch-check' });
    const run = worker.ensureMonitorTabs(false);
    await vi.runAllTimersAsync();
    await run;
    expect(fixture.submissions).toHaveLength(2);
  });

  test.each(['generation', 'version', 'expired'])('a changed %s makes a persisted completion due without multiplying alarms', async (reason) => {
    vi.useFakeTimers();
    const fixture = browserFixture();
    const record = fixture.local[LAST_SCAN_KEY] as { generation: number; version: string; completedAt: number };
    if (reason === 'generation') fixture.generation += 1;
    if (reason === 'version') record.version = '0.2.12';
    if (reason === 'expired') record.completedAt -= 5 * 60_000 + 1;
    const worker = await loadWorker();
    const run = worker.ensureMonitorTabs(false);
    await vi.runAllTimersAsync();
    await run;
    expect(fixture.submissions).toHaveLength(2);
    expect(fixture.alarmCreate).not.toHaveBeenCalled();
  });

  test('recreates a missing alarm once instead of replacing it on every worker evaluation', async () => {
    const fixture = browserFixture();
    fixture.alarmRecord = undefined;
    const worker = await loadWorker();
    await worker.ensureMonitorTabs(false);
    const next = await loadWorker();
    await next.ensureMonitorTabs(false);
    expect(fixture.alarmCreate).toHaveBeenCalledTimes(1);
  });

  test('serializes startup/alarm runs, reuses the owned pair across worker restarts and never recurses on reload', async () => {
    vi.useFakeTimers();
    const fixture = browserFixture();
    let worker = await loadWorker();
    fixture.startup[0]?.();
    fixture.alarms[0]?.({ name: 'tibo-watch-check' });
    const first = worker.ensureMonitorTabs();
    expect(worker.ensureMonitorTabs()).toBe(first);
    await vi.runAllTimersAsync();
    await first;
    expect(fixture.created.map((tab) => tab.url)).toEqual([POSTS_URL, REPLIES_URL]);
    expect(fixture.submissions).toHaveLength(2);
    expect(fixture.submissions[0]?.runId).toBe(fixture.submissions[1]?.runId);
    worker = await loadWorker();
    const second = worker.ensureMonitorTabs();
    await vi.runAllTimersAsync();
    await second;
    expect(fixture.created).toHaveLength(2);
    expect(fixture.reloaded).toEqual([101, 102]);
    expect(fixture.submissions).toHaveLength(4);
    expect(fixture.submissions[0]?.runId).not.toBe(fixture.submissions[2]?.runId);
    expect(fixture.updated).toHaveLength(0);
    expect(fixture.requests.every((init) => init.credentials === 'omit')).toBe(true);
  });

  test('closes only extension-owned duplicate tabs, preserving user duplicates and unrelated navigation', async () => {
    vi.useFakeTimers();
    const fixture = browserFixture([
      { id: 10, url: POSTS_URL }, { id: 11, url: POSTS_URL }, { id: 12, url: POSTS_URL },
      { id: 20, url: REPLIES_URL }, { id: 21, url: REPLIES_URL }, { id: 30, url: 'https://x.com/home' },
    ]);
    fixture.session[OWNED_KEY] = { 10: POSTS_URL, 11: POSTS_URL, 30: POSTS_URL };
    const worker = await loadWorker();
    const run = worker.ensureMonitorTabs();
    await vi.runAllTimersAsync();
    await run;
    expect(fixture.removed).toEqual([11]);
    expect(fixture.reloaded).toEqual([10, 20]);
    expect(fixture.created).toEqual([]);
    expect(fixture.scrolled.get(20) ?? 0).toBe(0);
  });

  test('leaves an active user view untouched and creates only its missing inactive monitor', async () => {
    vi.useFakeTimers();
    const fixture = browserFixture([{ id: 10, url: POSTS_URL, active: true }, { id: 20, url: REPLIES_URL, active: false }]);
    const worker = await loadWorker();
    const run = worker.ensureMonitorTabs();
    await vi.runAllTimersAsync();
    await run;
    expect(fixture.created.map((tab) => tab.url)).toEqual([POSTS_URL]);
    expect(fixture.reloaded).toEqual([20]);
    expect(fixture.removed).toEqual([]);
    expect(fixture.captures.has(10)).toBe(false);
  });

  test('reports a failed reload per page and still collects the available other page', async () => {
    vi.useFakeTimers();
    const fixture = browserFixture([{ id: 10, url: POSTS_URL }, { id: 20, url: REPLIES_URL }]);
    fixture.reloadFailureId = 10;
    const worker = await loadWorker();
    const run = worker.ensureMonitorTabs();
    await vi.runAllTimersAsync();
    await run;
    expect(fixture.submissions.map((value) => value.result)).toEqual(['error', 'ready']);
    expect(fixture.submissions[1]?.posts).toHaveLength(1);
    expect(fixture.submissions[0]?.runId).toBe(fixture.submissions[1]?.runId);
  });

  test('reports query failure instead of silently retaining a prior healthy run', async () => {
    const fixture = browserFixture();
    fixture.query.mockRejectedValueOnce(new Error('Tab inventory unavailable'));
    const worker = await loadWorker();
    await worker.ensureMonitorTabs();
    expect(fixture.submissions.map((value) => value.result)).toEqual(['error', 'error']);
    expect(fixture.created).toEqual([]);
  });

  test('waits past an old pinned first article for stable current content with bounded scrolling', async () => {
    vi.useFakeTimers();
    const fixture = browserFixture();
    fixture.html = (_url, attempt) => article('100', 'Old pinned post.', '<div data-testid="socialContext">Pinned</div>') +
      (attempt >= 3 ? article('901', 'Tomorrow we will reset usage for paid subscriptions.') : '');
    const worker = await loadWorker();
    const run = worker.ensureMonitorTabs();
    await vi.runAllTimersAsync();
    await run;
    expect(fixture.submissions).toHaveLength(2);
    for (const submission of fixture.submissions) {
      expect(submission.result).toBe('ready');
      expect(submission.posts.map((post) => post.id)).toEqual(['100', '901']);
    }
    expect([...fixture.captures.values()]).toEqual([5, 5]);
    expect([...fixture.scrolled.values()].every((count) => count <= 3)).toBe(true);
  });

  test('reports pinned-only/loading and page login failures, retaining available verified primary posts', async () => {
    vi.useFakeTimers();
    const fixture = browserFixture();
    fixture.html = (url) => url === POSTS_URL
      ? article('100', 'Old pinned post.', '<div data-testid="socialContext">Pinned</div>')
      : '<input autocomplete="username">';
    const worker = await loadWorker();
    const run = worker.ensureMonitorTabs();
    await vi.runAllTimersAsync();
    await run;
    expect(fixture.submissions.map((value) => value.result)).toEqual(['loading', 'needs_login']);
    expect(fixture.submissions[0]?.posts).toHaveLength(1);
    expect([...fixture.captures.values()]).toEqual([10, 1]);
  });

  test.each(['disabled', 'generation', 'offline'])('revokes a pending capture when health becomes %s', async (reason) => {
    vi.useFakeTimers();
    const fixture = browserFixture();
    fixture.afterCapture = () => {
      if (reason === 'disabled') fixture.enabled = false;
      if (reason === 'generation') fixture.generation += 1;
      if (reason === 'offline') fixture.offline = true;
    };
    const worker = await loadWorker();
    const run = worker.ensureMonitorTabs();
    await vi.runAllTimersAsync();
    await run;
    expect(fixture.created).toHaveLength(1);
    expect(fixture.submissions).toEqual([]);
    expect([...fixture.captures.values()]).toEqual([1]);
  });

  test('expands a long primary post in an owned detail tab, closes it, and persists full text across restart', async () => {
    vi.useFakeTimers();
    const fixture = browserFixture();
    const truncated = 'Update on rate limits...';
    const fullText = 'Update on rate limits. Tomorrow we will do a full reset of usage for all paid subscriptions.';
    fixture.local.tiboWatchExpandedPostsV1 = { 308: { text: 'Old unverified foreign text claiming a reset.' } };
    fixture.html = (url) => article('308', url.includes('/status/') ? fullText : truncated,
      url.includes('/status/') ? '' : '<button>Show more</button>');
    let worker = await loadWorker();
    const dom = new JSDOM(article('308', truncated, '<button>Show more</button>'));
    const posts = worker.collectVisiblePosts(dom.window.document);
    expect(await worker.expandLongPosts(posts, ['308'])).toEqual([expect.objectContaining({ text: fullText })]);
    expect(fixture.created).toHaveLength(1);
    expect(fixture.removed).toEqual([101]);
    worker = await loadWorker();
    expect(await worker.expandLongPosts(posts, ['308'])).toEqual([expect.objectContaining({ text: fullText })]);
    expect(fixture.created).toHaveLength(1);
    fixture.enabled = false;
    await expect(worker.expandLongPosts(posts, ['308'])).rejects.toThrow();
    expect(fixture.created).toHaveLength(1);
  });

  test('cancels detail expansion on a changed generation and closes its temporary owned tab', async () => {
    const fixture = browserFixture();
    fixture.afterCreate = () => { fixture.generation += 1; };
    const worker = await loadWorker();
    const posts = worker.collectVisiblePosts(new JSDOM(article('308', 'Update...', '<button>Show more</button>')).window.document);
    await expect(worker.expandLongPosts(posts, ['308'])).rejects.toThrow();
    expect(fixture.removed).toEqual([101]);
    expect(fixture.captures.size).toBe(0);
  });

  test('bounds failed detail expansion and marks incomplete primary text as loading', async () => {
    vi.useFakeTimers();
    const fixture = browserFixture();
    fixture.html = () => article('308', 'Update on rate limits...', '<button>Show more</button>');
    const worker = await loadWorker();
    const run = worker.ensureMonitorTabs();
    await vi.runAllTimersAsync();
    await run;
    expect(fixture.submissions.map((value) => value.result)).toEqual(['loading', 'loading']);
    expect(fixture.created.filter((tab) => tab.url.includes('/status/'))).toHaveLength(2);
    expect(fixture.removed).toHaveLength(2);
    expect([...fixture.captures.values()].every((count) => count <= 10)).toBe(true);
  });
});

interface Tab { id: number; url: string; active?: boolean }
interface Submission { protocolVersion: number; generation: number; runId: string; pageUrl: string; view: string; checkedAt: string; result: string; posts: Post[] }

function browserFixture(initialTabs: Tab[] = []) {
  const fixture = {
    enabled: true, generation: 100, offline: false,
    reloadFailureId: null as number | null,
    tabs: [...initialTabs], created: [] as Tab[], removed: [] as number[], reloaded: [] as number[],
    captures: new Map<number, number>(), scrolled: new Map<number, number>(),
    startup: [] as Array<() => void>, alarms: [] as Array<(alarm: { name: string }) => void>, updated: [] as unknown[],
    installed: [] as Array<(details: { reason: string }) => void>,
    alarmRecord: { periodInMinutes: 5, scheduledTime: Date.now() + 123_000 } as { periodInMinutes: number; scheduledTime: number } | undefined,
    alarmCreate: vi.fn(async (_name: string, options: { periodInMinutes: number }) => {
      fixture.alarmRecord = { periodInMinutes: options.periodInMinutes, scheduledTime: Date.now() + options.periodInMinutes * 60_000 };
      void _name;
    }),
    session: {} as Record<string, unknown>,
    local: { [LAST_SCAN_KEY]: { generation: 100, version: '0.2.13', completedAt: Date.now() } } as Record<string, unknown>,
    submissions: [] as Submission[], requests: [] as RequestInit[],
    html: ((_url: string, _attempt: number) => { void _url; void _attempt; return article(); }),
    afterCapture: () => undefined as void, afterCreate: () => undefined as void,
    query: vi.fn(async () => fixture.tabs),
    fetcher: vi.fn(async (url: string, init: RequestInit) => {
      fixture.requests.push(init);
      if (fixture.offline) throw new Error('Desktop unavailable');
      if (url.endsWith('/health')) return Response.json({ ok: true, collectionEnabled: fixture.enabled, generation: fixture.generation, protocolVersion: 2 });
      if (!url.endsWith('/posts')) throw new Error('Unexpected network request');
      fixture.submissions.push(JSON.parse(String(init.body)) as Submission);
      return new Response(null, { status: 204 });
    }),
  };
  const storage = (state: Record<string, unknown>) => ({
    get: async (key: string) => ({ [key]: state[key] }),
    set: async (update: Record<string, unknown>) => { Object.assign(state, update); },
  });
  vi.stubGlobal('fetch', fixture.fetcher);
  vi.stubGlobal('chrome', {
    runtime: { id: 'cnhojdncaimngpikaokmgpnihhglnmkn', getManifest: () => ({ version: '0.2.13' }),
      onInstalled: { addListener: (listener: (details: { reason: string }) => void) => fixture.installed.push(listener) },
      onStartup: { addListener: (listener: () => void) => fixture.startup.push(listener) } },
    alarms: { get: async () => fixture.alarmRecord, create: fixture.alarmCreate,
      onAlarm: { addListener: (listener: (alarm: { name: string }) => void) => fixture.alarms.push(listener) } },
    storage: { session: storage(fixture.session), local: storage(fixture.local) },
    tabs: {
      query: fixture.query,
      create: async ({ url }: { url: string }) => {
        const tab = { id: 101 + fixture.created.length, url };
        fixture.tabs.push(tab); fixture.created.push(tab); fixture.afterCreate(); return tab;
      },
      reload: async (id: number) => {
        fixture.reloaded.push(id);
        if (id === fixture.reloadFailureId) throw new Error('Reload failed');
      },
      remove: async (id: number) => { fixture.removed.push(id); fixture.tabs = fixture.tabs.filter((tab) => tab.id !== id); },
      onUpdated: { addListener: (listener: unknown) => fixture.updated.push(listener) },
    },
    scripting: { executeScript: async ({ target, func, args }: {
      target: { tabId: number }; func: (...args: unknown[]) => unknown; args: unknown[];
    }) => {
      const tab = fixture.tabs.find((candidate) => candidate.id === target.tabId);
      if (!tab) throw new Error('Missing synthetic tab');
      const attempt = (fixture.captures.get(tab.id) ?? 0) + 1;
      fixture.captures.set(tab.id, attempt);
      const dom = new JSDOM(fixture.html(tab.url, attempt), { url: tab.url, runScripts: 'outside-only' });
      dom.window.scrollBy = () => { fixture.scrolled.set(tab.id, (fixture.scrolled.get(tab.id) ?? 0) + 1); };
      // Execute the serialized injection exactly as Chrome does, without its module scope.
      const result = dom.window.eval(`(${func.toString()})(...${JSON.stringify(args)})`) as Snapshot;
      dom.window.close(); fixture.afterCapture(); return [{ result }];
    } },
  });
  return fixture;
}

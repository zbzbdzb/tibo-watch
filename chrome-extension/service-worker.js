/* global chrome, document, fetch, setTimeout, AbortSignal, URL */

const BRIDGE_BASE_URL = 'http://127.0.0.1:47652';
const MONITOR_URLS = ['https://x.com/thsottiaux', 'https://x.com/thsottiaux/with_replies'];
const PROTOCOL_VERSION = 2;
const COLLECTOR_REVISION = 1;
const COLLECTION_ATTEMPTS = 10;
const COLLECTION_RETRY_MS = 1_000;
// V1 cached results were produced before primary-author verification was fixed.
const EXPANDED_POST_CACHE_KEY = 'tiboWatchExpandedPostsV2';
const OWNED_TABS_KEY = 'tiboWatchOwnedTabsV1';
const SELECTED_TABS_KEY = 'tiboWatchSelectedTabsV1';
const DETAIL_RETURN_KEY = 'tiboWatchDetailReturnV1';
const LAST_SCAN_KEY = 'tiboWatchLastCompletedScanV2';
const SCAN_INTERVAL_MS = 5 * 60_000;
let monitorCheckInFlight = null;
let forceScanRequested = false;

// This function is injected into X. Keep it self-contained: Chrome serializes the
// function, not its module closures. Tests execute this same function in JSDOM.
export function captureTimeline(advance = false, expectedUrl = null, root = document) {
  const clean = (element) => element?.textContent?.trim() ?? '';
  const quoteSelector = '[data-testid="quoteTweet"], [data-testid="card.wrapper"], [role="link"][tabindex="0"]';
  const articleSelector = 'article[data-testid="tweet"]';
  const posts = [];
  const expandableIds = [];
  const timelineKeys = [];
  let hasUnpinned = false;
  for (const article of root.querySelectorAll(articleSelector)) {
    if (article.parentElement?.closest(articleSelector)) continue;
    const isPrimary = (node) => node.closest(articleSelector) === article && !node.closest(quoteSelector);
    const socialContext = clean([...article.querySelectorAll('[data-testid="socialContext"]')].find(isPrimary));
    // Never search for a Tibo link anywhere in the article. First resolve the
    // primary timestamp/author; the quoted author is not the primary author.
    const permalink = [...article.querySelectorAll('a[href*="/status/"]')]
      .find((link) => isPrimary(link) && link.querySelector('time'));
    const match = permalink?.getAttribute('href')?.match(/\/([^/]+)\/status\/(\d+)/i);
    const repost = /repost|转发|轉發/i.test(socialContext);
    if (match && !/pinned|置顶|釘選/i.test(socialContext) && (repost || match[1]?.toLowerCase() === 'thsottiaux')) {
      timelineKeys.push(match[2]);
    }
    // A skipped repost still proves the timeline progressed beyond its pinned
    // card. Readiness must not depend on which cards are imported as signals.
    if (repost) continue;
    if (!match || match[1]?.toLowerCase() !== 'thsottiaux' || !match[2]) continue;
    const author = [...article.querySelectorAll('[data-testid="User-Name"]')].find(isPrimary);
    const authorHandle = author?.textContent?.match(/@([a-zA-Z0-9_]+)/)?.[1]?.toLowerCase();
    if (authorHandle && authorHandle !== 'thsottiaux') continue;
    const textNodes = [...article.querySelectorAll('[data-testid="tweetText"]')];
    const primary = textNodes.find(isPrimary);
    const quote = textNodes.find((node) => node.closest(quoteSelector));
    const createdAt = permalink.querySelector('time')?.getAttribute('datetime');
    if (!clean(primary) || !createdAt || !Number.isFinite(Date.parse(createdAt))) continue;
    const primaryContext = article.cloneNode(true);
    primaryContext.querySelectorAll(quoteSelector).forEach((node) => node.remove());
    const kind = /Replying to|正在回复|回复给|回覆給/i.test(primaryContext.textContent ?? '')
      ? 'reply' : quote ? 'quote' : 'original';
    posts.push({
      id: match[2], authorHandle: 'thsottiaux', text: clean(primary),
      createdAt: new Date(createdAt).toISOString(),
      url: `https://x.com/thsottiaux/status/${match[2]}`, kind,
      quotedText: quote ? clean(quote) : null, sourceIds: ['x-browser'],
    });
    if (!/pinned|置顶|釘選/i.test(socialContext)) hasUnpinned = true;
    if ([...article.querySelectorAll('button, [role="button"], [data-testid="tweet-text-show-more-link"]')]
      .some((button) => isPrimary(button) && /^(?:show more|显示更多|顯示更多)$/i.test(clean(button)))) {
      expandableIds.push(match[2]);
    }
  }
  const url = root.location?.href ?? root.URL ?? '';
  const bodyText = clean(root.body);
  const needsLogin = /\/i\/flow\/login|\/login(?:[/?#]|$)/i.test(url) ||
    (posts.length === 0 && !!root.querySelector('[data-testid="loginButton"], input[autocomplete="username"]'));
  const hasError = [...root.querySelectorAll('[data-testid="error-detail"], [data-testid="error-message"], [role="alert"]')]
    .some((node) => /wrong|error|retry|try again|出错|错误|重试|發生錯誤/i.test(clean(node))) ||
    /Something went wrong[.!]?\s*(?:Try reloading|Retry)/i.test(bodyText);
  const loading = !!root.querySelector('[role="progressbar"]');
  const explicitEmpty = !!root.querySelector('[data-testid="emptyState"]') ||
    /hasn[’']t posted|has not posted|No posts yet|还没有发布|尚未發布/i.test(bodyText);
  let result = needsLogin ? 'needs_login' : hasError ? 'error' : loading ? 'loading' :
    posts.length ? 'ready' : explicitEmpty ? 'empty' : 'loading';
  const wrongPage = expectedUrl && url.split(/[?#]/)[0].replace(/\/$/, '') !== expectedUrl;
  if (wrongPage) {
    result = needsLogin ? 'needs_login' : 'error';
  }
  if (advance && !needsLogin && !hasError) {
    root.defaultView?.scrollBy(0, Math.min(root.defaultView.innerHeight || 800, 900));
  }
  const reason = needsLogin ? 'login_required' : wrongPage ? 'navigation_changed' : hasError ? 'page_error' :
    explicitEmpty ? 'empty_timeline' : posts.length && !timelineKeys.length ? 'pinned_only' :
      timelineKeys.length ? 'unstable_timeline' : 'page_loading';
  return { posts, expandableIds, result, hasUnpinned, loading, timelineKeys, reason };
}

export function collectVisiblePosts(root = document) {
  return captureTimeline(false, null, root).posts;
}

export function findExpandablePostIds(root = document) {
  return captureTimeline(false, null, root).expandableIds;
}

async function health() {
  try {
    const response = await fetch(`${BRIDGE_BASE_URL}/health`, {
      method: 'GET', credentials: 'omit', cache: 'no-store',
      signal: AbortSignal.timeout(2_500),
      headers: { 'X-Tibo-Watch-Extension': chrome.runtime.id },
    });
    if (!response.ok) return null;
    const value = await response.json();
    return value?.ok === true && value.collectionEnabled === true &&
      value.protocolVersion === PROTOCOL_VERSION && Number.isSafeInteger(value.generation) && value.generation >= 0
      ? value : null;
  } catch {
    return null;
  }
}

export async function isDesktopAppAvailable() {
  return !!await health();
}

async function newLease() {
  const value = await health();
  if (!value) throw new Error('Collection is disabled or the desktop app is unavailable');
  return { generation: value.generation, runId: globalThis.crypto.randomUUID(), detailBudget: 3,
    diagnosticsSupported: value.collectorRevision === COLLECTOR_REVISION };
}

async function requireLease(lease) {
  const value = await health();
  if (!value || value.generation !== lease.generation) throw new Error('Collection was revoked');
}

const retry = () => new Promise((resolve) => setTimeout(resolve, COLLECTION_RETRY_MS));

async function inspect(tabId, expectedUrl, advance, lease) {
  await requireLease(lease);
  const tab = await chrome.tabs.get(tabId);
  const [{ result } = {}] = await chrome.scripting.executeScript({
    target: { tabId }, func: captureTimeline, args: [advance && !tab.active, expectedUrl],
  });
  await requireLease(lease);
  if (!result || !Array.isArray(result.posts)) throw new Error('Timeline was not readable');
  return result;
}

async function submitTab(tab, owned, lease) {
  const collected = new Map();
  const expandable = new Set();
  let previousKeys = [];
  let stableSamples = 0;
  let result = 'loading';
  let reason = 'page_loading';
  let samples = 0;
  for (let attempt = 0; attempt < COLLECTION_ATTEMPTS; attempt += 1) {
    let snapshot;
    try {
      snapshot = await inspect(tab.id, tab.url, owned && (attempt === 1 || attempt === 3 || attempt === 5), lease);
    } catch {
      // Distinguish transient navigation from revoked collection before retrying.
      await requireLease(lease);
      result = 'error';
      reason = 'read_failed';
      if (attempt < COLLECTION_ATTEMPTS - 1) await retry();
      continue;
    }
    samples += 1;
    for (const post of snapshot.posts) {
      if (!collected.has(post.id) || collected.get(post.id).text.length < post.text.length) collected.set(post.id, post);
    }
    for (const id of snapshot.expandableIds ?? []) expandable.add(id);
    const keys = snapshot.timelineKeys ?? [];
    stableSamples = keys.some(key => previousKeys.includes(key)) ? stableSamples + 1 : 0;
    previousKeys = keys;
    result = snapshot.result;
    reason = snapshot.reason;
    if (result === 'needs_login' || result === 'error') break;
    // A pinned item often renders before the current timeline. Wait through several
    // samples and bounded scrolls, and never call a pinned-only page successful.
    // X may leave a spinner at the infinite-scroll footer. Stable, verified
    // non-pinned posts prove the visible timeline is readable despite that spinner.
    if (attempt >= 4 && stableSamples >= 2 && keys.length) {
      result = collected.size ? 'ready' : 'empty';
      reason = 'stable_timeline';
      break;
    }
    if (result === 'ready') result = 'loading';
    if (attempt < COLLECTION_ATTEMPTS - 1) await retry();
  }
  const posts = await expandLongPosts([...collected.values()].slice(0, 100), [...expandable], lease, tab);
  const pendingDetails = posts.filter((post) => expandable.has(post.id) &&
    post.text.length <= (collected.get(post.id)?.text.length ?? 0)).length;
  await submitResult(tab.url, result, posts, lease, pendingDetails, reason, samples);
}

async function submitResult(pageUrl, result, posts, lease, pendingDetails = 0, reason = 'read_failed', samples = 0) {
  await requireLease(lease);
  const response = await fetch(`${BRIDGE_BASE_URL}/posts`, {
    method: 'POST', credentials: 'omit', signal: AbortSignal.timeout(2_500),
    headers: { 'Content-Type': 'application/json', 'X-Tibo-Watch-Extension': chrome.runtime.id },
    body: JSON.stringify({
      protocolVersion: PROTOCOL_VERSION, generation: lease.generation, runId: lease.runId,
      pageUrl, view: pageUrl === MONITOR_URLS[0] ? 'posts' : 'replies',
      checkedAt: new Date().toISOString(), result, posts, pendingDetails,
      ...(lease.diagnosticsSupported ? { diagnostics: {
        extensionVersion: chrome.runtime.getManifest().version, collectorRevision: COLLECTOR_REVISION, reason, samples,
      } } : {}),
    }),
  });
  if (!response.ok) throw new Error('The desktop app rejected collection');
}

export async function expandLongPosts(posts, expandableIds, existingLease = null, monitorTab = null) {
  const lease = existingLease ?? await newLease();
  await requireLease(lease);
  const expandable = new Set(expandableIds);
  const expandedPosts = [];
  const cache = await readStorage(chrome.storage?.local, EXPANDED_POST_CACHE_KEY);
  let cacheChanged = false;
  for (const post of posts) {
    await requireLease(lease);
    const cached = cache[post.id];
    if (expandable.has(post.id) && cached?.id === post.id && cached.authorHandle === 'thsottiaux' &&
        cached.url === post.url && cached.text?.length > post.text.length) {
      expandedPosts.push({ ...post, text: cached.text, quotedText: cached.quotedText });
    } else if (expandable.has(post.id) && lease.detailBudget > 0 && monitorTab) {
      const expanded = await readPostFromDetailTab(post, lease, monitorTab);
      expandedPosts.push(expanded ?? post);
      if (expanded) { cache[post.id] = expanded; cacheChanged = true; }
    } else expandedPosts.push(post);
  }
  if (cacheChanged) {
    await requireLease(lease);
    const bounded = Object.fromEntries(Object.values(cache)
      .filter((post) => typeof post?.id === 'string')
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
      .slice(0, 200).map((post) => [post.id, post]));
    await writeStorage(chrome.storage?.local, EXPANDED_POST_CACHE_KEY, bounded);
  }
  return expandedPosts;
}

async function readStorage(area, key) {
  try {
    const stored = await area?.get(key);
    const value = stored?.[key];
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

async function writeStorage(area, key, value) {
  try { await area?.set({ [key]: value }); } catch { /* Storage failure must not grant ownership. */ }
}

async function rememberOwned(tab) {
  const owned = await readStorage(chrome.storage?.session, OWNED_TABS_KEY);
  owned[tab.id] = tab.url;
  await writeStorage(chrome.storage?.session, OWNED_TABS_KEY, owned);
}

async function forgetOwned(id) {
  const owned = await readStorage(chrome.storage?.session, OWNED_TABS_KEY);
  delete owned[id];
  await writeStorage(chrome.storage?.session, OWNED_TABS_KEY, owned);
}

async function restoreDetailTab(id, entry) {
  const current = await chrome.tabs.get(Number(id)).catch(() => null);
  if (current?.active && current.url === entry.detailUrl) return false;
  if (current?.url === entry.detailUrl) await chrome.tabs.update(Number(id), { url: entry.returnUrl });
  const pending = await readStorage(chrome.storage?.session, DETAIL_RETURN_KEY);
  delete pending[id];
  await writeStorage(chrome.storage?.session, DETAIL_RETURN_KEY, pending);
  return true;
}

async function readPostFromDetailTab(post, lease, monitorTab) {
  await requireLease(lease);
  const current = await chrome.tabs.get(monitorTab.id).catch(() => null);
  if (!current || current.active || canonicalMonitorUrl(current.url) !== monitorTab.url) return null;
  lease.detailBudget -= 1;
  const entry = { returnUrl: current.url, detailUrl: post.url };
  const pending = await readStorage(chrome.storage?.session, DETAIL_RETURN_KEY);
  pending[monitorTab.id] = entry;
  await writeStorage(chrome.storage?.session, DETAIL_RETURN_KEY, pending);
  try {
    await requireLease(lease);
    await chrome.tabs.update(monitorTab.id, { url: post.url });
    for (let attempt = 0; attempt < COLLECTION_ATTEMPTS; attempt += 1) {
      try {
        const snapshot = await inspect(monitorTab.id, post.url, false, lease);
        const expanded = snapshot.posts.find((candidate) => candidate.id === post.id);
        if (expanded && expanded.text.length > post.text.length && !snapshot.expandableIds.includes(post.id)) return expanded;
        if (snapshot.result === 'needs_login' || (snapshot.result === 'error' && snapshot.reason !== 'navigation_changed')) return null;
      } catch { await requireLease(lease); }
      if (attempt < COLLECTION_ATTEMPTS - 1) await retry();
    }
    return null;
  } finally {
    await restoreDetailTab(monitorTab.id, entry).catch(() => undefined);
  }
}

function canonicalMonitorUrl(value) {
  try {
    const url = new URL(value);
    const canonical = `${url.origin}${url.pathname.replace(/\/$/, '')}`;
    return MONITOR_URLS.includes(canonical) ? canonical : null;
  } catch { return null; }
}

export function ensureMonitorTabs(force = true) {
  // A manual reload/install may arrive while the worker's due-only bootstrap is
  // checking storage. Upgrade that same single flight rather than dropping it.
  forceScanRequested ||= force;
  if (!monitorCheckInFlight) {
    monitorCheckInFlight = runMonitorCheck().catch(() => undefined).finally(() => {
      monitorCheckInFlight = null;
      forceScanRequested = false;
    });
  }
  return monitorCheckInFlight;
}

async function runMonitorCheck() {
  const lease = await newLease();
  const previous = await readStorage(chrome.storage?.local, LAST_SCAN_KEY);
  const version = chrome.runtime.getManifest().version;
  const elapsed = Date.now() - previous.completedAt;
  const forced = forceScanRequested;
  forceScanRequested = false;
  if (!forced && previous.generation === lease.generation && previous.version === version &&
      Number.isFinite(elapsed) && elapsed >= 0 && elapsed < SCAN_INTERVAL_MS) return;
  await requireLease(lease);
  let tabs;
  try { tabs = await chrome.tabs.query({}); }
  catch {
    for (const url of MONITOR_URLS) await submitResult(url, 'error', [], lease);
    await recordCompletedScan(lease, version);
    return;
  }
  // Session storage survives worker suspension but not browser restarts, where
  // Chrome may recycle tab IDs. Never infer ownership just from a matching URL.
  const owned = await readStorage(chrome.storage?.session, OWNED_TABS_KEY);
  const selectedTabs = await readStorage(chrome.storage?.session, SELECTED_TABS_KEY);
  const pendingDetails = await readStorage(chrome.storage?.session, DETAIL_RETURN_KEY);
  for (const [id, entry] of Object.entries(pendingDetails)) {
    if (!canonicalMonitorUrl(entry.returnUrl) || !/^https:\/\/x\.com\/thsottiaux\/status\/\d+$/.test(entry.detailUrl)) continue;
    await requireLease(lease);
    await restoreDetailTab(id, entry).catch(() => undefined);
  }
  for (const tab of tabs) {
    if (tab.id && owned[tab.id] === tab.url && /^https:\/\/x\.com\/thsottiaux\/status\/\d+$/.test(tab.url ?? '')) {
      await requireLease(lease);
      const current = await chrome.tabs.get(tab.id).catch(() => null);
      if (!current || current.active || current.url !== owned[tab.id]) continue;
      await chrome.tabs.remove(tab.id).catch(() => undefined);
      await forgetOwned(tab.id);
    }
  }
  for (const url of MONITOR_URLS) {
    try {
      await requireLease(lease);
      // Focus is not ownership. Reuse the selected view even when the user is
      // looking at it; active views are read-only, never replaced by a new tab.
      tabs = await chrome.tabs.query({});
      const pending = await readStorage(chrome.storage?.session, DETAIL_RETURN_KEY);
      if (tabs.some(tab => tab.id === selectedTabs[url] && tab.active && pending[tab.id]?.detailUrl === tab.url)) {
        await submitResult(url, 'loading', [], lease, 0, 'active_detail');
        continue;
      }
      const matches = tabs.filter((tab) => tab.id && canonicalMonitorUrl(tab.url) === url);
      const ownedMatches = matches.filter((tab) => owned[tab.id] === url);
      let selected = matches.find(tab => tab.id === selectedTabs[url]) ?? ownedMatches[0] ?? matches[0];
      for (const duplicate of ownedMatches.filter(tab => tab.id !== selected?.id)) {
        await requireLease(lease);
        const current = await chrome.tabs.get(duplicate.id).catch(() => null);
        if (!current || current.active || current.url !== owned[duplicate.id]) continue;
        await chrome.tabs.remove(duplicate.id).catch(() => undefined);
        await forgetOwned(duplicate.id);
      }
      let isOwned = !!selected && owned[selected.id] === url;
      if (!selected) {
        await requireLease(lease);
        selected = await chrome.tabs.create({ url, active: false });
        if (!selected?.id) throw new Error('Monitor tab could not be created');
        selected = { ...selected, url };
        isOwned = true;
        await rememberOwned(selected);
      } else {
        await requireLease(lease);
        const current = await chrome.tabs.get(selected.id);
        if (canonicalMonitorUrl(current.url) !== url) throw new Error('User navigated away');
        if (!current.active) await chrome.tabs.reload(selected.id);
      }
      selectedTabs[url] = selected.id;
      await writeStorage(chrome.storage?.session, SELECTED_TABS_KEY, selectedTabs);
      await submitTab({ id: selected.id, url }, isOwned, lease);
    } catch {
      await requireLease(lease);
      await submitResult(url, 'error', [], lease);
    }
  }
  await recordCompletedScan(lease, version);
}

async function recordCompletedScan(lease, version) {
  await requireLease(lease);
  await writeStorage(chrome.storage?.local, LAST_SCAN_KEY, {
    generation: lease.generation, version, completedAt: Date.now(),
  });
}

async function ensureCollectionAlarm() {
  const alarm = await chrome.alarms.get('tibo-watch-check');
  // Recreating a named alarm replaces it and postpones its next firing. Worker
  // wakeups must preserve an existing schedule, not push it five minutes away.
  if (!alarm || alarm.periodInMinutes !== 5) {
    await chrome.alarms.create('tibo-watch-check', { periodInMinutes: 5 });
  }
}

function start() {
  chrome.alarms.onAlarm.addListener((alarm) => {
    // The actual scheduled alarm is a requested poll, even if the previous
    // scan completed a few seconds after its start. Only incidental wakes throttle.
    if (alarm.name === 'tibo-watch-check') void ensureMonitorTabs();
  });
  chrome.runtime.onInstalled.addListener(() => void ensureMonitorTabs());
  chrome.runtime.onStartup.addListener(() => void ensureMonitorTabs());
  // onUpdated does not start collection: polling inside the serialized run waits
  // for navigation. This prevents reload/completion recursion and disabled pushes.
  // A fresh/restarted worker does one permission/due check. Persisted completion
  // prevents ordinary MV3 wakeups from navigating the same pages repeatedly.
  void ensureCollectionAlarm().catch(() => undefined);
  void ensureMonitorTabs(false);
}

if (globalThis.chrome?.runtime?.id) start();

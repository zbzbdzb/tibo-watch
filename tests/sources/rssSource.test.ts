import { describe, expect, it, vi } from 'vitest';

import {
  PublicRssSource,
  parseInstanceRegistry,
  parseNitterRss,
} from '../../src/main/sources/publicRssSource';

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <item>
    <title>I've now reset Codex usage limits for paid subscriptions.</title>
    <description><![CDATA[<p>I've now reset Codex usage limits for paid subscriptions.</p>]]></description>
    <pubDate>Fri, 31 Jul 2026 04:53:19 GMT</pubDate>
    <guid isPermaLink="false">tweet-101</guid>
    <link>https://nitter.example/thsottiaux/status/101#m</link>
  </item>
  <item>
    <title>R to @openai: Should we reset Codex again soon?</title>
    <description><![CDATA[<p>Should we reset Codex again soon?</p>]]></description>
    <pubDate>Fri, 31 Jul 2026 04:50:00 GMT</pubDate>
    <guid isPermaLink="false">tweet-100</guid>
    <link>https://nitter.example/thsottiaux/status/100#m</link>
  </item>
  <item>
    <title>RT by @thsottiaux: unrelated repost</title>
    <pubDate>Fri, 31 Jul 2026 04:40:00 GMT</pubDate>
    <guid isPermaLink="false">tweet-99</guid>
    <link>https://nitter.example/other/status/99#m</link>
  </item>
</channel></rss>`;

describe('Nitter RSS source', () => {
  const context = () => ({ checkedAt: '2026-09-12T08:20:00.000Z', signal: new AbortController().signal });

  it('ignores status links, offline rows, duplicates and non-public sections', () => {
    expect(parseInstanceRegistry(`## Official
| [official](https://official.test) | ✅ | ✅ |
## Public
For instances working now, see [nitter-status](https://status.test).
| [one](https://one.test) | ✅ | working | [SSL](https://ssl.test) |
| [one](https://one.test/) | ✅ | ✅ |
| [dead](https://dead.test) | ❌ | ✅ |
| [broken](https://broken.test) | ✅ | ❌ |
### Tor
| [tor](https://tor.test) | ✅ | ✅ |`)).toEqual(['https://one.test']);
  });

  it('tries the verified instance without first depending on registry availability', async () => {
    const fetcher = vi.fn(async () => new Response(RSS));
    const source = new PublicRssSource({ fetcher });
    expect((await source.check(context())).state).toBe('online');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('https://nitter.perennialte.ch/thsottiaux/with_replies/rss', expect.objectContaining({
      credentials: 'omit', cache: 'no-store', redirect: 'manual',
    }));
  });

  it('discovers a replacement and prioritizes the last working instance on the next check', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes('Instances.md')) return new Response('## Public\n| [two](https://two.test) | ✅ | ✅ |');
      return url.startsWith('https://two.test') ? new Response(RSS) : new Response('unavailable', { status: 503 });
    });
    const source = new PublicRssSource({ fetcher });
    expect((await source.check(context())).state).toBe('online');
    expect(fetcher).toHaveBeenCalledTimes(3);
    fetcher.mockClear();
    expect((await source.check(context())).state).toBe('online');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://two.test/thsottiaux/with_replies/rss');
  });

  it('rejects challenge HTML and malformed XML even when HTTP returns 200', async () => {
    expect(parseNitterRss('<html><body>Verify you are human</body></html>', 'public-rss')).toEqual([]);
    expect(parseNitterRss(RSS.replace('</channel>', ''), 'public-rss')).toEqual([]);
    const fetcher = vi.fn(async (url: string) => new Response(url.startsWith('https://valid.test') ? RSS : '<html>challenge</html>'));
    const source = new PublicRssSource({ fetcher, preferredInstances: ['https://challenge.test', 'https://valid.test'] });
    expect((await source.check(context())).state).toBe('online');
    expect(source.lastWorkingInstance).toBe('https://valid.test');
  });

  it('retries discovery after a temporary registry outage', async () => {
    let registryAvailable = false;
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes('Instances.md') && registryAvailable) return new Response('## Public\n| [new](https://new.test) | ✅ | ✅ |');
      return url.startsWith('https://new.test') ? new Response(RSS) : new Response('unavailable', { status: 503 });
    });
    const source = new PublicRssSource({ fetcher });
    expect((await source.check(context())).state).toBe('error');
    registryAvailable = true;
    expect((await source.check(context())).state).toBe('online');
    expect(fetcher.mock.calls.filter(([url]) => url.includes('Instances.md'))).toHaveLength(2);
  });

  it('bounds failed instance attempts and stops before any request when cancelled', async () => {
    const fetcher = vi.fn(async () => new Response('unavailable', { status: 503 }));
    const source = new PublicRssSource({ fetcher, maxInstancesPerCheck: 1 });
    expect((await source.check(context())).state).toBe('error');
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockClear();
    await expect(source.check({ ...context(), signal: AbortSignal.abort() })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('parses originals and replies, normalizes canonical links, and ignores reposts', () => {
    expect(parseNitterRss(RSS, 'public-rss')).toEqual([
      expect.objectContaining({
        id: '101',
        kind: 'original',
        text: "I've now reset Codex usage limits for paid subscriptions.",
        url: 'https://x.com/thsottiaux/status/101',
      }),
      expect.objectContaining({
        id: '100',
        kind: 'reply',
        text: 'Should we reset Codex again soon?',
      }),
    ]);
  });

  it('uses the full primary description when the title truncates before a reset announcement', () => {
    const xml = `<rss><channel><item>
      <title>Update on rate limits in Codex. We found...</title>
      <description><![CDATA[<p>Update on rate limits in Codex. We found a bug.</p><p>Tomorrow we will do a full reset of usage for all paid subscriptions.</p><p><a href="https://nitter.test/thsottiaux/status/777">Read more</a></p>]]></description>
      <guid>arbitrary-mirror-id</guid><link>https://nitter.test/thsottiaux/status/777#m</link>
      <pubDate>Fri, 31 Jul 2026 04:53:19 GMT</pubDate>
    </item></channel></rss>`;
    expect(parseNitterRss(xml, 'public-rss')[0]).toMatchObject({
      id: '777',
      text: 'Update on rate limits in Codex. We found a bug.\nTomorrow we will do a full reset of usage for all paid subscriptions.',
    });
  });

  it('separates explicitly marked quoted text and rejects foreign primary authors', () => {
    const item = (handle: string) => `<item><title>Interesting update.</title>
      <description><![CDATA[<p>Interesting update.</p><blockquote><p>Codex limits reset now.</p></blockquote>]]></description>
      <link>https://nitter.test/${handle}/status/778</link><pubDate>Fri, 31 Jul 2026 04:53:19 GMT</pubDate></item>`;
    const posts = parseNitterRss(`<rss><channel>${item('thsottiaux')}${item('other')}</channel></rss>`, 'public-rss');
    expect(posts).toEqual([expect.objectContaining({
      id: '778', text: 'Interesting update.', quotedText: 'Codex limits reset now.', kind: 'quote',
    })]);
  });

  it('does not append ambiguous flat quote context or fail the feed on malformed dates', () => {
    const item = `<item><title>Interesting update.</title><description><![CDATA[<p>Interesting update.</p><a href="https://x.com/other/status/779">Other</a><p>We will reset Codex now.</p>]]></description><link>https://nitter.test/thsottiaux/status/780</link><pubDate>Fri, 31 Jul 2026 04:53:19 GMT</pubDate></item>`;
    expect(parseNitterRss(`<rss><channel>${item}${item.replace('Fri, 31 Jul 2026 04:53:19 GMT', 'invalid')}</channel></rss>`, 'public-rss'))
      .toEqual([expect.objectContaining({ id: '780', text: 'Interesting update.', quotedText: null })]);
  });

  it('extracts healthy HTTPS instances from the maintained markdown registry', () => {
    const registry = `## Public\n| URL | Online | Working | Issuer |\n|---|---|---|---|\n| [nitter.one](https://nitter.one) | :white_check_mark: | ✅ | [SSL](https://www.ssllabs.com/test) |\n| [dead](http://dead.test) | :x: | :x: | |\n| [nitter.two](https://nitter.two/) | :white_check_mark: | ✅ | [SSL](https://www.ssllabs.com/test2) |\n### Tor`;
    expect(parseInstanceRegistry(registry)).toEqual([
      'https://nitter.one',
      'https://nitter.two',
    ]);
  });

  it('falls through failing instances and remembers the working instance', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes('Instances.md')) return new Response('## Public\n| [one](https://one.test) | :white_check_mark: | ✅ |\n| [two](https://two.test) | :white_check_mark: | ✅ |\n### Tor');
      if (url.startsWith('https://one.test')) return new Response('bad gateway', { status: 502 });
      return new Response(RSS, { status: 200 });
    });
    const source = new PublicRssSource({ fetcher, preferredInstances: [] });

    const result = await source.check({
      checkedAt: '2026-07-31T05:00:00.000Z',
      signal: new AbortController().signal,
    });

    expect(result.state).toBe('online');
    expect(result.posts).toHaveLength(2);
    expect(source.lastWorkingInstance).toBe('https://two.test');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('times out a stalled instance before trying the next candidate', async () => {
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const value = String(url);
      if (value.includes('Instances.md')) {
        return new Response('## Public\n| [slow](https://slow.test) | :white_check_mark: | ✅ |\n| [fast](https://fast.test) | :white_check_mark: | ✅ |\n### Tor');
      }
      if (value.startsWith('https://slow.test')) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('timed out')), { once: true });
        });
      }
      return new Response(RSS, { status: 200 });
    }) as typeof fetch;
    const source = new PublicRssSource({ fetcher, requestTimeoutMs: 5, preferredInstances: [] });

    const result = await source.check({
      checkedAt: '2026-07-31T05:00:00.000Z',
      signal: new AbortController().signal,
    });

    expect(result.state).toBe('online');
    expect(source.lastWorkingInstance).toBe('https://fast.test');
  });
});

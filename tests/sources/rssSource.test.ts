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
  it('parses originals and replies, normalizes canonical links, and ignores reposts', () => {
    expect(parseNitterRss(RSS, 'public-rss')).toEqual([
      expect.objectContaining({
        id: 'tweet-101',
        kind: 'original',
        text: "I've now reset Codex usage limits for paid subscriptions.",
        url: 'https://x.com/thsottiaux/status/101',
      }),
      expect.objectContaining({
        id: 'tweet-100',
        kind: 'reply',
        text: 'Should we reset Codex again soon?',
      }),
    ]);
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
    const source = new PublicRssSource({ fetcher });

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
    const source = new PublicRssSource({ fetcher, requestTimeoutMs: 5 });

    const result = await source.check({
      checkedAt: '2026-07-31T05:00:00.000Z',
      signal: new AbortController().signal,
    });

    expect(result.state).toBe('online');
    expect(source.lastWorkingInstance).toBe('https://fast.test');
  });
});

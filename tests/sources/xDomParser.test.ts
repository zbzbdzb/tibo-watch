import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import { extractXPosts } from '../../src/main/sources/xDomParser';

describe('X DOM parser', () => {
  it.each(['data-testid="quoteTweet"', 'role="link" tabindex="0"'])('does not attribute foreign primary reset text quoting Tibo (%s)', (quoteAttributes) => {
    const dom = new JSDOM(`<article data-testid="tweet">
      <div data-testid="User-Name">Other @someone</div>
      <div data-testid="tweetText">We will reset all Codex limits tomorrow.</div>
      <a href="/someone/status/900"><time datetime="2026-09-04T00:00:00Z"></time></a>
      <div ${quoteAttributes}>
        <div data-testid="User-Name">Tibo @thsottiaux</div>
        <div data-testid="tweetText">A small product update.</div>
        <a href="/thsottiaux/status/899"><time datetime="2026-09-03T00:00:00Z"></time></a>
      </div>
    </article>`);
    expect(extractXPosts(dom.window.document, 'thsottiaux')).toEqual([]);
  });

  it('uses the primary timestamp even if a Tibo quote link appears first, without importing quoted reply context', () => {
    const dom = new JSDOM(`<article data-testid="tweet">
      <div data-testid="User-Name">Tibo @thsottiaux</div>
      <div data-testid="tweetText">Worth reading.</div>
      <div data-testid="quoteTweet"><div>Replying to @other</div>
        <div data-testid="tweetText">A quoted reset.</div>
        <a href="/thsottiaux/status/899"><time datetime="2026-09-03T00:00:00Z"></time></a>
      </div>
      <a href="/thsottiaux/status/900"><time datetime="2026-09-04T00:00:00Z"></time></a>
    </article>`);
    expect(extractXPosts(dom.window.document, 'thsottiaux')).toEqual([expect.objectContaining({
      id: '900', text: 'Worth reading.', quotedText: 'A quoted reset.', kind: 'quote',
    })]);
  });
  it('extracts account posts and ignores pure reposts and foreign tweets', () => {
    const dom = new JSDOM(`<main>
      <article data-testid="tweet">
        <div data-testid="User-Name">Tibo @thsottiaux</div>
        <div data-testid="tweetText">Codex resets will continue tomorrow.</div>
        <a href="/thsottiaux/status/200"><time datetime="2026-07-31T04:55:00.000Z"></time></a>
      </article>
      <article data-testid="tweet">
        <div data-testid="socialContext">Tibo reposted</div>
        <div data-testid="User-Name">Other @other</div>
        <div data-testid="tweetText">Not ours</div>
        <a href="/other/status/199"><time datetime="2026-07-31T04:54:00.000Z"></time></a>
      </article>
      <article data-testid="tweet">
        <div data-testid="User-Name">Other @other</div>
        <div data-testid="tweetText">Foreign post</div>
        <a href="/other/status/198"><time datetime="2026-07-31T04:53:00.000Z"></time></a>
      </article>
    </main>`);

    expect(extractXPosts(dom.window.document, 'thsottiaux')).toEqual([
      expect.objectContaining({
        id: '200',
        text: 'Codex resets will continue tomorrow.',
        kind: 'original',
        sourceIds: ['x-browser'],
      }),
    ]);
  });

  it('recognizes replies and quote context', () => {
    const dom = new JSDOM(`<article data-testid="tweet">
      <div data-testid="User-Name">Tibo @thsottiaux</div>
      <div data-testid="reply">Replying to @openai</div>
      <div data-testid="tweetText">Yes, about to reset Codex.</div>
      <div data-testid="quoteTweet"><div data-testid="tweetText">Usage limits are tight</div></div>
      <a href="/thsottiaux/status/201"><time datetime="2026-07-31T04:56:00.000Z"></time></a>
    </article>`);

    expect(extractXPosts(dom.window.document, 'thsottiaux')[0]).toMatchObject({
      id: '201',
      kind: 'reply',
      quotedText: 'Usage limits are tight',
    });
  });

  it('does not treat the universal reply action as reply context', () => {
    const dom = new JSDOM(`<article data-testid="tweet">
      <div data-testid="User-Name">Tibo @thsottiaux</div>
      <div data-testid="tweetText">Codex reset is complete.</div>
      <button data-testid="reply" aria-label="Reply"></button>
      <a href="/thsottiaux/status/202"><time datetime="2026-07-31T04:57:00.000Z"></time></a>
    </article>`);

    expect(extractXPosts(dom.window.document, 'thsottiaux')[0]).toMatchObject({
      id: '202',
      kind: 'original',
    });
  });
});

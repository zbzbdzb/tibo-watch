import type { MonitoredPost, PostKind } from '../../shared/domain';

export const X_DOM_SELECTORS = {
  tweet: 'article[data-testid="tweet"]',
  socialContext: '[data-testid="socialContext"]',
  statusLink: 'a[href*="/status/"]',
  tweetText: '[data-testid="tweetText"]',
  quoteTweet: '[data-testid="quoteTweet"]',
} as const;

const QUOTED_CONTENT = '[data-testid="quoteTweet"], [data-testid="card.wrapper"], [role="link"][tabindex="0"]';

function elementText(element: Element | null): string {
  return element?.textContent?.trim() ?? '';
}

export function extractXPosts(document: Document, handle: string): MonitoredPost[] {
  const normalizedHandle = handle.replace(/^@/, '').toLowerCase();

  return [...document.querySelectorAll(X_DOM_SELECTORS.tweet)].flatMap(
    (article): MonitoredPost[] => {
      if (article.parentElement?.closest(X_DOM_SELECTORS.tweet)) return [];
      const isPrimary = (element: Element): boolean =>
        element.closest(X_DOM_SELECTORS.tweet) === article && !element.closest(QUOTED_CONTENT);
      if (/repost|转发|轉發/i.test(elementText(
        [...article.querySelectorAll(X_DOM_SELECTORS.socialContext)].find(isPrimary) ?? null,
      ))) {
        return [];
      }

      const links = [...article.querySelectorAll<HTMLAnchorElement>(X_DOM_SELECTORS.statusLink)];
      // Resolve the primary timestamp first; searching for the requested author anywhere
      // in an article can misattribute a foreign post which quotes that author.
      const permalink = links.find((link) => isPrimary(link) && link.querySelector('time'));
      const match = permalink?.getAttribute('href')?.match(/\/([^/]+)\/status\/(\d+)/i);
      if (!match || !match[1] || !match[2] || match[1].toLowerCase() !== normalizedHandle) return [];

      const author = [...article.querySelectorAll('[data-testid="User-Name"]')].find(isPrimary);
      const authorHandle = author?.textContent?.match(/@([a-zA-Z0-9_]+)/)?.[1]?.toLowerCase();
      if (authorHandle && authorHandle !== normalizedHandle) return [];

      const textNodes = [...article.querySelectorAll(X_DOM_SELECTORS.tweetText)];
      const primaryText = textNodes.find(isPrimary);
      const quoteText = textNodes.find((node) => node.closest(QUOTED_CONTENT));
      const createdAt = permalink?.querySelector('time')?.getAttribute('datetime');
      if (!primaryText || !elementText(primaryText) || !createdAt || !Number.isFinite(Date.parse(createdAt))) return [];

      const primaryContext = article.cloneNode(true) as Element;
      primaryContext.querySelectorAll(QUOTED_CONTENT).forEach((node) => node.remove());

      let kind: PostKind = 'original';
      if (/Replying to|正在回复|回复给|回覆給/i.test(primaryContext.textContent ?? '')) {
        kind = 'reply';
      } else if (quoteText) {
        kind = 'quote';
      }

      return [
        {
          id: match[2],
          authorHandle: normalizedHandle,
          text: elementText(primaryText),
          createdAt: new Date(createdAt).toISOString(),
          url: `https://x.com/${normalizedHandle}/status/${match[2]}`,
          kind,
          quotedText: quoteText ? elementText(quoteText) : null,
          sourceIds: ['x-browser'],
        },
      ];
    },
  );
}

import type { MonitoredPost, PostKind } from '../../shared/domain';

export const X_DOM_SELECTORS = {
  tweet: 'article[data-testid="tweet"]',
  socialContext: '[data-testid="socialContext"]',
  statusLink: 'a[href*="/status/"]',
  tweetText: '[data-testid="tweetText"]',
  quoteTweet: '[data-testid="quoteTweet"]',
  reply: '[data-testid="reply"]',
} as const;

function elementText(element: Element | null): string {
  return element?.textContent?.trim() ?? '';
}

export function extractXPosts(document: Document, handle: string): MonitoredPost[] {
  const normalizedHandle = handle.replace(/^@/, '').toLowerCase();

  return [...document.querySelectorAll(X_DOM_SELECTORS.tweet)].flatMap(
    (article): MonitoredPost[] => {
      if (elementText(article.querySelector(X_DOM_SELECTORS.socialContext)).toLowerCase().includes('repost')) {
        return [];
      }

      const links = [...article.querySelectorAll<HTMLAnchorElement>(X_DOM_SELECTORS.statusLink)];
      const permalink = links.find((link) =>
        new RegExp(`/${normalizedHandle}/status/\\d+`, 'i').test(link.getAttribute('href') ?? ''),
      );
      const match = permalink?.getAttribute('href')?.match(/\/([^/]+)\/status\/(\d+)/i);
      if (!match || !match[1] || !match[2] || match[1].toLowerCase() !== normalizedHandle) return [];

      const textNodes = [...article.querySelectorAll(X_DOM_SELECTORS.tweetText)];
      const primaryText = textNodes.find((node) => !node.closest(X_DOM_SELECTORS.quoteTweet));
      const quoteText = article.querySelector(`${X_DOM_SELECTORS.quoteTweet} ${X_DOM_SELECTORS.tweetText}`);
      const createdAt = permalink?.querySelector('time')?.getAttribute('datetime');
      if (!primaryText || !createdAt) return [];

      let kind: PostKind = 'original';
      if (article.querySelector(X_DOM_SELECTORS.reply) || /Replying to/i.test(article.textContent ?? '')) {
        kind = 'reply';
      } else if (quoteText) {
        kind = 'quote';
      }

      return [
        {
          id: match[2],
          authorHandle: match[1],
          text: elementText(primaryText),
          createdAt,
          url: `https://x.com/${match[1]}/status/${match[2]}`,
          kind,
          quotedText: quoteText ? elementText(quoteText) : null,
          sourceIds: ['x-browser'],
        },
      ];
    },
  );
}

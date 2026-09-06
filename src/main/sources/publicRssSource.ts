import { XMLParser } from 'fast-xml-parser';

import type { CheckContext, MonitoredPost, PostSource, SourceCheckResult } from '../../shared/domain';

const INSTANCE_REGISTRY =
  'https://raw.githubusercontent.com/wiki/zedeus/nitter/Instances.md';
const FALLBACK_INSTANCES = ['https://nitter.privacyredirect.com'];

interface RssItem {
  title?: string;
  description?: string;
  pubDate?: string;
  guid?: string | { '#text'?: string };
  link?: string;
}

export interface PublicRssSourceOptions {
  fetcher?: typeof fetch;
  registryUrl?: string;
  requestTimeoutMs?: number;
  maxInstancesPerCheck?: number;
}

function stripMarkup(value: string): string {
  return value
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(?:p|div)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Math.min(Number(code), 0x10ffff)))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function descriptionParts(html: string): { primary: string; quotedText: string | null } {
  // Nitter puts quoted context in a quote block. Only split when an explicit
  // boundary exists; a flat description containing a status card is ambiguous.
  let quotedText: string | null = null;
  const withoutQuote = html.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, quote: string) => {
    quotedText = stripMarkup(quote) || null;
    return '';
  });
  const quoteBoundary = withoutQuote.search(/<(?:div|p)\b[^>]*(?:class|data-testid)=["'][^"']*(?:quote|quoted-tweet)/i);
  const primaryHtml = quoteBoundary >= 0 ? withoutQuote.slice(0, quoteBoundary) : withoutQuote;
  const cleaned = primaryHtml
    .replace(/<p\b[^>]*>\s*<a\b[^>]*>\s*(?:Read more|Show more|View (?:post|tweet)|(?:Image|Video|Photo)(?: \d+)?)\s*<\/a>\s*<\/p>/gi, '')
    .replace(/<a\b[^>]*>\s*(?:Read more|Show more|View (?:post|tweet))\s*<\/a>/gi, '');
  return { primary: stripMarkup(cleaned), quotedText };
}

export function parseInstanceRegistry(markdown: string): string[] {
  const results: string[] = [];
  const seen = new Set<string>();
  const publicSection = markdown.split(/## Public\s*/i)[1]?.split(/###\s+(?:Tor|I2P)/i)[0] ?? markdown;
  for (const line of publicSection.split(/\r?\n/)) {
    if (!/:white_check_mark:|✅|\bworking\b/i.test(line)) continue;
    const match = line.match(/\[[^\]]+\]\((https:\/\/[-a-zA-Z0-9.]+)\/?\)/);
    if (!match?.[1]) continue;
    const url = match[1].replace(/\/$/, '');
    if (seen.has(url)) continue;
    seen.add(url);
    results.push(url);
  }
  return results;
}

export function parseNitterRss(xml: string, sourceId: string): MonitoredPost[] {
  const parser = new XMLParser({ ignoreAttributes: false, processEntities: true });
  const document = parser.parse(xml) as { rss?: { channel?: { item?: RssItem | RssItem[] } } };
  const rawItems = document.rss?.channel?.item;
  const items = rawItems ? (Array.isArray(rawItems) ? rawItems : [rawItems]) : [];

  return items.flatMap((item): MonitoredPost[] => {
    const rawTitle = stripMarkup(String(item.title ?? ''));
    if (/^(?:RT by @|RT @)/i.test(rawTitle)) return [];

    const link = String(item.link ?? '');
    const statusMatch = link.match(/^https?:\/\/[^/]+\/([^/]+)\/status\/(\d+)(?:[/?#]|$)/i);
    if (!statusMatch) return [];

    const authorHandle = statusMatch[1]!.toLowerCase();
    if (authorHandle !== 'thsottiaux') return [];
    const statusId = statusMatch[2]!;
    const isReply = /^R to @/i.test(rawTitle);
    const replyTitle = rawTitle.replace(/^R to @[^:]+:\s*/i, '');
    const descriptionHtml = String(item.description ?? '');
    const { primary: description, quotedText } = descriptionParts(descriptionHtml);
    const title = isReply ? replyTitle : rawTitle;
    const titlePrefix = title.replace(/(?:\.{3}|…)(?:\s*(?:Read more|Show more))?\s*$/i, '').trim();
    // A longer description is used only when it expands the same primary text.
    // Unknown flat quote/card formats fall back to the title, never concatenation.
    const withoutBoilerplate = descriptionHtml.replace(/<a\b[^>]*>\s*(?:Read more|Show more|View (?:post|tweet))\s*<\/a>/gi, '');
    const hasUnsplitCard = /href=["'][^"']*\/status\/\d+/i.test(withoutBoilerplate) &&
      !/<blockquote\b|(?:class|data-testid)=["'][^"']*quote/i.test(descriptionHtml);
    const text = !hasUnsplitCard && description && (!title ||
      (description.length >= title.length && description.startsWith(titlePrefix)))
      ? description : title || description;
    const date = new Date(String(item.pubDate ?? ''));
    if (!text || !Number.isFinite(date.getTime())) return [];

    return [
      {
        id: statusId,
        authorHandle,
        text,
        createdAt: date.toISOString(),
        url: `https://x.com/${authorHandle}/status/${statusId}`,
        kind: isReply ? 'reply' : quotedText ? 'quote' : 'original',
        quotedText,
        sourceIds: [sourceId],
      },
    ];
  });
}

export class PublicRssSource implements PostSource {
  readonly id = 'public-rss';
  lastWorkingInstance: string | null = null;

  private readonly fetcher: typeof fetch;
  private readonly registryUrl: string;
  private readonly requestTimeoutMs: number;
  private readonly maxInstancesPerCheck: number;
  private cachedInstances: string[] | null = null;

  constructor(options: PublicRssSourceOptions = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.registryUrl = options.registryUrl ?? INSTANCE_REGISTRY;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 5_000;
    this.maxInstancesPerCheck = options.maxInstancesPerCheck ?? 5;
  }

  async check(context: CheckContext): Promise<SourceCheckResult> {
    const startedAt = Date.now();
    const candidates = await this.instances(context.signal);
    const ordered = [...new Set([
      ...(this.lastWorkingInstance ? [this.lastWorkingInstance] : []),
      ...candidates,
      ...FALLBACK_INSTANCES,
    ])].slice(0, this.maxInstancesPerCheck);

    for (const instance of ordered) {
      try {
        const response = await this.fetchWithTimeout(
          `${instance}/thsottiaux/with_replies/rss`,
          context.signal,
          { headers: { 'user-agent': 'Tibo-Watch/0.1 (+desktop monitor)' } },
        );
        if (!response.ok) continue;
        const posts = parseNitterRss(await response.text(), this.id);
        if (posts.length === 0) continue;
        this.lastWorkingInstance = instance;
        return {
          sourceId: this.id,
          checkedAt: context.checkedAt,
          state: 'online',
          posts,
          latencyMs: Date.now() - startedAt,
          errorCode: null,
        };
      } catch (error) {
        if (context.signal.aborted) throw error;
      }
    }

    return {
      sourceId: this.id,
      checkedAt: context.checkedAt,
      state: 'error',
      posts: [],
      latencyMs: Date.now() - startedAt,
      errorCode: 'RSS_INSTANCES_UNAVAILABLE',
    };
  }

  private async instances(signal: AbortSignal): Promise<string[]> {
    if (this.cachedInstances) return this.cachedInstances;
    try {
      const response = await this.fetchWithTimeout(this.registryUrl, signal);
      if (response.ok) {
        const parsed = parseInstanceRegistry(await response.text());
        if (parsed.length > 0) {
          this.cachedInstances = parsed;
          return parsed;
        }
      }
    } catch (error) {
      if (signal.aborted) throw error;
    }
    this.cachedInstances = FALLBACK_INSTANCES;
    return this.cachedInstances;
  }

  private fetchWithTimeout(
    url: string,
    outerSignal: AbortSignal,
    init: Omit<RequestInit, 'signal'> = {},
  ): Promise<Response> {
    const timeoutSignal = AbortSignal.timeout(this.requestTimeoutMs);
    return this.fetcher(url, { ...init, signal: AbortSignal.any([outerSignal, timeoutSignal]) });
  }
}

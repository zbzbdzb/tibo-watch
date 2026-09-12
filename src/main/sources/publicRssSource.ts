import { XMLParser, XMLValidator } from 'fast-xml-parser';

import type { CheckContext, MonitoredPost, PostSource, SourceCheckResult } from '../../shared/domain';

const INSTANCE_REGISTRY =
  'https://raw.githubusercontent.com/wiki/zedeus/nitter/Instances.md';
const FALLBACK_INSTANCES = ['https://nitter.privacyredirect.com'];
// Verified with the application's parser on 2026-09-12. The community
// registry can lag behind working instances, so try this before discovery.
const PREFERRED_INSTANCES = ['https://nitter.perennialte.ch'];

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
  preferredInstances?: readonly string[];
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
  const publicSection = markdown.split(/^## Public[ \t]*\r?$/im)[1]?.split(/^#{1,3}[ \t]/m)[0] ?? '';
  for (const line of publicSection.split(/\r?\n/)) {
    // Only the first URL column of a table row is an instance. Prose such as
    // "working right now, see nitter-status" is not a feed server.
    const match = line.match(/^\|\s*\[[^\]]+\]\((https:\/\/[-a-zA-Z0-9.]+)\/?\)\s*\|\s*([^|]+)\|\s*([^|]+)\|/);
    if (!match?.[1]) continue;
    if (![match[2], match[3]].every(cell => /^(?::white_check_mark:|✅|✔️?|working)$/i.test(cell!.trim()))) continue;
    const url = match[1].replace(/\/$/, '');
    if (seen.has(url)) continue;
    seen.add(url);
    results.push(url);
  }
  return results;
}

export function parseNitterRss(xml: string, sourceId: string): MonitoredPost[] {
  if (XMLValidator.validate(xml) !== true) return [];
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
  private readonly preferredInstances: readonly string[];
  private cachedInstances: string[] | null = null;

  constructor(options: PublicRssSourceOptions = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.registryUrl = options.registryUrl ?? INSTANCE_REGISTRY;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 5_000;
    this.maxInstancesPerCheck = options.maxInstancesPerCheck ?? 5;
    this.preferredInstances = options.preferredInstances ?? PREFERRED_INSTANCES;
  }

  async check(context: CheckContext): Promise<SourceCheckResult> {
    const startedAt = Date.now();
    context.signal.throwIfAborted();
    const tried = new Set<string>();
    const tryInstances = async (instances: readonly string[]): Promise<SourceCheckResult | null> => {
      for (const instance of instances) {
        context.signal.throwIfAborted();
        if (tried.size >= this.maxInstancesPerCheck) break;
        if (tried.has(instance)) continue;
        tried.add(instance);
        try {
          const response = await this.fetchWithTimeout(
            `${instance}/thsottiaux/with_replies/rss`,
            context.signal,
            { headers: { 'user-agent': 'Tibo-Watch/0.1 (+desktop monitor)' }, credentials: 'omit', cache: 'no-store', redirect: 'manual' },
          );
          if (!response.ok) { await response.body?.cancel(); continue; }
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
      return null;
    };

    const preferred = await tryInstances([
      ...(this.lastWorkingInstance ? [this.lastWorkingInstance] : []), ...this.preferredInstances,
    ]);
    if (preferred) return preferred;
    if (tried.size < this.maxInstancesPerCheck) {
      const discovered = await tryInstances([...(await this.instances(context.signal)), ...FALLBACK_INSTANCES]);
      if (discovered) return discovered;
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
    // A temporary registry failure must not poison discovery for this entire
    // process lifetime. Reattempt it on a later check when needed.
    return [];
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

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

function textContent(value: RssItem['guid']): string {
  if (typeof value === 'string') return value;
  return value?.['#text'] ?? '';
}

function stripMarkup(value: string): string {
  return value
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .trim();
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
    const statusMatch = link.match(/\/([^/]+)\/status\/(\d+)/);
    if (!statusMatch) return [];

    const authorHandle = statusMatch[1]!;
    const statusId = statusMatch[2]!;
    const id = textContent(item.guid) || statusId;
    const isReply = /^R to @/i.test(rawTitle);
    const replyTitle = rawTitle.replace(/^R to @[^:]+:\s*/i, '');
    const description = stripMarkup(String(item.description ?? ''));
    const text = isReply ? replyTitle || description : rawTitle || description;

    return [
      {
        id,
        authorHandle,
        text,
        createdAt: new Date(String(item.pubDate ?? '')).toISOString(),
        url: `https://x.com/${authorHandle}/status/${statusId}`,
        kind: isReply ? 'reply' : 'original',
        quotedText: null,
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

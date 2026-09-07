import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomInt } from 'node:crypto';

import { z } from 'zod';

import type { MonitoredPost, SourceState } from '../../shared/domain';
import { CHROME_COLLECTOR_REVISION, COLLECTION_REASONS, type ChromePageDiagnostic } from '../../shared/chromeDiagnostics';

export const CHROME_COMPANION_EXTENSION_ID = 'cnhojdncaimngpikaokmgpnihhglnmkn';
export const CHROME_COMPANION_ORIGIN = `chrome-extension://${CHROME_COMPANION_EXTENSION_ID}`;
export const CHROME_COMPANION_PORT = 47_652;
export const CHROME_COMPANION_PROTOCOL_VERSION = 2;
const PAGE_URLS = ['https://x.com/thsottiaux', 'https://x.com/thsottiaux/with_replies'] as const;

const MAX_BODY_BYTES = 256 * 1024;

const postSchema = z.object({
  id: z.string().regex(/^\d+$/),
  authorHandle: z.literal('thsottiaux'),
  text: z.string().min(1).max(20_000),
  createdAt: z.iso.datetime(),
  url: z.url().refine((value) => /^https:\/\/x\.com\/thsottiaux\/status\/\d+$/.test(value)),
  kind: z.enum(['original', 'reply', 'quote']),
  quotedText: z.string().max(20_000).nullable(),
  sourceIds: z.tuple([z.literal('x-browser')]),
}).strict().refine((post) => post.url.endsWith(`/status/${post.id}`));

const legacyPayloadSchema = z.object({
  pageUrl: z.enum(PAGE_URLS),
  posts: z.array(postSchema).max(100),
}).strict();
const currentPayloadSchema = z.object({
  protocolVersion: z.literal(CHROME_COMPANION_PROTOCOL_VERSION),
  generation: z.number().int().nonnegative().safe(),
  runId: z.uuid(),
  pageUrl: z.enum(PAGE_URLS),
  view: z.enum(['posts', 'replies']),
  checkedAt: z.iso.datetime(),
  result: z.enum(['ready', 'empty', 'loading', 'error', 'needs_login']),
  pendingDetails: z.number().int().min(0).max(100).optional(),
  diagnostics: z.object({
    extensionVersion: z.string().regex(/^\d+\.\d+\.\d+(?:\.\d+)?$/).max(32),
    collectorRevision: z.literal(CHROME_COLLECTOR_REVISION),
    reason: z.enum(COLLECTION_REASONS),
    samples: z.number().int().min(0).max(30),
  }).strict().optional(),
  posts: z.array(postSchema).max(100),
}).strict().refine((payload) =>
  payload.pageUrl === PAGE_URLS[payload.view === 'posts' ? 0 : 1] &&
  (payload.result !== 'ready' || payload.posts.length > 0),
);
const payloadSchema = z.union([currentPayloadSchema, legacyPayloadSchema]);

export type ChromeCompanionPayload = z.infer<typeof payloadSchema>;
type PageResult = z.infer<typeof currentPayloadSchema>['result'] | 'legacy';
interface PageCollection {
  result: PageResult;
  checkedAt: number;
  receivedAt: number;
  runId: string | null;
  pendingDetails: number;
  diagnostic: ChromePageDiagnostic;
}

function richerText(left: string | null, right: string | null): string | null {
  if (left === null) return right;
  if (right === null) return left;
  return left.length !== right.length ? left.length > right.length ? left : right :
    left.localeCompare(right) <= 0 ? left : right;
}
export interface ChromeCollectionStatus {
  state: SourceState;
  errorCode: string | null;
}

export class ChromeCompanionStore {
  private readonly posts = new Map<string, MonitoredPost>();
  private lastReceivedAt: number | null = null;
  private firstReceivedAt: number | null = null;
  private lastCompleteAt: number | null = null;
  private readonly pages = new Map<string, PageCollection>();
  private monitoringEnabled = true;
  private hasCurrentProtocol = false;
  private hasCurrentCollector = false;
  private readonly now: () => number;
  private readonly freshnessMs: number;

  constructor(options: { now?: () => number; freshnessMs?: number } = {}) {
    this.now = options.now ?? Date.now;
    this.freshnessMs = options.freshnessMs ?? 10 * 60_000;
  }

  ingest(payload: ChromeCompanionPayload): void {
    // Also validate direct callers: transport receipt is not collection success.
    payload = payloadSchema.parse(payload);
    if (!this.monitoringEnabled) return;
    const current = 'protocolVersion' in payload ? payload : null;
    if (this.hasCurrentCollector && !current?.diagnostics) return;
    if (current?.diagnostics && !this.hasCurrentCollector) {
      this.hasCurrentCollector = true;
      this.pages.clear();
      this.firstReceivedAt = null;
      this.lastCompleteAt = null;
    }
    // A request already in flight from the replaced worker may arrive after the
    // new worker. It must not regress an observed v2 session to "needs reload".
    if (!current && this.hasCurrentProtocol) return;
    // A validated v2 message proves the corrected worker is running. Any other
    // legacy-only view is now awaiting a current capture, not awaiting a reload.
    if (current) {
      this.hasCurrentProtocol = true;
      for (const [url, page] of this.pages) if (page.result === 'legacy') this.pages.delete(url);
    }
    // Old parsers could misattribute a quoted Tibo permalink to foreign primary
    // text. Accept their transport/status only; never introduce unverified posts.
    for (const post of current?.posts ?? []) {
      const previous = this.posts.get(post.id);
      const kinds = { original: 0, reply: 1, quote: 2 };
      this.posts.set(post.id, previous ? {
        ...post,
        text: richerText(previous.text, post.text)!,
        quotedText: richerText(previous.quotedText, post.quotedText),
        kind: kinds[previous.kind] > kinds[post.kind] ? previous.kind : post.kind,
        createdAt: [previous.createdAt, post.createdAt].sort()[0]!,
        sourceIds: [...post.sourceIds],
      } : { ...post, sourceIds: [...post.sourceIds] });
    }
    // Keep memory bounded without discarding the current verified page batch.
    if (this.posts.size > 1_000) {
      for (const post of this.readPosts().slice(1_000)) this.posts.delete(post.id);
    }
    this.lastReceivedAt = this.now();
    this.firstReceivedAt ??= this.now();
    const checkedAt = current ? current.checkedAt : new Date(this.now()).toISOString();
    const previousPage = this.pages.get(payload.pageUrl);
    if (previousPage && Date.parse(checkedAt) < previousPage.checkedAt) return;
    this.pages.set(payload.pageUrl, {
      result: current ? current.result : 'legacy',
      checkedAt: current ? Date.parse(current.checkedAt) : this.now(),
      receivedAt: this.now(),
      runId: current ? current.runId : null,
      pendingDetails: current?.pendingDetails ?? 0,
      diagnostic: {
        view: payload.pageUrl === PAGE_URLS[0] ? 'posts' : 'replies',
        extensionVersion: current?.diagnostics?.extensionVersion ?? null,
        collectorRevision: current?.diagnostics?.collectorRevision ?? null,
        reason: current?.diagnostics?.reason ?? 'old_collector',
        samples: current?.diagnostics?.samples ?? 0,
        result: current?.result ?? 'legacy', checkedAt,
        receivedAt: new Date(this.now()).toISOString(),
        postCount: current?.posts.length ?? 0, pendingDetails: current?.pendingDetails ?? 0,
      },
    });
    const pair = PAGE_URLS.map((url) => this.pages.get(url));
    if (pair.every((page) => page && this.isFresh(page) && this.isComplete(page)) &&
        pair[0]?.runId === pair[1]?.runId && pair[0]?.runId) {
      this.lastCompleteAt = Math.min(...pair.map((page) => page!.checkedAt));
    }
  }

  isConnected(): boolean {
    return this.collectionStatus().state === 'online';
  }

  lastSuccessfulCollectionAt(): string | null {
    return this.lastCompleteAt === null ? null : new Date(this.lastCompleteAt).toISOString();
  }

  diagnostics(): ChromePageDiagnostic[] {
    return PAGE_URLS.flatMap(url => { const page = this.pages.get(url); return page ? [{ ...page.diagnostic }] : []; });
  }

  collectionStatus(): ChromeCollectionStatus {
    if (!this.monitoringEnabled) return { state: 'disabled', errorCode: 'X_COLLECTION_DISABLED' };
    if (this.lastReceivedAt === null) return { state: 'needs_login', errorCode: 'X_COMPANION_WAITING' };
    const pages = PAGE_URLS.map((url) => this.pages.get(url));
    if (pages.some(page => page && !this.isFresh(page))) {
      return { state: 'stale', errorCode: 'X_COLLECTION_REPORT_STALE' };
    }
    if (pages.some((page) => page?.result === 'needs_login')) {
      return { state: 'needs_login', errorCode: 'X_SESSION_EXPIRED' };
    }
    if (pages.some((page) => page?.result === 'legacy')) {
      return { state: 'stale', errorCode: 'X_COMPANION_LEGACY_NEEDS_REFRESH' };
    }
    if (!this.hasCurrentCollector) return { state: 'partial', errorCode: 'X_COMPANION_COLLECTOR_NEEDS_REFRESH' };
    const failures = pages.map((page, index) => {
      const view = index === 0 ? 'POSTS' : 'REPLIES';
      if (!page) return `${view}_WAITING`;
      if (!this.isFresh(page)) return `${view}_STALE`;
      return this.isComplete(page) ? null : `${view}_${page.result.toUpperCase()}`;
    }).filter(Boolean);
    if (failures.length) {
      const errorCode = `X_COLLECTION_${failures.join('_')}`;
      if (failures.some((failure) => failure!.endsWith('_STALE'))) return { state: 'stale', errorCode };
      if (failures.some((failure) => failure!.endsWith('_ERROR'))) return { state: 'error', errorCode };
      // A live transport must not conceal a timeline that never finishes.
      if (this.completionOverdue()) return { state: 'error', errorCode: `${errorCode}_INCOMPLETE` };
      return { state: 'syncing', errorCode };
    }
    if (pages[0]?.runId !== pages[1]?.runId) {
      return { state: this.completionOverdue() ? 'error' : 'syncing',
        errorCode: this.completionOverdue() ? 'X_COLLECTION_PARTIAL_RUN_INCOMPLETE' :
          this.lastCompleteAt !== null ? 'X_COLLECTION_SYNCING_PREVIOUS_OK' : 'X_COLLECTION_PARTIAL_RUN' };
    }
    if (pages.some((page) => page!.pendingDetails > 0)) {
      return { state: 'partial', errorCode: 'X_COLLECTION_DETAILS_PENDING' };
    }
    return { state: 'online', errorCode: null };
  }

  private isFresh(page: PageCollection): boolean {
    return this.now() - page.receivedAt <= this.freshnessMs &&
      this.now() - page.checkedAt <= this.freshnessMs && page.checkedAt <= this.now() + 60_000;
  }

  private isComplete(page: PageCollection): boolean {
    return page.result === 'ready' || page.result === 'empty';
  }

  private completionOverdue(): boolean {
    return this.now() - (this.lastCompleteAt ?? this.firstReceivedAt ?? this.now()) > this.freshnessMs;
  }

  setMonitoringEnabled(enabled: boolean): void {
    if (this.monitoringEnabled === enabled) return;
    this.monitoringEnabled = enabled;
    this.pages.clear();
    this.lastReceivedAt = null;
    this.firstReceivedAt = null;
    this.lastCompleteAt = null;
    this.hasCurrentProtocol = false;
    this.hasCurrentCollector = false;
  }

  readPosts(): MonitoredPost[] {
    return [...this.posts.values()]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((post) => ({ ...post, sourceIds: [...post.sourceIds] }));
  }

  clear(): void {
    this.posts.clear();
    this.lastReceivedAt = null;
    this.firstReceivedAt = null;
    this.lastCompleteAt = null;
    this.pages.clear();
    this.hasCurrentProtocol = false;
    this.hasCurrentCollector = false;
  }
}

export class ChromeCompanionBridge {
  private server: Server | null = null;
  private readonly host = '127.0.0.1';
  private readonly requestedPort: number;
  private collectionEnabled = false;
  private generation = randomInt(0, 2 ** 48 - 1);
  private readonly now: () => number;
  private readonly onCollectionChanged: (() => void | Promise<void>) | undefined;
  readonly store: ChromeCompanionStore;

  constructor(options: { port?: number; now?: () => number; onCollectionChanged?: () => void | Promise<void> } = {}) {
    this.requestedPort = options.port ?? CHROME_COMPANION_PORT;
    this.now = options.now ?? Date.now;
    this.onCollectionChanged = options.onCollectionChanged;
    this.store = new ChromeCompanionStore({
      ...(options.now ? { now: options.now } : {}),
    });
    this.store.setMonitoringEnabled(false);
  }

  setMonitoringEnabled(enabled: boolean): void {
    if (this.collectionEnabled === enabled) return;
    this.collectionEnabled = enabled;
    this.generation += 1;
    this.store.setMonitoringEnabled(enabled);
    this.collectionChanged();
  }

  private collectionChanged(): void {
    try {
      void Promise.resolve(this.onCollectionChanged?.()).catch(() => undefined);
    } catch {
      // UI refresh failures must not turn a validated ingestion into HTTP 400.
    }
  }

  async start(): Promise<void> {
    if (this.server) return;
    this.server = createServer((request, response) => {
      void this.handle(request, response);
    });
    await new Promise<void>((resolve, reject) => {
      const server = this.server;
      if (!server) return reject(new Error('Chrome companion server was not created'));
      const onError = (error: Error) => {
        server.off('listening', onListening);
        this.server = null;
        reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(this.requestedPort, this.host);
    });
  }

  async stop(): Promise<void> {
    this.setMonitoringEnabled(false);
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }

  url(): string {
    const address = this.server?.address();
    if (!address || typeof address === 'string') throw new Error('Chrome companion bridge is not listening');
    return `http://${this.host}:${(address as AddressInfo).port}`;
  }

  isConnected(): boolean {
    return this.store.isConnected();
  }

  readPosts(): MonitoredPost[] {
    return this.store.readPosts();
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const origin = request.headers.origin;
    const extensionId = request.headers['x-tibo-watch-extension'];
    // Chromium MV3 workers omit Origin on GET fetch, including requests with
    // custom headers. POST fetch still carries the extension Origin. The narrow
    // exception only exposes non-sensitive permission/protocol health; it does
    // not authorize ingestion or grant any web page CORS access.
    const workerHealthProbe = origin === undefined && request.method === 'GET' &&
      request.url === '/health' && extensionId === CHROME_COMPANION_EXTENSION_ID;
    if (origin !== CHROME_COMPANION_ORIGIN && !workerHealthProbe) {
      response.writeHead(403).end();
      return;
    }

    if (origin === CHROME_COMPANION_ORIGIN) {
      response.setHeader('Access-Control-Allow-Origin', CHROME_COMPANION_ORIGIN);
    }
    response.setHeader('Vary', 'Origin');
    if (request.method === 'OPTIONS') {
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Tibo-Watch-Extension');
      response.writeHead(204).end();
      return;
    }
    if (extensionId !== CHROME_COMPANION_EXTENSION_ID) {
      response.writeHead(403).end();
      return;
    }
    if (request.method === 'GET' && request.url === '/health') {
      response.setHeader('Content-Type', 'application/json');
      response.setHeader('Cache-Control', 'no-store');
      // A non-success HTTP status also stops pre-v2 workers which gate work on
      // response.ok rather than understanding collectionEnabled/generation.
      response.writeHead(this.collectionEnabled ? 200 : 409).end(JSON.stringify({
        ok: true,
        collectionEnabled: this.collectionEnabled,
        generation: this.generation,
        protocolVersion: CHROME_COMPANION_PROTOCOL_VERSION,
        collectorRevision: CHROME_COLLECTOR_REVISION,
      }));
      return;
    }
    if (request.method !== 'POST' || request.url !== '/posts') {
      response.writeHead(404).end();
      return;
    }

    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    for await (const rawChunk of request) {
      const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
      size += chunk.length;
      if (size > MAX_BODY_BYTES) tooLarge = true;
      else if (!tooLarge) chunks.push(chunk);
    }
    if (tooLarge) {
      response.writeHead(413).end();
      return;
    }

    try {
      const payload = payloadSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      if (!this.collectionEnabled) {
        response.writeHead(409).end();
        return;
      }
      if ('protocolVersion' in payload && (payload.generation !== this.generation ||
          Date.parse(payload.checkedAt) > this.now() + 60_000)) {
        response.writeHead(409).end();
        return;
      }
      this.store.ingest(payload);
      response.writeHead(204).end();
      this.collectionChanged();
    } catch {
      response.writeHead(400).end();
    }
  }
}

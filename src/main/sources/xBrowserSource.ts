import type { CheckContext, MonitoredPost, PostSource, SourceCheckResult } from '../../shared/domain';

export interface XBrowserAdapter {
  isLoggedIn(): Promise<boolean>;
  readPosts(signal: AbortSignal): Promise<MonitoredPost[]>;
  collectionStatus?(): { state: SourceCheckResult['state']; errorCode: string | null };
}

export class XBrowserSource implements PostSource {
  readonly id = 'x-browser';

  constructor(
    private readonly adapter: XBrowserAdapter,
    private readonly enabled: () => boolean,
  ) {}

  async check(context: CheckContext): Promise<SourceCheckResult> {
    const startedAt = Date.now();
    if (!this.enabled()) return this.result(context, 'disabled', [], null, startedAt);
    if (this.adapter.collectionStatus) {
      try {
        const status = this.adapter.collectionStatus();
        const posts = status.state === 'disabled' ? [] : await this.adapter.readPosts(context.signal);
        return this.result(context, status.state, posts, status.errorCode, startedAt);
      } catch (error) {
        if (context.signal.aborted) throw error;
        return this.result(context, 'error', [], 'X_BROWSER_READ_FAILED', startedAt);
      }
    }
    if (!(await this.adapter.isLoggedIn())) {
      return this.result(context, 'needs_login', [], 'X_SESSION_EXPIRED', startedAt);
    }
    try {
      const posts = await this.adapter.readPosts(context.signal);
      return this.result(context, 'online', posts, null, startedAt);
    } catch (error) {
      if (context.signal.aborted) throw error;
      return this.result(context, 'error', [], 'X_BROWSER_READ_FAILED', startedAt);
    }
  }

  private result(
    context: CheckContext,
    state: SourceCheckResult['state'],
    posts: MonitoredPost[],
    errorCode: string | null,
    startedAt: number,
  ): SourceCheckResult {
    return {
      sourceId: this.id,
      checkedAt: context.checkedAt,
      state,
      posts,
      latencyMs: Date.now() - startedAt,
      errorCode,
    };
  }
}

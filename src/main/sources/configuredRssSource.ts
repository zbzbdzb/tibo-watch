import type { CheckContext, PostSource, SourceCheckResult } from '../../shared/domain';

export class ConfiguredSource implements PostSource {
  readonly id: string;

  constructor(
    private readonly source: PostSource,
    private readonly enabled: () => boolean,
  ) {
    this.id = source.id;
  }

  check(context: CheckContext): Promise<SourceCheckResult> {
    if (this.enabled()) return this.source.check(context);
    return Promise.resolve({
      sourceId: this.id,
      checkedAt: context.checkedAt,
      state: 'disabled',
      posts: [],
      latencyMs: 0,
      errorCode: null,
    });
  }
}

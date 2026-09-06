import type { SourceState } from '../../shared/domain';

export interface SourceHealth {
  sourceId: string;
  state: SourceState;
  consecutiveFailures: number;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  errorCode?: string | null;
}

export class SourceHealthTracker {
  private readonly sources = new Map<string, SourceHealth>();
  private outageIncidentConsumed = false;

  constructor(sourceIds: string[]) {
    for (const sourceId of sourceIds) {
      this.sources.set(sourceId, {
        sourceId,
        state: 'disabled',
        consecutiveFailures: 0,
        lastCheckedAt: null,
        lastSuccessAt: null,
      });
    }
  }

  record(sourceId: string, succeeded: boolean, checkedAt: string): SourceHealth {
    return this.recordState(sourceId, succeeded ? 'online' : 'error', checkedAt);
  }

  recordState(sourceId: string, state: SourceState, checkedAt: string, errorCode: string | null = null): SourceHealth {
    const previous = this.sources.get(sourceId) ?? {
      sourceId,
      state: 'disabled' as const,
      consecutiveFailures: 0,
      lastCheckedAt: null,
      lastSuccessAt: null,
    };
    if (state === 'disabled') {
      const disabled = { ...previous, state, consecutiveFailures: 0, lastCheckedAt: checkedAt, errorCode: null };
      this.sources.set(sourceId, disabled);
      return disabled;
    }
    const succeeded = state === 'online';
    const consecutiveFailures = succeeded ? 0 : previous.consecutiveFailures + 1;
    const next: SourceHealth = {
      sourceId,
      state: succeeded ? 'online' : state === 'needs_login' ? state : consecutiveFailures >= 3 ? 'stale' : state,
      consecutiveFailures,
      lastCheckedAt: checkedAt,
      lastSuccessAt: succeeded ? checkedAt : previous.lastSuccessAt,
      errorCode,
    };
    this.sources.set(sourceId, next);

    if (succeeded) this.outageIncidentConsumed = false;
    return next;
  }

  get(sourceId: string): SourceHealth {
    const health = this.sources.get(sourceId);
    if (!health) throw new Error(`Unknown source: ${sourceId}`);
    return { ...health };
  }

  list(): SourceHealth[] {
    return [...this.sources.values()].map((health) => ({ ...health }));
  }

  consumeOutageIncident(): boolean {
    const activeSources = [...this.sources.values()].filter((health) => health.state !== 'disabled');
    const allStale = activeSources.length > 0 && activeSources.every(
      (health) => health.consecutiveFailures >= 3,
    );
    if (!allStale || this.outageIncidentConsumed) return false;
    this.outageIncidentConsumed = true;
    return true;
  }
}

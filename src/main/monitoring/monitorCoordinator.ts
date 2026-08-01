import { randomUUID } from 'node:crypto';

import type { AppDatabase } from '../storage/database';
import { decideSignalEvent } from '../events/signalPolicy';
import { SourceHealthTracker } from './sourceHealthTracker';
import type {
  Classifier,
  MonitoredPost,
  PostSource,
  SignalEvent,
  SourceCheckResult,
} from '../../shared/domain';

export interface CheckSummary {
  checkedAt: string;
  postsSeen: number;
  signalsEmitted: number;
  sourceResults: SourceCheckResult[];
  outageIncident: boolean;
}

export interface MonitorCoordinatorOptions {
  database: AppDatabase;
  sources: PostSource[];
  classifier: Classifier;
  onSignal: (event: SignalEvent) => void | Promise<void>;
  onOutage?: () => void | Promise<void>;
}

export class MonitorCoordinator {
  readonly health: SourceHealthTracker;

  private readonly database: AppDatabase;
  private readonly sources: PostSource[];
  private readonly classifier: Classifier;
  private readonly onSignal: MonitorCoordinatorOptions['onSignal'];
  private readonly onOutage?: MonitorCoordinatorOptions['onOutage'];
  private activeCheck: Promise<CheckSummary> | null = null;

  constructor(options: MonitorCoordinatorOptions) {
    this.database = options.database;
    this.sources = options.sources;
    this.classifier = options.classifier;
    this.onSignal = options.onSignal;
    this.onOutage = options.onOutage;
    this.health = new SourceHealthTracker(options.sources.map((source) => source.id));
  }

  checkNow(checkedAt = new Date().toISOString()): Promise<CheckSummary> {
    if (this.activeCheck) return this.activeCheck;
    this.activeCheck = this.performCheck(checkedAt).finally(() => {
      this.activeCheck = null;
    });
    return this.activeCheck;
  }

  private async performCheck(checkedAt: string): Promise<CheckSummary> {
    const controller = new AbortController();
    const results = await Promise.all(
      this.sources.map(async (source): Promise<SourceCheckResult> => {
        try {
          return await source.check({ checkedAt, signal: controller.signal });
        } catch {
          return {
            sourceId: source.id,
            checkedAt,
            state: 'error',
            posts: [],
            latencyMs: 0,
            errorCode: 'SOURCE_CHECK_FAILED',
          };
        }
      }),
    );

    for (const result of results) {
      this.health.recordState(result.sourceId, result.state, result.checkedAt);
      this.database.recordSourceObservation(result);
    }

    const posts = mergePosts(results.flatMap((result) => result.posts));
    const baseline = !this.database.getSettings().baselineComplete;
    let signalsEmitted = 0;

    for (const post of posts) {
      const previousClassification = this.database.getLatestClassification(post.id);
      this.database.upsertPost(post);
      const classification = await this.classifier.classify({ post });
      this.database.recordClassification(post.id, classification);
      const decision = decideSignalEvent({
        baseline,
        previousLevel: previousClassification?.level ?? null,
        currentLevel: classification.level,
      });
      if (!decision) continue;

      const event: SignalEvent = {
        id: randomUUID(),
        postId: post.id,
        level: decision.level,
        previousLevel: decision.previousLevel,
        isEscalation: decision.isEscalation,
        detectedAt: checkedAt,
      };
      if (!this.database.insertSignalEvent(event)) continue;
      signalsEmitted += 1;
      await this.onSignal(event);
    }

    if (baseline && results.some((result) => result.state === 'online')) {
      this.database.updateSettings({ baselineComplete: true });
    }

    const outageIncident = this.health.consumeOutageIncident();
    if (outageIncident) await this.onOutage?.();

    return { checkedAt, postsSeen: posts.length, signalsEmitted, sourceResults: results, outageIncident };
  }
}

function mergePosts(posts: MonitoredPost[]): MonitoredPost[] {
  const merged = new Map<string, MonitoredPost>();
  for (const post of posts) {
    const existing = merged.get(post.id);
    if (!existing) {
      merged.set(post.id, post);
      continue;
    }
    merged.set(post.id, {
      ...existing,
      text: post.text.length > existing.text.length ? post.text : existing.text,
      quotedText: post.quotedText ?? existing.quotedText,
      sourceIds: [...new Set([...existing.sourceIds, ...post.sourceIds])],
    });
  }
  return [...merged.values()];
}

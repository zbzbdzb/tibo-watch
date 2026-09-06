import { createHash, randomUUID } from 'node:crypto';

import { freshAlertEligible, type AppDatabase } from '../storage/database';
import { canonicalPostId, mergeCanonicalPost } from '../storage/canonicalPost';
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

  async reclassifyStoredPosts(detectedAt = new Date().toISOString()): Promise<{
    postsReclassified: number;
    signalsEmitted: number;
  }> {
    let postsReclassified = 0;
    let signalsEmitted = 0;
    const baseline = !this.database.getSettings().baselineComplete;

    for (const post of this.database.listPosts()) {
      const previousClassification = this.database.getLatestClassification(post.id);
      const inputHash = classificationInputHash(post, this.classifier.id);
      if (previousClassification?.inputHash === inputHash) continue;

      const classification = await this.classifier.classify({ post });
      postsReclassified += 1;
      const decision = decideSignalEvent({
        baseline: baseline || !previousClassification,
        previousLevel: previousClassification?.level ?? null,
        currentLevel: classification.level,
      });
      const event: SignalEvent | null = decision && decision.level !== 'related' && freshAlertEligible(decision.level, post.createdAt, detectedAt) ? {
        id: randomUUID(),
        postId: post.id,
        level: decision.level,
        previousLevel: decision.previousLevel,
        isEscalation: decision.isEscalation,
        detectedAt,
      } : null;
      const inserted = this.database.recordClassificationAndSignal(post.id, classification, inputHash, event);
      if (!event || !inserted) continue;
      signalsEmitted += 1;
      try { await this.onSignal(event); } catch { /* Durable jobs are resumed by the worker. */ }
    }

    return { postsReclassified, signalsEmitted };
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
      this.health.recordState(result.sourceId, result.state, result.checkedAt, result.errorCode);
      this.database.recordSourceObservation(result);
    }

    const posts = mergePosts(results.flatMap((result) => result.posts));
    const baseline = !this.database.getSettings().baselineComplete;
    let signalsEmitted = 0;

    for (const post of posts) {
      this.database.upsertPost(post);
      const canonicalPost = this.database.getPost(post.id);
      if (!canonicalPost) throw new Error(`Canonical post was not persisted: ${post.id}`);
      const previousClassification = this.database.getLatestClassification(post.id);
      const inputHash = classificationInputHash(canonicalPost, this.classifier.id);
      if (previousClassification?.inputHash === inputHash) continue;

      const classification = await this.classifier.classify({ post: canonicalPost });
      const decision = decideSignalEvent({
        baseline,
        previousLevel: previousClassification?.level ?? null,
        currentLevel: classification.level,
      });
      const event: SignalEvent | null = decision && freshAlertEligible(decision.level, canonicalPost.createdAt, checkedAt) ? {
        id: randomUUID(),
        postId: post.id,
        level: decision.level,
        previousLevel: decision.previousLevel,
        isEscalation: decision.isEscalation,
        detectedAt: checkedAt,
      } : null;
      const inserted = this.database.recordClassificationAndSignal(post.id, classification, inputHash, event);
      if (!event || !inserted) continue;
      signalsEmitted += 1;
      try { await this.onSignal(event); } catch { /* Wakeup failure cannot discard committed intent or block other posts. */ }
    }

    if (baseline && results.some((result) => result.state === 'online')) {
      this.database.updateSettings({ baselineComplete: true });
    }

    const outageIncident = this.health.consumeOutageIncident();
    if (outageIncident) await this.onOutage?.();

    return { checkedAt, postsSeen: posts.length, signalsEmitted, sourceResults: results, outageIncident };
  }
}

function classificationInputHash(post: MonitoredPost, classifierId: string): string {
  const canonicalInput = JSON.stringify({
    text: post.text,
    quotedText: post.quotedText,
    kind: post.kind,
    classifierId,
  });
  return createHash('sha256').update(canonicalInput, 'utf8').digest('hex');
}

function mergePosts(posts: MonitoredPost[]): MonitoredPost[] {
  const merged = new Map<string, MonitoredPost>();
  for (const post of posts) {
    const id = canonicalPostId(post);
    const normalized = { ...post, id };
    merged.set(id, mergeCanonicalPost(normalized, merged.get(id) ?? normalized));
  }
  return [...merged.values()];
}

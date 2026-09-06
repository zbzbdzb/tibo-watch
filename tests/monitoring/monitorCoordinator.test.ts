import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';

import { RuleClassifier } from '../../src/main/classifier/ruleClassifier';
import { MonitorCoordinator } from '../../src/main/monitoring/monitorCoordinator';
import { AppDatabase } from '../../src/main/storage/database';
import type { Classifier, MonitoredPost, PostSource, SourceCheckResult } from '../../src/shared/domain';

function post(id: string, text = 'Codex reset soon'): MonitoredPost {
  return {
    id,
    authorHandle: 'thsottiaux',
    text,
    createdAt: '2026-07-31T04:53:19.000Z',
    url: `https://x.com/thsottiaux/status/${id}`,
    kind: 'original',
    quotedText: null,
    sourceIds: ['public-rss'],
  };
}

function source(id: string, posts: MonitoredPost[]): PostSource {
  return {
    id,
    check: vi.fn(async ({ checkedAt }): Promise<SourceCheckResult> => ({
      sourceId: id,
      checkedAt,
      state: 'online',
      posts,
      latencyMs: 10,
      errorCode: null,
    })),
  };
}

const classifier: Classifier = {
  id: 'test-rules',
  classify: vi.fn(async ({ post: value }) => ({
    level: value.text.includes('now') ? 'confirmed' : 'preview',
    score: value.text.includes('now') ? 10 : 7,
    reasons: ['fixture'],
    matchedTerms: ['Codex', 'reset'],
    classifierVersion: 'test-v1',
  })),
};

describe('MonitorCoordinator', () => {
  it('runs sources concurrently, merges duplicate evidence, and establishes a silent baseline', async () => {
    const database = new AppDatabase(':memory:');
    const first = post('300');
    const rss = source('public-rss', [first]);
    const browser = source('x-browser', [{ ...first, sourceIds: ['x-browser'] }]);
    const onSignal = vi.fn();
    const coordinator = new MonitorCoordinator({ database, sources: [rss, browser], classifier, onSignal });

    const result = await coordinator.checkNow('2026-07-31T05:00:00.000Z');

    expect(result.postsSeen).toBe(1);
    expect(database.getPost('300')?.sourceIds).toEqual(['public-rss', 'x-browser']);
    expect(database.getSettings().baselineComplete).toBe(true);
    expect(onSignal).not.toHaveBeenCalled();
    database.close();
  });

  it('does not repeat an alert after restart, but allows preview to confirmed escalation', async () => {
    const database = new AppDatabase(':memory:');
    database.updateSettings({ baselineComplete: true });
    const onSignal = vi.fn();
    const previewSource = source('public-rss', [post('301')]);
    const first = new MonitorCoordinator({ database, sources: [previewSource], classifier, onSignal });
    await first.checkNow('2026-07-31T05:00:00.000Z');
    await first.checkNow('2026-07-31T05:05:00.000Z');
    const confirmedSource = source('public-rss', [post('301', 'Codex reset now with complete details')]);
    const restarted = new MonitorCoordinator({ database, sources: [confirmedSource], classifier, onSignal });
    await restarted.checkNow('2026-07-31T05:10:00.000Z');

    expect(onSignal).toHaveBeenCalledTimes(2);
    expect(onSignal.mock.calls[0][0]).toMatchObject({ level: 'preview', isEscalation: false });
    expect(onSignal.mock.calls[1][0]).toMatchObject({ level: 'confirmed', isEscalation: true });
    database.close();
  });

  it('classifies canonical complete text, skips a truncated repeat, and reclassifies for a new identity', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tibo-watch-canonical-'));
    const path = join(directory, 'database.sqlite');
    const database = new AppDatabase(path);
    database.updateSettings({ baselineComplete: true });
    const completeText =
      'Update on rate limits in Codex. As part of the fixes tomorrow, we will do a full reset of usage for all paid subscriptions.';
    let observedPost = post('canonical', completeText);
    const mutableSource = sourceFrom(() => observedPost);
    const firstClassifier = recordingClassifier('local-rules-v7', () => 'confirmed');
    const first = new MonitorCoordinator({
      database,
      sources: [mutableSource],
      classifier: firstClassifier.value,
      onSignal: vi.fn(),
    });

    await first.checkNow('2026-07-31T05:00:00.000Z');
    observedPost = post('canonical', completeText.slice(0, 48));
    await first.checkNow('2026-07-31T05:05:00.000Z');

    const secondClassifier = recordingClassifier('local-rules-v8', () => 'confirmed');
    observedPost = post('canonical', completeText);
    const second = new MonitorCoordinator({
      database,
      sources: [mutableSource],
      classifier: secondClassifier.value,
      onSignal: vi.fn(),
    });
    await second.checkNow('2026-07-31T05:10:00.000Z');

    expect(firstClassifier.classify).toHaveBeenCalledTimes(1);
    expect(firstClassifier.classify.mock.calls[0][0].post.text).toBe(completeText);
    expect(secondClassifier.classify).toHaveBeenCalledTimes(1);
    expect(secondClassifier.classify.mock.calls[0][0].post.text).toBe(completeText);
    expect(database.getPost('canonical')?.text).toBe(completeText);
    expect(database.getLatestClassification('canonical')).toMatchObject({
      level: 'confirmed',
      inputHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(classificationCount(path, 'canonical')).toBe(2);
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('classifies one canonical expansion and emits exactly one upgrade', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tibo-watch-expansion-'));
    const path = join(directory, 'database.sqlite');
    const database = new AppDatabase(path);
    database.updateSettings({ baselineComplete: true });
    let observedPost = post('expansion');
    const mutableSource = sourceFrom(() => observedPost);
    const currentClassifier = recordingClassifier(
      'local-rules-v7',
      (value) => value.text.includes('now') ? 'confirmed' : 'preview',
    );
    const onSignal = vi.fn();
    const coordinator = new MonitorCoordinator({
      database,
      sources: [mutableSource],
      classifier: currentClassifier.value,
      onSignal,
    });

    await coordinator.checkNow('2026-07-31T05:00:00.000Z');
    const firstHash = database.getLatestClassification('expansion')?.inputHash;
    observedPost = post('expansion', 'Codex reset now with complete details');
    await coordinator.checkNow('2026-07-31T05:05:00.000Z');
    const expandedHash = database.getLatestClassification('expansion')?.inputHash;
    await coordinator.checkNow('2026-07-31T05:10:00.000Z');

    expect(currentClassifier.classify).toHaveBeenCalledTimes(2);
    expect(expandedHash).not.toBe(firstHash);
    expect(classificationCount(path, 'expansion')).toBe(2);
    expect(onSignal.mock.calls.filter(([event]) => event.level === 'confirmed')).toHaveLength(1);
    expect(onSignal).toHaveBeenCalledTimes(2);
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('hashes null and empty quoted text as distinct canonical inputs', async () => {
    const database = new AppDatabase(':memory:');
    database.updateSettings({ baselineComplete: true });
    let observedPost = post('quoted-values');
    const mutableSource = sourceFrom(() => observedPost);
    const currentClassifier = recordingClassifier('local-rules-v7', () => 'irrelevant');
    const coordinator = new MonitorCoordinator({
      database,
      sources: [mutableSource],
      classifier: currentClassifier.value,
      onSignal: vi.fn(),
    });

    await coordinator.checkNow('2026-07-31T05:00:00.000Z');
    const nullHash = database.getLatestClassification('quoted-values')?.inputHash;
    observedPost = { ...observedPost, quotedText: '' };
    await coordinator.checkNow('2026-07-31T05:05:00.000Z');
    observedPost = { ...observedPost, quotedText: null };
    await coordinator.checkNow('2026-07-31T05:10:00.000Z');

    expect(currentClassifier.classify).toHaveBeenCalledTimes(2);
    expect(database.getLatestClassification('quoted-values')?.inputHash).not.toBe(nullHash);
    expect(database.getPost('quoted-values')?.quotedText).toBe('');
    database.close();
  });

  it('reclassifies a v6 null-hash row under the current classifier once', async () => {
    const database = new AppDatabase(':memory:');
    database.updateSettings({ baselineComplete: true });
    const storedPost = post(
      '302',
      'Old news actually from a bunch of days ago, but crossed that 15M. Enjoy a nice reset everyone. Landing in the next hour or so, go /fast.',
    );
    database.upsertPost(storedPost);
    database.recordClassification(storedPost.id, {
      level: 'related',
      score: 3,
      reasons: ['old rules'],
      matchedTerms: ['reset'],
      classifierVersion: 'rules-v6',
    });
    const upgradedClassifier = new RuleClassifier();
    const onSignal = vi.fn();
    const coordinator = new MonitorCoordinator({
      database,
      sources: [],
      classifier: upgradedClassifier,
      onSignal,
    });

    const first = await coordinator.reclassifyStoredPosts('2026-08-01T00:00:00.000Z');
    const second = await coordinator.reclassifyStoredPosts('2026-08-01T00:01:00.000Z');

    expect(database.getLatestClassification(storedPost.id)).toMatchObject({
      level: 'preview',
      classifierVersion: upgradedClassifier.id.replace('local-', ''),
      inputHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      matchedTerms: expect.arrayContaining(['reset', 'everyone', 'next hour']),
    });
    expect(first).toEqual({ postsReclassified: 1, signalsEmitted: 1 });
    expect(second).toEqual({ postsReclassified: 0, signalsEmitted: 0 });
    expect(onSignal).toHaveBeenCalledTimes(1);
    expect(onSignal).toHaveBeenCalledWith(expect.objectContaining({
      postId: storedPost.id,
      level: 'preview',
      previousLevel: 'related',
      isEscalation: true,
    }));
    expect(database.listSignalEvents()).toHaveLength(1);
    database.close();
  });

  it.each([
    {
      name: 'confirmed at exactly 12 hours',
      previousLevel: 'preview' as const,
      currentLevel: 'confirmed' as const,
      postCreatedAt: '2026-08-01T00:00:00.000Z',
      detectedAt: '2026-08-01T12:00:00.000Z',
      baselineComplete: true,
      expectedSignals: 1,
    },
    {
      name: 'confirmed just outside 12 hours',
      previousLevel: 'preview' as const,
      currentLevel: 'confirmed' as const,
      postCreatedAt: '2026-08-01T00:00:00.000Z',
      detectedAt: '2026-08-01T12:00:00.001Z',
      baselineComplete: true,
      expectedSignals: 0,
    },
    {
      name: 'preview at exactly 36 hours',
      previousLevel: 'related' as const,
      currentLevel: 'preview' as const,
      postCreatedAt: '2026-08-01T00:00:00.000Z',
      detectedAt: '2026-08-02T12:00:00.000Z',
      baselineComplete: true,
      expectedSignals: 1,
    },
    {
      name: 'preview just outside 36 hours',
      previousLevel: 'related' as const,
      currentLevel: 'preview' as const,
      postCreatedAt: '2026-08-01T00:00:00.000Z',
      detectedAt: '2026-08-02T12:00:00.001Z',
      baselineComplete: true,
      expectedSignals: 0,
    },
    {
      name: 'irrelevant to preview while fresh',
      previousLevel: 'irrelevant' as const,
      currentLevel: 'preview' as const,
      postCreatedAt: '2026-08-01T00:00:00.000Z',
      detectedAt: '2026-08-01T01:00:00.000Z',
      baselineComplete: true,
      expectedSignals: 1,
    },
    {
      name: 'rejects irrelevant to confirmed with an untrusted future timestamp',
      previousLevel: 'irrelevant' as const,
      currentLevel: 'confirmed' as const,
      postCreatedAt: '2026-08-01T02:00:00.000Z',
      detectedAt: '2026-08-01T01:00:00.000Z',
      baselineComplete: true,
      expectedSignals: 0,
    },
    {
      name: 'confirmed upgrade while baseline is incomplete',
      previousLevel: 'preview' as const,
      currentLevel: 'confirmed' as const,
      postCreatedAt: '2026-08-01T00:00:00.000Z',
      detectedAt: '2026-08-01T01:00:00.000Z',
      baselineComplete: false,
      expectedSignals: 0,
    },
    {
      name: 'related backfill while fresh',
      previousLevel: 'irrelevant' as const,
      currentLevel: 'related' as const,
      postCreatedAt: '2026-08-01T00:00:00.000Z',
      detectedAt: '2026-08-01T01:00:00.000Z',
      baselineComplete: true,
      expectedSignals: 0,
    },
  ])('applies historical alert policy for $name', async (scenario) => {
    const database = new AppDatabase(':memory:');
    database.updateSettings({ baselineComplete: scenario.baselineComplete });
    const storedPost = { ...post(`historical-${scenario.name}`), createdAt: scenario.postCreatedAt };
    database.upsertPost(storedPost);
    database.recordClassification(storedPost.id, {
      level: scenario.previousLevel,
      score: 1,
      reasons: ['old rules'],
      matchedTerms: [],
      classifierVersion: 'rules-v6',
    });
    const currentClassifier = recordingClassifier('local-rules-v7', () => scenario.currentLevel);
    const onSignal = vi.fn();
    const coordinator = new MonitorCoordinator({
      database,
      sources: [],
      classifier: currentClassifier.value,
      onSignal,
    });

    const first = await coordinator.reclassifyStoredPosts(scenario.detectedAt);
    const second = await coordinator.reclassifyStoredPosts(scenario.detectedAt);

    expect(first).toEqual({ postsReclassified: 1, signalsEmitted: scenario.expectedSignals });
    expect(second).toEqual({ postsReclassified: 0, signalsEmitted: 0 });
    expect(onSignal).toHaveBeenCalledTimes(scenario.expectedSignals);
    expect(database.listSignalEvents()).toHaveLength(scenario.expectedSignals);
    expect(database.getLatestClassification(storedPost.id)).toMatchObject({
      level: scenario.currentLevel,
      inputHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    database.close();
  });

  it('coalesces overlapping manual checks into the active run', async () => {
    const database = new AppDatabase(':memory:');
    database.updateSettings({ baselineComplete: true });
    let release!: () => void;
    const deferred = new Promise<void>((resolve) => { release = resolve; });
    const slow: PostSource = {
      id: 'slow',
      check: vi.fn(async ({ checkedAt }) => {
        await deferred;
        return { sourceId: 'slow', checkedAt, state: 'online', posts: [], latencyMs: 1, errorCode: null };
      }),
    };
    const coordinator = new MonitorCoordinator({ database, sources: [slow], classifier, onSignal: vi.fn() });
    const first = coordinator.checkNow('2026-07-31T05:00:00.000Z');
    const second = coordinator.checkNow('2026-07-31T05:00:01.000Z');
    release();
    await Promise.all([first, second]);
    expect(slow.check).toHaveBeenCalledTimes(1);
    database.close();
  });

  it.each(['confirmed', 'preview', 'related'] as const)('keeps old newly polled %s posts silent', async (level) => {
    const database = new AppDatabase(':memory:');
    database.updateSettings({ baselineComplete: true });
    const onSignal = vi.fn();
    const coordinator = new MonitorCoordinator({ database, sources: [source('rss', [post('old-new')])], classifier: recordingClassifier('fresh-test', () => level).value, onSignal });
    await coordinator.checkNow('2026-09-05T10:00:00.000Z');
    expect(database.getLatestClassification('old-new')?.level).toBe(level);
    expect(database.listSignalEvents()).toHaveLength(0);
    expect(database.listDeliveryStatuses()).toHaveLength(0);
    expect(onSignal).not.toHaveBeenCalled();
    database.close();
  });

  it('uses the same order-independent canonical merge for a single check and later observations', async () => {
    const observations = [
      { ...post('guid'), url: 'https://x.com/thsottiaux/status/987', text: 'complete primary text', kind: 'quote' as const, quotedText: 'complete quoted evidence', sourceIds: ['rss'] },
      { ...post('987'), text: 'short', kind: 'reply' as const, quotedText: 'short quote', sourceIds: ['browser'] },
      { ...post('987'), text: 'short', sourceIds: ['fallback'] },
    ];
    const snapshots: MonitoredPost[] = [];
    for (const sequence of [observations, [...observations].reverse()]) {
      const database = new AppDatabase(':memory:');
      const current = recordingClassifier('canonical-test', () => 'irrelevant');
      const coordinator = new MonitorCoordinator({ database, sources: sequence.map((value, index) => source(`source-${index}`, [value])), classifier: current.value, onSignal: vi.fn() });
      await coordinator.checkNow('2026-07-31T05:00:00.000Z');
      for (const value of sequence) database.upsertPost(value);
      expect(current.classify).toHaveBeenCalledTimes(1);
      expect(database.listPosts()).toHaveLength(1);
      snapshots.push(database.getPost('987')!);
      database.close();
    }
    expect(snapshots[0]).toEqual(snapshots[1]);
    expect(snapshots[0]).toMatchObject({ id: '987', kind: 'quote', quotedText: 'complete quoted evidence', sourceIds: ['browser', 'fallback', 'rss'] });
  });
});

function sourceFrom(currentPost: () => MonitoredPost): PostSource {
  return {
    id: 'public-rss',
    check: vi.fn(async ({ checkedAt }): Promise<SourceCheckResult> => ({
      sourceId: 'public-rss',
      checkedAt,
      state: 'online',
      posts: [currentPost()],
      latencyMs: 10,
      errorCode: null,
    })),
  };
}

function recordingClassifier(
  id: string,
  classifyLevel: (post: MonitoredPost) => 'confirmed' | 'preview' | 'related' | 'irrelevant',
): { value: Classifier; classify: ReturnType<typeof vi.fn> } {
  const classify = vi.fn(async ({ post: value }: { post: MonitoredPost }) => {
    const level = classifyLevel(value);
    return {
      level,
      score: level === 'confirmed' ? 10 : level === 'preview' ? 7 : level === 'related' ? 3 : 0,
      reasons: ['fixture'],
      matchedTerms: ['Codex', 'reset'],
      classifierVersion: id.replace('local-', ''),
    };
  });
  return { value: { id, classify }, classify };
}

function classificationCount(path: string, postId: string): number {
  const raw = new DatabaseSync(path);
  const row = raw
    .prepare('SELECT COUNT(*) AS count FROM classifications WHERE post_id = ?')
    .get(postId) as { count: number };
  raw.close();
  return Number(row.count);
}

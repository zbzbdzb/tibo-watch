import { describe, expect, it, vi } from 'vitest';

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
    const confirmedSource = source('public-rss', [post('301', 'Codex reset now')]);
    const restarted = new MonitorCoordinator({ database, sources: [confirmedSource], classifier, onSignal });
    await restarted.checkNow('2026-07-31T05:10:00.000Z');

    expect(onSignal).toHaveBeenCalledTimes(2);
    expect(onSignal.mock.calls[0][0]).toMatchObject({ level: 'preview', isEscalation: false });
    expect(onSignal.mock.calls[1][0]).toMatchObject({ level: 'confirmed', isEscalation: true });
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
});

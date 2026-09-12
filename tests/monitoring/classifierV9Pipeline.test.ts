import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { AppDatabase } from '../../src/main/storage/database';
import { MonitorCoordinator } from '../../src/main/monitoring/monitorCoordinator';
import { RuleClassifier } from '../../src/main/classifier/ruleClassifier';
import type { MonitoredPost, PostSource } from '../../src/shared/domain';
import corpus from '../fixtures/classifier-public-posts-2026-09-12.json';

describe('v8 to v9 canonical reclassification', () => {
  it.each([
    ['fresh', '2026-09-12T10:00:00Z', true, 2],
    ['expired', '2026-09-15T10:00:00Z', true, 0],
    ['baseline', '2026-09-12T10:00:00Z', false, 0],
  ] as const)('replays the two complete saved posts: %s', async (_name, now, baselineComplete, expected) => {
    const database = new AppDatabase(':memory:');
    try {
      database.updateSettings({ baselineComplete });
      for (const item of corpus.cases) {
        const post = item.post as MonitoredPost;
        database.upsertPost(post);
        database.recordClassification(post.id, {level:'related',score:3,reasons:['old rule'],matchedTerms:['reset'],classifierVersion:'rules-v8'},
          createHash('sha256').update(JSON.stringify({text:post.text,quotedText:post.quotedText,kind:post.kind,classifierId:'local-rules-v8'})).digest('hex'));
      }
      const classify = vi.spyOn(new RuleClassifier(), 'classify');
      const classifier = {id:'local-rules-v9',classify};
      const onSignal = vi.fn();
      const coordinator = new MonitorCoordinator({database, sources:[], classifier, onSignal});
      expect(await coordinator.reclassifyStoredPosts(now)).toEqual({postsReclassified:2,signalsEmitted:expected});
      expect(await coordinator.reclassifyStoredPosts(now)).toEqual({postsReclassified:0,signalsEmitted:0});
      expect(classify).toHaveBeenCalledTimes(2);
      expect(onSignal).toHaveBeenCalledTimes(expected);
      for (const item of corpus.cases) expect(database.getLatestClassification(item.post.id)).toMatchObject({level:item.expectedLevel,classifierVersion:'rules-v9'});
      expect(database.listPosts()).toHaveLength(2);
    } finally { database.close(); }
  });

  it('uses a completed body after a short repeat and upgrades only once when the body arrives', async () => {
    const database = new AppDatabase(':memory:');
    try {
      database.updateSettings({baselineComplete:true});
      const complete = corpus.cases[0]!.post as MonitoredPost;
      const short = {...complete,text:'Hi Astra users. A reset and a quick update on quality issues that have been posted around.'};
      let observed = short;
      const source: PostSource = {id:'fixture',check:async ({checkedAt})=>({sourceId:'fixture',checkedAt,state:'online',posts:[observed],latencyMs:0,errorCode:null})};
      const classifier = new RuleClassifier(), classify = vi.spyOn(classifier,'classify');
      const onSignal = vi.fn();
      const coordinator = new MonitorCoordinator({database,sources:[source],classifier,onSignal});
      await coordinator.checkNow('2026-09-12T10:00:00Z');
      expect(database.getLatestClassification(complete.id)?.level).toBe('related');
      observed = complete;
      await coordinator.checkNow('2026-09-12T10:01:00Z');
      const hash = database.getLatestClassification(complete.id)?.inputHash;
      observed = short;
      await coordinator.checkNow('2026-09-12T10:02:00Z');
      observed = complete;
      await coordinator.checkNow('2026-09-12T10:03:00Z');
      expect(database.getPost(complete.id)?.text).toBe(complete.text);
      expect(database.getLatestClassification(complete.id)).toMatchObject({level:'preview',inputHash:hash});
      expect(classify).toHaveBeenCalledTimes(2);
      expect(onSignal.mock.calls.filter(([event])=>event.level==='preview')).toHaveLength(1);
    } finally { database.close(); }
  });
});

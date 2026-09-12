import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { classifyPost } from '../../src/main/classifier/ruleClassifier';
import type { MonitoredPost, SignalLevel } from '../../src/shared/domain';
import corpus from '../fixtures/classifier-public-posts-2026-09-12.json';

const post = (text: string, quotedText: string | null = null): MonitoredPost => ({
  id: 'synthetic-v9', authorHandle: 'thsottiaux', text, quotedText, kind: quotedText ? 'quote' : 'original',
  createdAt: '2026-09-12T08:00:00Z', url: 'https://example.invalid/synthetic-v9', sourceIds: ['synthetic-fixture'],
});

describe('v9 local reset predicates', () => {
  it('preserves the complete captured originals and quotes', () => {
    expect(createHash('sha256').update(JSON.stringify(corpus.cases.map(item => item.post))).digest('hex')).toBe(corpus.provenance.rawPostsSha256);
  });
  it.each(corpus.cases)('recognizes saved public post $post.id as $expectedLevel', async item => {
    const result = await classifyPost({ post: item.post as MonitoredPost });
    expect(result.level).toBe(item.expectedLevel);
    if (result.level === 'preview') expect(result.matchedTerms).toContain('by midnight today');
    if (result.level === 'confirmed') expect(result.matchedTerms).not.toContain('by midnight today');
    for (const term of result.matchedTerms) expect(item.post.text.includes(term) || Boolean(item.post.quotedText?.includes(term))).toBe(true);
  });

  it.each([
    'Reset all propagated. Sweet dreams.', 'Reset propagated.', 'Reset fully propagated to everyone.',
    'The reset has already propagated to all accounts.', 'The reset has now been fully propagated.',
    'The reset is completely propagated.', 'Reset successfully completed.', 'Reset finished.',
    'Reset done.', 'Reset now live.', 'The reset has finally landed.', 'Reset rolled out across all accounts.',
    'Codex usage has reset.', 'Codex usage limits have reset.', 'Codex usage was reset.',
    'We have already reset Codex usage.', 'We have successfully reset Codex usage.',
    'We are also resetting Codex usage.', 'The reset is being propagated to accounts.',
    'Reset being rolled out across all accounts.', 'Reset is underway.', 'Reset is in progress.',
    'Reset all propagated, the fixes will arrive tomorrow.', 'Reset all propagated while the app will launch tomorrow.',
    'No update to the editor, we have reset Codex usage.',
    'Codex usage limits are being reset.', 'Codex usage is currently being reset.',
    'Reset was fully propagated by midnight yesterday.',
  ])('accepts completed/ongoing predicates: %s', async text => {
    expect((await classifyPost({ post: post(text) })).level).toBe('confirmed');
  });

  it.each([
    'And of course, a reset is also landing by midnight today.', 'Reset landing today.',
    'The reset is starting today.', 'A reset arrives before noon tomorrow.', 'Reset by midnight.',
    'Reset before noon.', 'The reset will be fully propagated today.',
    'The reset is scheduled for today.', 'Reset is due at 23:30 UTC.',
    'Reset is also landing tonight.', 'The reset is planned for later today.',
    'The reset will land today while the database is down.',
    'The editor is live. Reset is landing by midnight today.',
    'Reset will be completed tomorrow. The app is live.',
    'Codex usage limits are being reset tomorrow.',
    'Reset fully propagated by midnight tomorrow.',
  ])('accepts local scheduled predicates/deadlines: %s', async text => {
    expect((await classifyPost({ post: post(text) })).level).toBe('preview');
  });

  it.each([
    ['Reset all propagated?', 'related'], ['Has the reset propagated?', 'related'],
    ['Reset not all propagated.', 'related'], ['Reset has not been fully propagated.', 'related'],
    ['The reset is not landing by midnight today.', 'related'],
    ['No reset by midnight today.', 'related'], ['Reset will not be propagated today.', 'related'],
    ['Reset might be landing by midnight today.', 'related'], ['Maybe a reset by midnight.', 'related'],
    ['If we reset Codex usage tomorrow, we will tell you.', 'related'],
    ['Reset is reportedly propagated.', 'related'], ['Reset possibly landing today.', 'related'],
    ['Reset is canceled. Sweet dreams.', 'related'], ['Regular resets land by midnight.', 'related'],
    ['Reset today.', 'related'], ['I was gifted a reset button today.', 'related'],
    ['A reset and an update. The update is landing by midnight today.', 'related'],
    ['Reset while the editor will launch tomorrow.', 'related'],
    ['Reset after the model has landed.', 'related'],
    ['Reset. The app is fully propagated.', 'related'],
    ['A user said the reset has fully propagated.', 'related'],
    ['Someone wrote: “Reset all propagated.”', 'related'],
    ['The password reset is fully propagated.', 'irrelevant'], ['The database reset has landed.', 'irrelevant'],
    ['Reset the server by midnight.', 'irrelevant'], ['Reset live servers tomorrow.', 'irrelevant'],
    ['Reset completed jobs tomorrow.', 'irrelevant'],
    ['Astra quality fixes are fully propagated.', 'irrelevant'],
    ['Astra allocation will increase by midnight.', 'irrelevant'],
    ['Codex context window is landing by midnight today.', 'irrelevant'],
    ['Codex has resets.', 'related'], ['Codex usage limits are not being reset tomorrow.', 'related'],
    ['We have not yet reset Codex usage tomorrow.', 'related'],
    ["We haven't fully reset Codex usage tomorrow.", 'related'],
    ['We have restored the 5h limit for paid Codex users.', 'related'],
  ] satisfies [string, SignalLevel][])('keeps the contrasting case safe: %s', async (text, level) => {
    expect((await classifyPost({ post: post(text) })).level).toBe(level);
  });

  it.each([
    ['Reset all propagated.', 'No reset by midnight today.', 'confirmed'],
    ['No reset today.', 'Reset all propagated.', 'related'],
    ['Interesting.', 'Reset all propagated for all Codex users.', 'related'],
    ['Reset is landing by midnight today.', 'Reset fully propagated for all Codex users.', 'preview'],
  ] satisfies [string, string, SignalLevel][])('keeps primary and quote separate: %s', async (text, quote, level) => {
    const result = await classifyPost({ post: post(text, quote) });
    expect(result.level).toBe(level);
  });

  it('does not let a later preview override a completed winner or pollute evidence', async () => {
    const result = await classifyPost({ post: post('Reset all propagated. Another reset is landing by midnight tomorrow.') });
    expect(result.level).toBe('confirmed');
    expect(result.matchedTerms.join(' ')).not.toMatch(/midnight|tomorrow|landing/);
  });
});

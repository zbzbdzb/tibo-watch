import { describe, expect, it } from 'vitest';
import { classifyPost } from '../../src/main/classifier/ruleClassifier';

describe('rule classifier', () => {
  it('classifies an explicit completed Codex usage reset as confirmed', async () => {
    const result = await classifyPost({
      post: {
        id: '2083053369351090254',
        authorHandle: 'thsottiaux',
        text: "I've reset usage limits for all ChatGPT Work and Codex users.",
        createdAt: '2026-07-31T04:53:19.000Z',
        url: 'https://x.com/thsottiaux/status/2083053369351090254',
        kind: 'original',
        quotedText: null,
        sourceIds: ['fixture'],
      },
    });

    expect(result.level).toBe('confirmed');
    expect(result.reasons).toContain('明确表示额度已经重置');
    expect(result.matchedTerms).toEqual(
      expect.arrayContaining(['reset', 'usage limits', 'Codex']),
    );
  });

  it('classifies a future reset promise as a preview', async () => {
    const result = await classifyPost({
      post: postFixture('Give us 24 hours to reset the Codex rate limits across all plans.'),
    });

    expect(result.level).toBe('preview');
    expect(result.reasons).toContain('表达了未来或疑问式重置意图');
  });

  it('classifies a reset question as a preview', async () => {
    const result = await classifyPost({
      post: postFixture('Should we reset the ChatGPT Work and Codex usage again or give it some space?'),
    });

    expect(result.level).toBe('preview');
  });

  it('does not treat an exact usage-limits question as completed', async () => {
    const result = await classifyPost({
      post: postFixture('Should we reset the usage limits for Codex?'),
    });

    expect(result.level).toBe('preview');
  });

  it('does not escalate an explicitly withdrawn reset tease', async () => {
    const result = await classifyPost({
      post: postFixture("Thinking I am about to announce a Codex reset. But no. I'm just scrolling twitter."),
    });

    expect(result.level).toBe('related');
    expect(result.reasons).toContain('包含否定或撤回语气，未升级为预告');
  });

  it('classifies paid subscription usage context without a reset action as related', async () => {
    const result = await classifyPost({
      post: postFixture('Changes affect usage in paid subscriptions. Something for everyone.'),
    });

    expect(result.level).toBe('related');
  });

  it('uses quoted context to understand a terse reset reply', async () => {
    const result = await classifyPost({
      post: {
        ...postFixture('The resets will continue'),
        kind: 'quote',
        quotedText: 'Please reset Codex usage limits again.',
      },
    });

    expect(result.level).toBe('preview');
  });

  it('classifies a passive completed reset announcement as confirmed', async () => {
    const result = await classifyPost({
      post: postFixture('The usage limits have been reset for all paid users of Codex.'),
    });

    expect(result.level).toBe('confirmed');
  });

  it('ignores a post without quota or reset context', async () => {
    const result = await classifyPost({ post: postFixture('Hmmmmmm') });

    expect(result.level).toBe('irrelevant');
  });
});

function postFixture(text: string) {
  return {
    id: 'fixture-id',
    authorHandle: 'thsottiaux',
    text,
    createdAt: '2026-07-31T04:53:19.000Z',
    url: 'https://x.com/thsottiaux/status/fixture-id',
    kind: 'original' as const,
    quotedText: null,
    sourceIds: ['fixture'],
  };
}

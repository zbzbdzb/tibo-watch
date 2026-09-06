import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { classifyPost, RuleClassifier } from '../../src/main/classifier/ruleClassifier';
import type { ClassificationInput } from '../../src/shared/domain';
import publicCorpus from '../fixtures/classifier-public-posts.json';

describe('rule classifier', () => {
  it('classifies an explicit completed Codex usage reset as confirmed', async () => {
    const result = await classifyPost({
      post: {
        id: 'synthetic-completed-reset',
        authorHandle: 'thsottiaux',
        text: "I've reset usage limits for all ChatGPT Work and Codex users.",
        createdAt: '2026-07-31T04:53:19.000Z',
        url: 'https://example.invalid/synthetic-completed-reset',
        kind: 'original',
        quotedText: null,
        sourceIds: ['synthetic-fixture'],
      },
    });

    expect(result.level).toBe('confirmed');
    expect(result.reasons.join(' ')).toContain('完成');
    expect(result.matchedTerms).toEqual(
      expect.arrayContaining(['reset', 'usage limits', 'Codex']),
    );
  });

  it('classifies a future reset promise as a preview', async () => {
    const result = await classifyPost({
      post: postFixture('Give us 24 hours to reset the Codex rate limits across all plans.'),
    });

    expect(result.level).toBe('preview');
    expect(result.reasons.join(' ')).toContain('未来');
  });

  it('classifies a dated performative reset promise as a preview without repeating Codex', async () => {
    const result = await classifyPost({
      post: postFixture("I'll do another performative reset on Monday"),
    });

    expect(result.level).toBe('preview');
    expect(result.matchedTerms).toEqual(expect.arrayContaining(['reset', 'Monday']));
    expect(result.matchedTerms).not.toContain('performative reset');
  });

  it('recognizes a self-contained reset promise with an explicit future time', async () => {
    const result = await classifyPost({
      post: postFixture('Reset will land around 2pm PST tomorrow.'),
    });

    expect(result.level).toBe('preview');
    expect(result.matchedTerms).toEqual(
      expect.arrayContaining(['Reset', 'will', 'tomorrow']),
    );
    expect(result.reasons.join(' ')).toMatch(/未来/);
  });

  it('recognizes a long rate-limit update that contains a future full reset', async () => {
    const result = await classifyPost({
      post: postFixture(
        'Update on rate limits in Codex. We found several sources of excess usage and have a tiger team shipping fixes tomorrow. We also found a separate efficiency approach that we will work on next week. As part of the fixes tomorrow, we will also do a full reset of the usage for all paid subscriptions.',
      ),
    });

    expect(result.level).toBe('preview');
    expect(result.matchedTerms).toEqual(
      expect.arrayContaining(['reset', 'usage', 'paid subscriptions', 'tomorrow']),
    );
    expect(result.reasons.join(' ')).toMatch(/明确未来时间.*tomorrow/i);
    expect(result.reasons.join(' ')).not.toMatch(/next week/i);
  });

  it('uses audience scope and a future time to recognize an implicit reset preview', async () => {
    const result = await classifyPost({
      post: postFixture(
        'Old news actually from a bunch of days ago, but crossed that 15M. Enjoy a nice reset everyone. Landing in the next hour or so, go /fast.',
      ),
    });

    expect(result.level).toBe('preview');
    expect(result.matchedTerms).toEqual(
      expect.arrayContaining(['reset', 'everyone', 'next hour']),
    );
    expect(result.reasons.join(' ')).toMatch(/明确未来时间.*next hour/i);
  });

  it.each([
    ['A reset for all users is coming within 30 minutes.', ['reset', 'all users', 'within 30 minutes']],
    ["We'll reset Codex usage limits tomorrow.", ['reset', 'Codex', 'usage limits', 'tomorrow']],
    ['Resetting paid users shortly.', ['Resetting', 'paid users', 'shortly']],
    ['One more reset across all plans later today.', ['reset', 'all plans', 'later today']],
    ['The reset should land over the next few hours for everyone.', ['reset', 'everyone', 'next few hours']],
    ["We'll refill usage quotas tomorrow.", ['refill', 'usage', 'quotas', 'tomorrow']],
  ])('recognizes varied future reset wording: %s', async (text, evidence) => {
    const result = await classifyPost({ post: postFixture(text) });

    expect(result.level).toBe('preview');
    expect(result.matchedTerms).toEqual(expect.arrayContaining(evidence));
  });

  it.each([
    ['Just reset everyone. Enjoy.', ['reset', 'everyone']],
    ['Codex usage limits are reset now.', ['Codex', 'usage limits', 'reset']],
    ['The reset is live for all users.', ['reset', 'all users']],
  ])('recognizes varied completed reset wording: %s', async (text, evidence) => {
    const result = await classifyPost({ post: postFixture(text) });

    expect(result.level).toBe('confirmed');
    expect(result.matchedTerms).toEqual(expect.arrayContaining(evidence));
    expect(result.reasons.join(' ')).toContain('完成');
  });

  it('keeps a reset question related instead of treating it as an announcement', async () => {
    const result = await classifyPost({
      post: postFixture('Should we reset the ChatGPT Work and Codex usage again or give it some space?'),
    });

    expect(result.level).toBe('related');
  });

  it('keeps an exact usage-limits question related', async () => {
    const result = await classifyPost({
      post: postFixture('Should we reset the usage limits for Codex?'),
    });

    expect(result.level).toBe('related');
  });

  it('does not escalate an explicitly withdrawn reset tease', async () => {
    const result = await classifyPost({
      post: postFixture("Thinking I am about to announce a Codex reset. But no. I'm just scrolling twitter."),
    });

    expect(result.level).toBe('related');
    expect(result.reasons).toContain('包含否定或撤回语气，未升级为预告');
  });

  it.each([
    ['No reset for everyone tomorrow.', 'related'],
    ["We're not going to reset Codex usage limits.", 'related'],
    ['Password reset for all users lands next hour.', 'irrelevant'],
    ['Reset the demo environment tomorrow.', 'irrelevant'],
    ['Can someone reset my password tomorrow?', 'irrelevant'],
  ] as const)('suppresses negated or non-quota reset wording: %s', async (text, level) => {
    const result = await classifyPost({ post: postFixture(text) });

    expect(result.level).toBe(level);
  });

  it('does not connect an unrelated question phrase to a forbidden reset mention', async () => {
    const result = await classifyPost({
      post: postFixture(
        'Why did you switch to Codex? What do you like about it and what could we improve? Don’t say reset.',
      ),
    });

    expect(result.level).toBe('related');
    expect(result.reasons.join(' ')).toMatch(/否定|撤回/);
  });

  it('keeps an explicit completed reset confirmed when a weekday appears in a greeting', async () => {
    const result = await classifyPost({
      post: postFixture(
        'Usage limits have been reset for all paid ChatGPT Work and Codex users. Happy Monday you all.',
      ),
    });

    expect(result.level).toBe('confirmed');
    expect(result.matchedTerms).not.toContain('Monday');
  });

  it.each([
    'Free users of ChatGPT now have unlimited text chats, powered by GPT-5.6 Luna',
    'I was part of the team that built ChatGPT one year before it came out.',
  ])('does not treat a generic ChatGPT mention as Codex reset context: %s', async (text) => {
    const result = await classifyPost({ post: postFixture(text) });

    expect(result.level).toBe('irrelevant');
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

  it.each([
    ['We are reseting usage for all paid users of Codex and ChatGPT Work...', ['reseting', 'usage', 'paid users', 'Codex', 'ChatGPT Work']],
    ['Never slept better and feeling reseted. Brand new me and brand new usage for all ChatGPT Work and Codex users.', ['reseted', 'brand new usage', 'ChatGPT Work', 'Codex']],
    ['The banked reset has landed, I repeat, the banked reset has landed.', ['reset', 'reset has landed']],
    ['Reset has been propagated to accounts. More improvements tomorrow.', ['Reset', 'has been propagated']],
  ])('recognizes clause-local completed v7 reset forms: %s', async (text, terms) => {
    const result = await classifyPost({ post: postFixture(text) });

    expect(result.level).toBe('confirmed');
    expect(result.matchedTerms).toEqual(expect.arrayContaining(terms));
  });

  it.each([
    ['There is a place and a time for resets. Soon, but not today.', ['resets', 'Soon']],
    ['A maintenance note. We will also do a full reset of the usage for all paid subscriptions tomorrow.', ['reset', 'usage', 'paid subscriptions', 'tomorrow']],
    ['A reset button is coming — find it tomorrow.', ['reset', 'tomorrow']],
  ])('recognizes v7 preview announcements: %s', async (text, terms) => {
    const result = await classifyPost({ post: postFixture(text) });

    expect(result.level).toBe('preview');
    expect(result.matchedTerms).toEqual(expect.arrayContaining(terms));
  });

  it.each([
    'Which Codex reset?',
    'regular resets',
    'Codex has occasional resets. Open-source will have Astra.',
    'I was gifted a reset button today.',
    'Tomorrow we will bring back the 5h limit for Plus accounts across ChatGPT Work and Codex.',
    "Don't say reset",
    'The reset announcement was cancelled; it will not happen tomorrow.',
    'Codex just crossed a milestone. A celebration is coming tomorrow and we cannot wait.',
  ])('keeps local questions, generic resets, and cancelled resets out of announcements: %s', async (text) => {
    const result = await classifyPost({ post: postFixture(text) });

    expect(result.level).toBe('related');
  });

  it.each([
    'Free ChatGPT has unlimited text chats today.',
    'Astra allocation will increase tomorrow.',
    'Codex context-window enablement lands tomorrow.',
    'Reset the password for every user tomorrow.',
    'The database reset completed successfully.',
  ])('does not mistake non-quota updates or excluded reset objects for an announcement: %s', async (text) => {
    const result = await classifyPost({ post: postFixture(text) });

    expect(result.level).toBe('irrelevant');
  });

  it('uses quote context only to supply product scope for a terse primary reset', async () => {
    const result = await classifyPost({
      post: {
        ...postFixture('We will reset it tomorrow.'),
        kind: 'quote',
        quotedText: 'Codex usage limits for paid users.',
      },
    });

    expect(result.level).toBe('preview');
    expect(result.matchedTerms).toEqual(expect.arrayContaining(['reset', 'tomorrow', 'Codex', 'usage limits']));
  });

  it('does not combine a generic reset with unrelated adjacent future documentation', async () => {
    const result = await classifyPost({
      post: postFixture('Regular resets are annoying. Tomorrow we will publish docs.'),
    });

    expect(result.level).toBe('related');
    expect(result.matchedTerms).not.toContain('Tomorrow');
  });

  it('does not use an unrelated adjacent live sentence as reset completion evidence', async () => {
    const result = await classifyPost({
      post: postFixture('Regular resets happen. The stream is live.'),
    });

    expect(result.level).toBe('related');
    expect(result.matchedTerms).not.toContain('live');
  });

  it('does not let an adjacent question suppress a clear reset preview', async () => {
    const result = await classifyPost({
      post: postFixture('We will reset Codex usage limits tomorrow. What do you think?'),
    });

    expect(result.level).toBe('preview');
    expect(result.matchedTerms).toEqual(expect.arrayContaining(['reset', 'Codex', 'usage limits', 'tomorrow']));
  });

  it('does not let an adjacent excluded reset object discard a clear reset preview', async () => {
    const result = await classifyPost({
      post: postFixture('We will reset Codex usage limits tomorrow. The database reset completed.'),
    });

    expect(result.level).toBe('preview');
    expect(result.matchedTerms).not.toContain('database reset');
  });

  it('does not attach unrelated quote product and quota context to a non-terse reset discussion', async () => {
    const result = await classifyPost({
      post: {
        ...postFixture('We discussed regular reset options yesterday.'),
        kind: 'quote',
        quotedText: 'Codex usage limits for paid users.',
      },
    });

    expect(result.level).toBe('related');
    expect(result.matchedTerms).toEqual(expect.arrayContaining(['reset']));
    expect(result.matchedTerms).not.toContain('Codex');
    expect(result.matchedTerms).not.toContain('usage limits');
    expect(result.matchedTerms).not.toContain('paid users');
  });

  it('does not treat a colon-labelled landing sentence as reset continuation evidence', async () => {
    const result = await classifyPost({
      post: postFixture('Regular resets are annoying. Landing tomorrow: documentation.'),
    });

    expect(result.level).toBe('related');
  });

  it('does not treat an adjacent but-no prefix as a reset withdrawal', async () => {
    const result = await classifyPost({
      post: postFixture('We will reset Codex usage limits tomorrow. But no batteries are available.'),
    });

    expect(result.level).toBe('preview');
  });

  it('keeps a standalone adjacent but-no withdrawal related', async () => {
    const result = await classifyPost({
      post: postFixture('We will reset tomorrow. But no.'),
    });

    expect(result.level).toBe('related');
  });

  it('allows an anaphoric live sentence to complete the preceding reset', async () => {
    const result = await classifyPost({
      post: postFixture('The Codex usage reset happened. It is live.'),
    });

    expect(result.level).toBe('confirmed');
    expect(result.matchedTerms).toEqual(expect.arrayContaining(['reset', 'Codex', 'usage', 'live']));
  });

  it('allows an anaphoric landed sentence to complete the preceding reset', async () => {
    const result = await classifyPost({
      post: postFixture('The Codex usage reset happened. It has landed.'),
    });

    expect(result.level).toBe('confirmed');
    expect(result.matchedTerms).toEqual(expect.arrayContaining(['reset', 'Codex', 'usage', 'has landed']));
  });

  it('does not treat an unrelated landed predicate as reset completion evidence', async () => {
    const result = await classifyPost({
      post: postFixture('We discussed regular resets after the plane has landed.'),
    });

    expect(result.level).toBe('related');
    expect(result.matchedTerms).not.toContain('has landed');
  });

  it('does not treat a demonstrative noun phrase as reset completion anaphora', async () => {
    const result = await classifyPost({
      post: postFixture('Regular resets happen. This dashboard is live.'),
    });

    expect(result.level).toBe('related');
  });

  it('allows a demonstrative completion predicate to complete the preceding reset', async () => {
    const result = await classifyPost({
      post: postFixture('The Codex usage reset happened. This is live.'),
    });

    expect(result.level).toBe('confirmed');
    expect(result.matchedTerms).toEqual(expect.arrayContaining(['reset', 'Codex', 'usage', 'live']));
  });

  it('does not let quote negation suppress a completed primary reset', async () => {
    const result = await classifyPost({
      post: {
        ...postFixture('Codex usage limits have been reset for paid users.'),
        kind: 'quote',
        quotedText: 'No reset is planned tomorrow.',
      },
    });

    expect(result.level).toBe('confirmed');
    expect(result.matchedTerms).toEqual(expect.arrayContaining(['Codex', 'usage limits', 'reset']));
    expect(result.matchedTerms).not.toContain('No reset');
  });

  it('keeps terms from a later future sentence out of a completed winner', async () => {
    const result = await classifyPost({
      post: postFixture('Codex usage limits have been reset for paid users. Another reset will land tomorrow.'),
    });

    expect(result.level).toBe('confirmed');
    expect(result.matchedTerms).not.toContain('tomorrow');
  });

  it('reports the v8 classifier identifiers', async () => {
    const result = await classifyPost({ post: postFixture('Codex usage limits have been reset.') });

    expect(result.classifierVersion).toBe('rules-v8');
    expect(new RuleClassifier().id).toBe('local-rules-v8');
  });
});

describe('v8 exact public corpus and synthetic contrasts', () => {
  it('keeps captured raw post fields byte-for-byte immutable', () => {
    const digest = createHash('sha256').update(JSON.stringify(publicCorpus.cases.map((fixture) => fixture.post))).digest('hex');
    expect(digest).toBe(publicCorpus.provenance.rawPostsSha256);
    expect(new Set(publicCorpus.cases.map((fixture) => fixture.post.id)).size).toBe(publicCorpus.cases.length);
  });

  it.each(publicCorpus.cases)('classifies exact saved public post $post.id as $expectedLevel', async (fixture) => {
    const post = fixture.post as ClassificationInput['post'];
    const result = await classifyPost({ post });
    expect(result.level).toBe(fixture.expectedLevel);
    if (fixture.expectedReasonKind === 'implicit') {
      expect(result.reasons.join(' ')).toMatch(/暗示|低确定性/);
      expect(result.score).toBeLessThan(8);
    }
    for (const term of result.matchedTerms) {
      expect(post.text.includes(term) || Boolean(post.quotedText?.includes(term))).toBe(true);
    }
  });

  it.each([
    ['I just reset my sleep schedule.', 'irrelevant'],
    ['We will refill the water bottles tomorrow.', 'irrelevant'],
    ['We will reset our expectations tomorrow.', 'irrelevant'],
    ['A user told me they just reset their Codex usage.', 'related'],
    ['People keep saying "We will reset Codex usage tomorrow", but I made no such promise.', 'related'],
    ['It is false that we have reset Codex usage limits.', 'related'],
    ['The Codex usage reset is not live.', 'related'],
    ['We are not resetting Codex usage limits tomorrow.', 'related'],
    ['We will not refill usage quotas tomorrow.', 'related'],
    ['Codex usage resets every 5 hours.', 'related'],
    ['A Codex reset was announced 3 hours ago.', 'related'],
    ['The Codex reset will be live tomorrow.', 'preview'],
    ['The reset is scheduled to be completed in 2 hours.', 'preview'],
    ['We will reset Codex usage tomorrow, then perform a database reset.', 'preview'],
    ['I’ve reset Codex usage limits.', 'confirmed'],
    ['Codex usage has now been reset for everyone.', 'confirmed'],
    ['We will reset Codex usage tomorrow. It has landed: the Linux desktop app.', 'preview'],
    ['Codex\nOccasional resets\nOpen-source\n(will have Astra)', 'related'],
    ['Codex milestone tomorrow. A new editor launches and we cannot wait.', 'related'],
    ['Codex milestone tomorrow. Hold on to your Codex. No reset is planned.', 'related'],
    ['I previously promised a reset for every 1M Codex users. Little surprise tomorrow. No reset is planned.', 'related'],
    ['I just reset my sleep schedule. Codex usage limits have been reset for everyone.', 'confirmed'],
    ['We will reset the database tomorrow, then reset Codex usage.', 'preview'],
    ['We will reset Codex usage tomorrow, but we will not reset passwords.', 'preview'],
    ['The database reset is live. The Codex usage reset will be live tomorrow.', 'preview'],
    ['The Codex reset will be completed tomorrow.', 'preview'],
    ['The Codex reset was completed yesterday.', 'confirmed'],
    ['We have not reset Codex usage.', 'related'],
    ['We haven’t reset Codex usage.', 'related'],
    ['We won’t reset Codex usage tomorrow.', 'related'],
    ['We are resetting Codex usage now.', 'confirmed'],
    ['We are resetting Codex usage tomorrow.', 'preview'],
    ['My water bottles have been refilled. Codex launches tomorrow.', 'irrelevant'],
    ['The new Codex editor has landed. Regular resets are great.', 'related'],
    ['I might reset Codex usage tomorrow.', 'related'],
    ['We will reset Codex usage tomorrow and perform a database reset.', 'preview'],
    ['We will reset Codex usage tomorrow and reset the database.', 'preview'],
    ['We are not currently resetting Codex usage.', 'related'],
    ['You can reset your Codex usage tomorrow.', 'related'],
    ['A user will reset their Codex usage tomorrow.', 'related'],
    ['Someone wrote: “We will reset Codex usage tomorrow. We have reset Codex usage.”', 'related'],
    ['The reset button is back. I won’t find it tomorrow.', 'related'],
    ['No milestone tomorrow. Hold on to your Codex.', 'related'],
    ['A milestone tomorrow. "Hold on to your Codex", a user said.', 'related'],
    ['We will reset our preferences tomorrow.', 'irrelevant'],
    ['We just reset the scoreboard.', 'irrelevant'],
    ['We have reset Codex usage after database maintenance.', 'confirmed'],
    ['We will reset Codex usage tomorrow while the database is unavailable.', 'preview'],
    ['The database has been reset. Codex usage is unchanged.', 'related'],
    ['We are not currently resetting Codex usage tomorrow.', 'related'],
  ] as const)('binds action, object, polarity and tense: %s', async (text, level) => {
    const result = await classifyPost({ post: postFixture(text) });
    expect(result.level).toBe(level);
  });

  it.each([
    ['Done.', 'Please reset Codex usage limits for everyone.', 'confirmed'],
    ['Done.', 'Please reset my password.', 'irrelevant'],
    ['We will reset it tomorrow.', 'Please reset my password.', 'irrelevant'],
    ['Interesting.', 'We will reset Codex usage tomorrow.', 'related'],
    ['No, not done.', 'Please reset Codex usage limits.', 'related'],
  ] as const)('scopes a terse main text (%s) to quote object (%s)', async (text, quotedText, level) => {
    const result = await classifyPost({ post: { ...postFixture(text), kind: 'quote', quotedText } });
    expect(result.level).toBe(level);
  });

  it('preserves curly apostrophe evidence instead of emitting normalized text', async () => {
    const result = await classifyPost({ post: postFixture('I’ve reset Codex usage limits.') });
    expect(result.matchedTerms).toContain('I’ve reset');
    expect(result.matchedTerms).not.toContain("I've reset");
  });
});

function postFixture(text: string) {
  return {
    id: 'synthetic-fixture-id',
    authorHandle: 'thsottiaux',
    text,
    createdAt: '2026-07-31T04:53:19.000Z',
    url: 'https://example.invalid/synthetic-fixture-id',
    kind: 'original' as const,
    quotedText: null,
    sourceIds: ['synthetic-fixture'],
  };
}

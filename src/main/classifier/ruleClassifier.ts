import type {
  Classifier,
  ClassificationInput,
  ClassificationResult,
} from '../../shared/domain';

export async function classifyPost(_input: ClassificationInput): Promise<ClassificationResult> {
  const text = `${_input.post.text} ${_input.post.quotedText ?? ''}`.trim();
  const normalized = text.toLowerCase();
  const matchedTerms: string[] = [];

  if (/\breset(?:s|ting)?\b/.test(normalized)) matchedTerms.push('reset');
  if (/\busage limits?\b/.test(normalized)) matchedTerms.push('usage limits');
  if (/\brate limits?\b/.test(normalized)) matchedTerms.push('rate limits');
  if (/\bcodex\b/.test(normalized)) matchedTerms.push('Codex');
  if (/\bchatgpt work\b/.test(normalized)) matchedTerms.push('ChatGPT Work');
  if (/\bpaid subscriptions?\b/.test(normalized)) matchedTerms.push('paid subscriptions');
  if (/\busage\b/.test(normalized) && !matchedTerms.includes('usage limits')) {
    matchedTerms.push('usage');
  }

  const namesRelevantProduct = matchedTerms.some((term) =>
    [
      'usage limits',
      'rate limits',
      'Codex',
      'ChatGPT Work',
      'paid subscriptions',
      'usage',
    ].includes(term),
  );
  const mentionsReset = matchedTerms.includes('reset');
  const statesCompletedReset =
    /\b(?:i(?:'ve| have)|we(?:'ve| have)|have|has)\s+(?:now\s+)?reset\b/.test(
      normalized,
    ) ||
    /\b(?:usage|rate) limits? (?:have|has) been reset\b/.test(normalized);
  const withdrawsSignal =
    /\bbut no\b/.test(normalized) ||
    /\bno (?:codex )?reset\b/.test(normalized) ||
    /\bnot (?:going to )?(?:announce |do )?(?:a )?reset\b/.test(normalized);
  const statesFutureIntent =
    /\bshould we reset\b/.test(normalized) ||
    /\bgive us .{0,30}\bto reset\b/.test(normalized) ||
    /\babout to (?:announce )?(?:a )?reset\b/.test(normalized) ||
    /\breset(?:s)? will continue\b/.test(normalized) ||
    /\b(?:will|going to) reset\b/.test(normalized) ||
    /\breset.{0,24}\b(?:soon|tomorrow|later|next)\b/.test(normalized);

  if (namesRelevantProduct && statesCompletedReset && !withdrawsSignal) {
    return {
      level: 'confirmed',
      score: 10,
      reasons: ['明确表示额度已经重置'],
      matchedTerms,
      classifierVersion: 'rules-v1',
    };
  }

  if (mentionsReset && withdrawsSignal) {
    return {
      level: 'related',
      score: 3,
      reasons: ['包含否定或撤回语气，未升级为预告'],
      matchedTerms,
      classifierVersion: 'rules-v1',
    };
  }

  if (mentionsReset && namesRelevantProduct && statesFutureIntent) {
    return {
      level: 'preview',
      score: 7,
      reasons: ['表达了未来或疑问式重置意图'],
      matchedTerms,
      classifierVersion: 'rules-v1',
    };
  }

  if (namesRelevantProduct || mentionsReset) {
    return {
      level: 'related',
      score: 3,
      reasons: ['涉及 Codex、额度或重置上下文，但没有明确时态信号'],
      matchedTerms,
      classifierVersion: 'rules-v1',
    };
  }

  return {
    level: 'irrelevant',
    score: 0,
    reasons: ['未发现重置相关信号'],
    matchedTerms,
    classifierVersion: 'rules-v1',
  };
}

export class RuleClassifier implements Classifier {
  readonly id = 'local-rules-v1';

  classify(input: ClassificationInput): Promise<ClassificationResult> {
    return classifyPost(input);
  }
}

import type { Classifier, ClassificationInput, ClassificationResult } from '../../shared/domain';

const CLASSIFIER_VERSION = 'rules-v8';
type Source = 'primary' | 'quote';
type Level = 'confirmed' | 'preview' | 'related';

interface Clause {
  source: Source;
  index: number;
  sentence: number;
  start: number;
  raw: string;
  text: string;
  quotedRanges: Array<{ start: number; end: number }>;
}

/** Offsets address the original, unnormalized source, including Unicode punctuation. */
interface Evidence {
  source: Source;
  start: number;
  end: number;
  raw: string;
}

interface ActionCandidate {
  clause: Clause;
  action: Evidence;
  subject: 'author' | 'passive' | 'unspecified' | 'reported';
  object: 'quota' | 'generic-reset' | 'other' | 'unresolved';
  polarity: 'asserted' | 'negated';
  modality: 'statement' | 'question' | 'speculative';
  tense: 'completed' | 'in-progress' | 'future' | 'habitual' | 'reported-past' | 'unknown';
  evidence: Evidence[];
  future: Evidence[];
  completion: Evidence[];
}

interface Candidate {
  level: Level;
  reason: string;
  evidence: Evidence[];
  implicit?: boolean;
}

const ACTION = /\b(?:reset(?:s|ting|ing|ed|ted)?|refill(?:s|ed|ing)?|replenish(?:es|ed|ing)?|restor(?:e|es|ed|ing)|top(?:ped|ping)?\s+up)\b/gi;
const PRODUCT = /\b(?:codex|chatgpt work)\b/gi;
const QUOTA = /\b(?:brand new usage|usage limits?|rate limits?|usage|quotas?|allowances?|credits?|\d+h limit)\b/gi;
const AUDIENCE = /\b(?:everyone|all users?|paid users?|paid subscriptions?|subscribers?|all plans?)\b/gi;
const OTHER_OBJECT = /\b(?:passwords?|sleep schedule|water bottles?|expectations?|factory|server|database|router|device|demo|test|staging|environment|cache|repository|git branch|computer|phone|clock|timer)\b/gi;
const FUTURE_TIME = /\b(?:within\s+(?:about\s+)?\d+\s+(?:minutes?|hours?|days?)|in\s+(?:about\s+|~\s*)?\d+\s+(?:minutes?|hours?|days?)|next\s+(?:(?:few|couple(?:\s+of)?|\d+)\s+)?(?:minutes?|hours?|days?|weeks?)|later(?:\s+(?:today|tonight|this week))?|soon|shortly|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|by end of day|(?:by|at|around)\s+\d+(?::\d+)?\s*(?:am|pm)\s*(?:p[sd]?t)?|during the day)\b/gi;
const FUTURE_MODAL = /\b(?:will|shall|going to|about to|set to|scheduled to|should\s+(?:land|arrive|roll out)|give us)\b|\b(?:i|we)'ll\b/gi;
const RESET_FORM = 'reset(?:s|ting|ing|ed|ted)?|refilled|replenished|restored|topped up';
const NEGATION_REASON = '包含否定或撤回语气，未升级为预告';

export async function classifyPost(input: ClassificationInput): Promise<ClassificationResult> {
  const primary = splitClauses(input.post.text, 'primary');
  const quote = splitClauses(input.post.quotedText ?? '', 'quote');
  const actions = buildActions(primary, quote, input.post.authorHandle);
  const explicit = actions.map((action) => classifyAction(action, primary)).filter(isCandidate);
  const doneReply = classifyDoneReply(primary, quote);
  const implicit = classifyImplicitPreview(primary, actions);
  const candidates = [...explicit, ...(doneReply ? [doneReply] : []), ...implicit];
  const winner = candidates.find((item) => item.level === 'confirmed')
    ?? candidates.find((item) => item.level === 'preview')
    ?? candidates.find((item) => item.level === 'related');
  if (winner) {
    return result(winner.level, winner.level === 'confirmed' ? 10 : winner.level === 'preview' ? (winner.implicit ? 6 : 8) : 3,
      [winner.reason], terms(winner.evidence));
  }

  const quota = primary.flatMap((clause) => matches(clause, QUOTA));
  const audience = primary.filter((clause) => !actions.some((action) => action.clause.index === clause.index && action.object === 'other'))
    .flatMap((clause) => matches(clause, AUDIENCE));
  const quoteContext = quote.flatMap((clause) => matches(clause, QUOTA));
  const contextualTease = primary.some((clause) => /\b(?:milestone|celebration)\b/i.test(clause.text))
    && primary.some((clause) => /\b(?:codex|button)\b/i.test(clause.text));
  if (quota.length || audience.length || quoteContext.length || contextualTease) {
    return result('related', 3, ['涉及产品额度上下文，但没有明确重置公告'], terms([...quota, ...audience, ...quoteContext]));
  }
  return result('irrelevant', 0, [actions.some((action) => action.object === 'other') ? '检测到非额度重置对象' : '未发现重置相关信号'], []);
}

function buildActions(primary: Clause[], quote: Clause[], author: string): ActionCandidate[] {
  const actions: ActionCandidate[] = [];
  for (const clause of primary) {
    const hits = matches(clause, ACTION);
    for (const [index, action] of hits.entries()) {
      // Separate predicates within one clause cannot lend objects/completion to each other.
      const previous = hits[index - 1];
      const next = hits[index + 1];
      const left = previous ? previous.end - clause.start : 0;
      const right = next ? next.start - clause.start : clause.text.length;
      const scope = sliceClause(clause, left, right);
      const offset = action.start - scope.start;
      const before = scope.text.slice(0, offset);
      const after = scope.text.slice(offset + action.raw.length);
      const localContext = [...matches(scope, PRODUCT), ...matches(scope, QUOTA), ...matches(scope, AUDIENCE)];
      const quota = matches(scope, QUOTA);
      const objectEnd = after.search(/\b(?:and|but|while|after|before|then|because|although|during|whereas|with)\b/i);
      const directObjectEnd = objectEnd < 0 ? scope.start + scope.text.length : action.end + objectEnd;
      const other = matches(scope, OTHER_OBJECT).filter((item) => item.start >= action.end
        ? item.start < directObjectEnd
        : /^(?:\s+(?:has|have|had|been|now|just|is|are|was|were|will|be|being|also))*\s*$/i.test(scope.text.slice(item.end - scope.start, offset)));
      const isReset = /^reset/i.test(action.raw);
      const reference = /^(?:\s+(?:it|this|that)\b)/i.test(after);
      const quoteScope = reference || /^\s*the resets?\b/i.test(scope.text) ? resolveQuote(quote) : undefined;
      let object: ActionCandidate['object'] = other.length ? 'other'
        : quota.length || matches(scope, PRODUCT).length || matches(scope, AUDIENCE).length ? 'quota'
        : isReset && author.toLowerCase().replace(/^@/, '') === 'thsottiaux' ? 'generic-reset' : 'unresolved';
      // A concrete direct object is not a generic Tibo teaser merely because
      // the particular noun is absent from the exclusion vocabulary.
      if (/^\s+(?:my|your|their|our|the|a|an)\s+(?!(?:usage|quota|rate|credit|allowance|limit|codex|chatgpt)\b)[\p{L}\p{N}]+/iu.test(after)) object = 'other';
      if (reference && quote.length > 0) object = quoteScope?.object ?? 'unresolved';
      if (!isReset && !quota.length && !matches(scope, AUDIENCE).length) object = 'other';

      const reported = isReported(scope, action);
      const subject: ActionCandidate['subject'] = reported ? 'reported'
        : /\b(?:i|we)(?:'ve|'re|'ll|\b)/i.test(before) ? 'author'
        : /\b(?:is|are|was|were|has|have)\b/i.test(before + after) ? 'passive' : 'unspecified';
      const polarity = isNegated(scope, action) ? 'negated' : 'asserted';
      const modality = /\?|\b(?:which|what if)\b|\b(?:should|could|can|shall)\s+(?:i|we)\b/i.test(scope.text) ? 'question'
        : /\b(?:might|maybe|perhaps|consider(?:ing)?|thinking about|hope to|could)\b/i.test(before) ? 'speculative' : 'statement';
      const future = [...matches(scope, FUTURE_TIME), ...matches(scope, FUTURE_MODAL)];
      const prefix = primary[clause.index - 1];
      if (prefix?.sentence === clause.sentence && /^(?:as part of|by|at|tomorrow|later)\b/i.test(prefix.text)
        && !matches(prefix, ACTION).length) future.unshift(...matches(prefix, FUTURE_TIME));
      // A shared auxiliary governs coordinated actions, but never crosses a sentence/newline.
      const priorAction = actions.at(-1);
      if (future.length === 0 && /^(?:then\s+|and\s+)?(?:perform\s+(?:a\s+)?)?reset/i.test(scope.text)
        && priorAction?.clause.sentence === clause.sentence && priorAction.tense === 'future') future.push(...priorAction.future);
      const completion = completionEvidence(scope, action);
      const habitual = /\b(?:regular|occasional|usually|routinely)\b/i.test(scope.text)
        || /^\s+every\s+(?:\d+\s+)?(?:minutes?|hours?|days?|weeks?)\b/i.test(after);
      const historicalReport = /\b(?:previously promised|discussed|announced|announcement|was gifted|been \d+ years|years since)\b/i.test(scope.text);
      const grammarFuture = matches(scope, FUTURE_MODAL).length > 0 || /\b(?:is|are) coming\b/i.test(after);
      const progressing = /\b(?:i am|we are|we're|i'm|are|is)\s+(?:now\s+)?(?:resetting|reseting|refilling|replenishing|restoring)\b/i.test(scope.text);
      let tense: ActionCandidate['tense'] = habitual ? 'habitual' : historicalReport ? 'reported-past'
        : grammarFuture ? 'future'
        : completion.length && !progressing ? 'completed'
        : future.length ? 'future'
        : progressing ? 'in-progress' : 'unknown';
      if (tense === 'future' && /\b(?:ago|yesterday)\b/i.test(scope.text) && !matches(scope, FUTURE_MODAL).length) tense = 'reported-past';
      actions.push({ clause: scope, action, subject, object, polarity, modality, tense,
        evidence: [action, ...localContext, ...(quoteScope?.object === 'quota' ? quoteScope.evidence : [])], future, completion });
    }
  }
  return actions;
}

function classifyAction(action: ActionCandidate, clauses: Clause[]): Candidate | undefined {
  if (action.object === 'other' || action.object === 'unresolved') return undefined;
  const next = clauses[action.clause.index + 1];
  const withdrawn = next && /^\s*but no[.!?]*\s*$/i.test(next.text);
  if (action.polarity === 'negated' || withdrawn) return related(action, NEGATION_REASON);
  if (action.subject === 'reported') return related(action, '引用或转述他人的重置，非作者额度公告');
  if (action.modality !== 'statement') return related(action, '疑问或不确定意向，未构成明确重置公告');
  if (action.tense === 'habitual' || action.tense === 'reported-past') return related(action, '常规重置或历史讨论，不是当前重置公告');
  // A button being given/found is not itself a completed quota reset.
  if (/\breset button\b/i.test(action.clause.text)) return related(action, '涉及重置按钮，但未明确执行额度重置');

  const continuation = next && safeContinuation(next) ? next : undefined;
  const completeContinuation = continuation ? anaphoricCompletion(continuation) : [];
  if (action.tense === 'completed' || action.tense === 'in-progress') {
    return { level: 'confirmed', reason: '检测到额度重置动作及完成或执行中时态',
      evidence: [...action.evidence, ...action.completion, ...completeContinuation] };
  }
  if (completeContinuation.length && action.tense !== 'future') {
    return { level: 'confirmed', reason: '检测到额度重置动作及指代完成时态', evidence: [...action.evidence, ...completeContinuation] };
  }
  // The playful personal predicate alone is insufficient; the adjacent quota outcome is required.
  if (/\bfeeling reset(?:ed|ted)\b/i.test(action.clause.text) && next && /\bbrand new usage\b/i.test(next.text)
    && matches(next, PRODUCT).length && !isNegated(next)) {
    return { level: 'confirmed', reason: '检测到重置表述及紧邻的全新额度完成结果',
      evidence: [...action.evidence, ...matches(next, QUOTA), ...matches(next, PRODUCT), ...matches(next, AUDIENCE)] };
  }
  let future = action.future;
  if (future.length === 0 && continuation && /^(?:(?:it|this|that|first one)\s+)?(?:lands?|landing|arriving|rolling out|is coming|will land)\b/i.test(continuation.text)) {
    future = [...matches(continuation, FUTURE_TIME), ...matches(continuation, FUTURE_MODAL)];
  }
  if (future.length === 0 && next && /^soon,?\s+but not today[.!?]*$/i.test(next.text)) future = matches(next, FUTURE_TIME);
  if (future.length > 0) {
    const time = future.find((item) => !/^(?:will|we'll|i'll|going to|about to|give us)$/i.test(normalize(item.raw))) ?? future[0];
    return { level: 'preview', reason: '明确额度重置预告：检测到重置动作、明确未来时间（' + (time?.raw ?? '未来承诺') + '）',
      evidence: [...action.evidence, ...future] };
  }
  return related(action, '涉及产品额度或重置上下文，但没有明确时态信号');
}

function completionEvidence(clause: Clause, action: Evidence): Evidence[] {
  const expressions = [
    new RegExp("\\b(?:i|we)(?:'ve|\\s+have)\\s+(?:now\\s+|just\\s+)?(?:" + RESET_FORM + ")\\b", 'gi'),
    new RegExp("\\b(?:has|have)\\s+(?:now\\s+)?been\\s+(?:now\\s+)?(?:" + RESET_FORM + ")\\b", 'gi'),
    new RegExp("\\b(?:was|were)\\s+(?:" + RESET_FORM + ")\\b", 'gi'),
    new RegExp("\\bjust\\s+(?:" + RESET_FORM + ")\\b", 'gi'),
    /\b(?:i am|we are|we're|i'm|are|is)\s+(?:now\s+)?(?:resetting|reseting|refilling|replenishing|restoring)\b/gi,
    /\b(?:are|is)\s+(?:now\s+)?reset\s+now\b/gi,
    /\breset\s+has\s+(?:landed|been\s+propagated)\b/gi,
  ];
  const evidence = expressions.flatMap((pattern) => matches(clause, pattern)).filter((item) => item.start <= action.start && item.end >= action.end);
  const after = sliceClause(clause, action.end - clause.start, clause.text.length);
  // Only predicates governed by the reset noun, not another noun's "live" or "landed".
  if (/^\s+(?:(?:for|of)\s+(?:all\s+)?(?:users|everyone|codex usage limits)\s+)?(?:has\s+(?:now\s+)?(?:landed|been\s+(?:propagated|completed|finished))|(?:is|was)\s+(?:now\s+)?(?:live|done|completed|finished)|happened)\b/i.test(after.text)) {
    evidence.push(...matches(after, /\b(?:has\s+(?:now\s+)?(?:landed|been\s+(?:propagated|completed|finished))|live|done|completed|finished|happened)\b/gi));
  }
  return evidence;
}

function isNegated(clause: Clause, action?: Evidence): boolean {
  const text = clause.text;
  if (!action && /\b(?:no|won't|don't|doesn't|didn't|haven't|hasn't|isn't|aren't|wasn't|weren't|will not|cannot|can't)\b/i.test(text.replace(/\b(?:not today|cannot wait|can't wait)\b/gi, ''))) return true;
  if (/\b(?:it is false that|untrue that|no such promise|made no .*promise|announcement was cancelled)\b/i.test(text)) return true;
  const before = action ? text.slice(0, action.start - clause.start) : text;
  const after = action ? text.slice(action.end - clause.start) : text;
  return /\b(?:no|not|never)\s+(?:(?:a|the|another|full|banked|codex|usage|limits|quota|going to|do|perform|announce|announcing|promise|say|currently|actually|ever|now)\s+)*$/i.test(before)
    || /\b(?:won't|don't|doesn't|didn't|haven't|hasn't|isn't|aren't|wasn't|weren't|will not|have not|has not)\s+(?:(?:be|been|going to|do|perform|announce|a|the|now|ever)\s+)*$/i.test(before)
    || /^(?:\s+(?:for|of)\s+[\w ]+?)?\s+(?:is|was|has|will|would|should)\s+(?:not|never)\b/i.test(after)
    || /^\s+(?:isn't|wasn't|won't|hasn't)\b/i.test(after)
    || /\b(?:don't|do not)\s+(?:say|announce|promise)\s+(?:a\s+)?reset\b/i.test(text)
    || /\b(?:no reset|reset (?:is |was )?(?:cancelled|canceled))\b/i.test(text);
}

function isReported(clause: Clause, action?: Evidence): boolean {
  const before = action ? clause.text.slice(0, action.start - clause.start) : clause.text;
  const position = action?.start ?? clause.start;
  if (clause.quotedRanges.some((range) => position >= range.start && position < range.end)) return true;
  if (/^\s*(?:you|users|a user|they|he|she)\s+(?:can|could|will|have|has|just)\b/i.test(before)) return true;
  if (/\b(?:a user|someone|people|they|he|she)\b.*\b(?:told|said|saying|says|just|have|has|will)\b/i.test(before)
    || /\b(?:according to|reportedly|allegedly|people keep saying)\b/i.test(before)) return true;
  if (action) {
    const quotes = [...clause.text.matchAll(/"[^"\n]*"/g)];
    const offset = action.start - clause.start;
    if (quotes.some((quote) => offset > (quote.index ?? 0) && offset < (quote.index ?? 0) + quote[0].length)) return true;
  }
  return false;
}

function classifyImplicitPreview(clauses: Clause[], actions: ActionCandidate[]): Candidate[] {
  const candidates: Candidate[] = [];
  // Hints use the same object/attribution/polarity guards. Explicit denial in the post
  // cancels an ambiguous hint, but never a distinct, already-classified positive action.
  if (actions.some((action) => action.object !== 'other' && (action.polarity === 'negated' || action.subject === 'reported'))
    || clauses.some((clause) => /\b(?:no reset|no such promise|not planned|cancelled|canceled)\b/i.test(clause.text))) return candidates;
  for (const action of actions) {
    if (action.object === 'other' || action.object === 'unresolved' || action.polarity !== 'asserted' || action.subject === 'reported') continue;
    const nearby = clauses.filter((clause) => clause.index >= action.clause.index && clause.index <= action.clause.index + 3);
    const surprise = nearby.find((clause) => /\b(?:little )?surprise\b/i.test(clause.text) && matches(clause, FUTURE_TIME).length && !isReported(clause) && !isNegated(clause) && !/\?/.test(clause.text));
    const promise = /\b(?:previously promised|promised)\b.*\breset\b.*\bfor every\b/i.test(action.clause.text)
      && matches(action.clause, PRODUCT).length > 0;
    const findButton = nearby.find((clause) => /\bfind it\b/i.test(clause.text) && matches(clause, FUTURE_TIME).length && !isReported(clause) && !isNegated(clause) && !/\?/.test(clause.text));
    if (promise && surprise) candidates.push(hint([...action.evidence, ...matches(surprise, /\b(?:little )?surprise\b/gi), ...matches(surprise, FUTURE_TIME)], '既往按用户里程碑重置承诺及未来惊喜'));
    if (/\breset button\b/i.test(action.clause.text) && findButton) candidates.push(hint([...action.evidence, ...matches(findButton, /\bfind it\b/gi), ...matches(findButton, FUTURE_TIME)], '重置按钮与未来寻找/使用的暗示'));
  }
  for (const clause of clauses) {
    if (!/\bmilestone\b/i.test(clause.text) || !matches(clause, FUTURE_TIME).length || isReported(clause) || /\?/.test(clause.text)) continue;
    const next = clauses[clause.index + 1];
    if (next && /^hold on to your codex\b/i.test(next.text) && !isNegated(clause) && !isReported(next)) {
      candidates.push(hint([...matches(clause, /\b(?:milestone|celebrate)\b/gi), ...matches(clause, FUTURE_TIME), ...matches(next, /\bhold on to your codex\b/gi), ...matches(next, PRODUCT)], '未来里程碑庆祝与保留 Codex 额度的语境暗示'));
    }
  }
  return candidates;
}

function hint(evidence: Evidence[], detail: string): Candidate {
  return { level: 'preview', implicit: true, reason: '暗示型重置预告（低确定性）：' + detail + '；并非明确重置承诺', evidence };
}

function resolveQuote(quote: Clause[]): { object: 'quota' | 'other'; evidence: Evidence[] } | undefined {
  if (quote.some((clause) => matches(clause, OTHER_OBJECT).length)) return { object: 'other', evidence: [] };
  const quota = quote.flatMap((clause) => matches(clause, QUOTA));
  if (!quota.length) return undefined;
  return { object: 'quota', evidence: [...quota, ...quote.flatMap((clause) => matches(clause, PRODUCT)), ...quote.flatMap((clause) => matches(clause, AUDIENCE))] };
}

function classifyDoneReply(primary: Clause[], quote: Clause[]): Candidate | undefined {
  if (primary.length !== 1 || !/^(?:done|done,? enjoy|it is done|it is live)[.!]*$/i.test(primary[0]?.text ?? '')) return undefined;
  const context = resolveQuote(quote);
  const request = quote.find((clause) => /^(?:please|can you|could you|would you)\b.*\breset\b/i.test(clause.text) && matches(clause, QUOTA).length);
  if (!request || context?.object !== 'quota' || isNegated(request)) return undefined;
  return { level: 'confirmed', reason: '明确额度重置请求的直接完成回复', evidence: [...context.evidence, ...matches(request, ACTION), ...primary.flatMap((clause) => matches(clause, /\b(?:done|live)\b/gi))] };
}

function safeContinuation(clause: Clause): boolean {
  return !/:|\?|\b(?:app|editor|documentation|docs|stream|dashboard|database|password|plane|release)\b/i.test(clause.text)
    && !isNegated(clause) && !isReported(clause);
}

function anaphoricCompletion(clause: Clause): Evidence[] {
  if (!/^(?:it|this|that)\s+(?:(?:is|was)\s+(?:now\s+)?(?:live|done|completed|finished)|has\s+(?:landed|been\s+(?:completed|finished)))\b/i.test(clause.text)) return [];
  return matches(clause, /\b(?:live|done|completed|finished|has landed|has been completed|has been finished)\b/gi);
}

/** Deliberately length-preserving so all evidence remains an exact raw substring. */
function normalize(text: string): string {
  return text.replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/[\u00a0\u202f]/g, ' ')
    .replace(/[。．]/g, '.').replace(/[！]/g, '!').replace(/[？]/g, '?').replace(/[；]/g, ';').replace(/[，]/g, ',').replace(/[：]/g, ':');
}

function splitClauses(raw: string, source: Source): Clause[] {
  const normalized = normalize(raw);
  const quotedRanges = [...normalized.matchAll(/"[^"]*"/g)].map((match) => ({ start: match.index, end: match.index + match[0].length }));
  const clauses: Clause[] = [];
  // Newlines are semantic boundaries: a list's later product roadmap must not
  // supply a future auxiliary to an earlier "Occasional resets" bullet.
  const separators = /[.!?;]+|\r?\n+|,\s*(?!but not today\b)(?=(?:then|but|(?:and\s+)?(?:we|i|they|it)(?:\b|')))|\s+(?:and|but)\s+(?=(?:we|i|they|reset|refill|perform)(?:\b|'))/gi;
  let start = 0;
  let sentence = 0;
  const append = (end: number) => {
    const part = raw.slice(start, end);
    const leading = part.length - part.trimStart().length;
    const value = part.trim();
    if (value) clauses.push({ source, index: clauses.length, sentence, start: start + leading, raw: value, text: normalize(value), quotedRanges });
  };
  for (const separator of normalized.matchAll(separators)) {
    const at = separator.index;
    const isSentence = /^[.!?;\r\n]/.test(separator[0]);
    append(isSentence && !/^[\r\n]/.test(separator[0]) ? at + separator[0].length : at);
    start = at + separator[0].length;
    if (isSentence) sentence += 1;
  }
  append(raw.length);
  return clauses;
}

function sliceClause(clause: Clause, start: number, end: number): Clause {
  return { ...clause, start: clause.start + start, raw: clause.raw.slice(start, end), text: clause.text.slice(start, end) };
}

function matches(clause: Clause, pattern: RegExp): Evidence[] {
  return [...clause.text.matchAll(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g'))]
    .map((match) => ({ source: clause.source, start: clause.start + match.index, end: clause.start + match.index + match[0].length,
      raw: clause.raw.slice(match.index, match.index + match[0].length) }));
}

function related(action: ActionCandidate, reason: string): Candidate { return { level: 'related', reason, evidence: action.evidence }; }
function isCandidate(candidate: Candidate | undefined): candidate is Candidate { return candidate !== undefined; }
function terms(evidence: Evidence[]): string[] {
  const seen = new Set<string>();
  return evidence.map((item) => item.raw).filter((raw) => {
    const key = normalize(raw).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function result(level: ClassificationResult['level'], score: number, reasons: string[], matchedTerms: string[]): ClassificationResult {
  return { level, score, reasons, matchedTerms, classifierVersion: CLASSIFIER_VERSION };
}

export class RuleClassifier implements Classifier {
  readonly id = 'local-rules-v8';
  classify(input: ClassificationInput): Promise<ClassificationResult> { return classifyPost(input); }
}

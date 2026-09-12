/** Local reset predicates, independent of product context and notification policy.
 * Ranges always address the caller's length-preserving, normalized clause.
 * A state must be governed by the reset, not a later subject's release/update.
 */
export interface PredicateSpan { start: number; end: number }
const RESET = 'reset(?:ed|ted)?|refilled|replenished|restored|topped up';
const ADVERBS = '(?:(?:all|also|now|just|already|fully|completely|successfully|finally|currently)\\s+)*';
const STATE = '(?:propagated|landed|completed|finished|done|live|rolled out)';
// Do not accept "reset completed jobs", "reset live servers", etc.
const STATE_END = '(?=$|[.!?,;:]|\\s+(?:to|for|across|on|in|at|by|as|with|and|but|while|today|yesterday|now|already)\\b)';

export function resetCompletion(text: string, start: number, end: number): PredicateSpan[] {
  const patterns = [
    new RegExp("\\b(?:i|we)(?:'ve|\\s+have)\\s+" + ADVERBS + '(?:' + RESET + ')\\b', 'gi'),
    new RegExp('\\b(?:has|have|was|were)\\s+' + ADVERBS + '(?:been\\s+' + ADVERBS + ')?(?:' + RESET + ')\\b', 'gi'),
    new RegExp('\\bjust\\s+(?:' + RESET + ')\\b', 'gi'),
    /\b(?:are|is)\s+(?:now\s+)?reset\s+now\b/gi,
    /\breset\s+has\s+(?:landed|been\s+propagated)\b/gi,
  ];
  const spans = patterns.flatMap(pattern => [...text.matchAll(pattern)])
    .filter(hit => hit.index <= start && hit.index + hit[0].length >= end)
    .map(hit => ({ start: hit.index, end: hit.index + hit[0].length }));
  const suffix = text.slice(end);
  // Optional copula/auxiliary covers both complete and telegraphic announcements.
  const predicate = new RegExp('^\\s+(?:(?:for|of)\\s+(?:all\\s+)?(?:users|everyone|codex usage limits)\\s+)?'
    + ADVERBS + '(?:(?:has|have)\\s+' + ADVERBS + '(?:been\\s+' + ADVERBS + ')?|(?:is|are|was|were)\\s+' + ADVERBS + ')?'
    + '(' + STATE + '|happened)' + STATE_END, 'i').exec(suffix);
  if (predicate) {
    spans.push({ start: end + predicate[0].search(/\S/), end: end + predicate[0].length });
    spans.push({ start: end + predicate[0].lastIndexOf(predicate[1]!), end: end + predicate[0].length });
  }
  return spans;
}

/** An incomplete deployment is underway, not a future-only intention. */
export function resetInProgress(text: string, start: number, end: number): PredicateSpan[] {
  const active = new RegExp("\\b(?:i am|we are|we're|i'm|are|is)\\s+" + ADVERBS
    + '(?:(?:resetting|reseting|refilling|replenishing|restoring)|being\\s+' + ADVERBS + '(?:' + RESET + '))\\b', 'gi');
  const spans = [...text.matchAll(active)].filter(hit => hit.index <= start && hit.index + hit[0].length >= end)
    .map(hit => ({start:hit.index,end:hit.index+hit[0].length}));
  const suffix = text.slice(end);
  const hit = new RegExp('^\\s+' + ADVERBS + '(?:(?:is|are)\\s+' + ADVERBS + ')?'
    + '(?:being\\s+' + ADVERBS + '(?:propagated|rolled out)|(?:is|are)\\s+in progress|underway)' + STATE_END, 'i').exec(suffix);
  if (hit) spans.push({ start: end + hit[0].search(/\S/), end: end + hit[0].length });
  return spans;
}

/** Motion/launch words are future evidence only when directly attached to reset.
 * Time is still required by the caller; "today" alone is never a promise.
 */
export function resetScheduledAction(text: string, end: number): PredicateSpan[] {
  const hit = new RegExp('^\\s+' + ADVERBS + '(?:(?:is|are)\\s+' + ADVERBS + ')?'
    + '(?:landing|lands?|arriving|arrives?|coming|starting|rolling out|scheduled|planned|due)\\b', 'i').exec(text.slice(end));
  return hit ? [{ start: end + hit[0].search(/\S/), end: end + hit[0].length }] : [];
}

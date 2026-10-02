import { localDateTime, PACIFIC_ZONE, resolveLocalTime } from './timeZones';

export interface AnnouncementTime {
  raw: string;
  sourceZone: 'PT' | 'PST' | 'PDT';
  sourceLocal: string | null;
  date: string | null;
  instants: number[];
  kind: 'exact' | 'date-only' | 'missing-date' | 'invalid' | 'gap' | 'ambiguous';
  assumedPacific: boolean;
}

type SourceZone = AnnouncementTime['sourceZone'];
interface Span { start: number; end: number }
interface DateToken extends Span {
  year?: number;
  month?: number;
  day?: number;
  relative?: 'today' | 'tomorrow';
  weekday?: number;
  next?: boolean;
}
interface ClockToken extends Span {
  hour: number;
  minute: number;
  zone: SourceZone | undefined;
  invalid: boolean;
  midnightDeadline: boolean;
  unsupportedZone: boolean;
}
const pad = (value: number) => String(value).padStart(2, '0');
const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const weekdayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
// Reject zone-shaped suffixes generically: unknown abbreviations, IANA names,
// long-form time-zone names and offsets must not become a Pacific default.
const unsupportedZone = /^\s*(?:[A-Z]{2,}\b|[A-Za-z][\w+-]*(?:\/[\w+.-]+)+|[A-Z][a-z]+(?:\s+[A-Za-z]+){0,2}\s+(?:Time|Zone)\b|[+-]\d{1,2}(?::?\d{2})?\b|[a-z]{2,5}(?:[+-]\d{1,2}(?::?\d{2})?)?\s*$)/;
const knownNonPacificZone = /^\s*(?:EST|EDT|ET|CST|CDT|CT|MST|MDT|MT|UTC|GMT|BST|CET|CEST|JST|IST|AEST|AEDT|HKT)\b/i;
const inSupportedRange = (instant: number) => Number.isFinite(instant)
  && instant >= Date.UTC(2000, 0, 1) && instant < Date.UTC(2101, 0, 1);

function sourceLocal(instant: number, zone: SourceZone): string {
  return zone === 'PT' ? localDateTime(instant, PACIFIC_ZONE)
    : new Date(instant - (zone === 'PST' ? 8 : 7) * 3_600_000).toISOString().slice(0, 16);
}
function validDate(value: string): boolean {
  return resolveLocalTime(`${value}T00:00`, 'UTC').kind === 'valid';
}
function moveDate(value: string, days: number): string {
  return new Date(Date.parse(`${value}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
function resolveDate(token: DateToken, zone: SourceZone, createdAt: string): string | null {
  const posted = Date.parse(createdAt);
  const anchor = inSupportedRange(posted) ? sourceLocal(posted, zone).slice(0, 10) : null;
  if (token.relative) return anchor ? moveDate(anchor, token.relative === 'tomorrow' ? 1 : 0) : null;
  if (token.weekday !== undefined) {
    if (!anchor) return null;
    const current = new Date(`${anchor}T00:00:00Z`).getUTCDay();
    const days = (token.weekday - current + 7) % 7;
    return moveDate(anchor, days || (token.next ? 7 : 0));
  }
  if (token.year === undefined && !anchor) return null;
  let year = token.year ?? Number(anchor!.slice(0, 4));
  const monthDay = `${pad(token.month!)}-${pad(token.day!)}`;
  // A yearless date in a preview means its next calendar occurrence, not a
  // silently backdated announcement. Explicit years are never adjusted.
  if (token.year === undefined && `${year}-${monthDay}` < anchor!) year += 1;
  return `${year}-${monthDay}`;
}
function datesIn(raw: string): DateToken[] {
  const tokens: DateToken[] = [];
  const add = (match: RegExpMatchArray, value: Omit<DateToken, 'start' | 'end'>) => {
    const start = match.index!;
    const end = start + match[0].length;
    if (!tokens.some(token => start < token.end && end > token.start)) tokens.push({ start, end, ...value });
  };
  for (const match of raw.matchAll(/\b(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/g)) {
    add(match, { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) });
  }
  for (const match of raw.matchAll(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{3,}))?(?!\d)/gi)) {
    add(match, { month: monthNames.indexOf(match[1]!.slice(0, 3).toLowerCase()) + 1, day: Number(match[2]),
      ...(match[3] ? { year: Number(match[3]) } : {}),
    });
  }
  for (const match of raw.matchAll(/\b(today|tomorrow)(?![a-z])/gi)) {
    add(match, { relative: match[1]!.toLowerCase() as 'today' | 'tomorrow' });
  }
  for (const match of raw.matchAll(/\b(?:(next|this)\s+)?(Sun(?:day)?|Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?)\b/gi)) {
    add(match, { weekday: weekdayNames.indexOf(match[2]!.slice(0, 3).toLowerCase()), next: match[1]?.toLowerCase() === 'next' });
  }
  return tokens.sort((a, b) => a.start - b.start);
}
function clocksIn(raw: string): ClockToken[] {
  const tokens: ClockToken[] = [];
  const pattern = /(?<![\d:])(?:(\d{1,2})(?::(\d{2}))?\s*(am|pm)|(\d{1,2}):(\d{2})|\b(noon|midnight))\s*(PST|PDT|PT)?(?![a-z0-9])/gi;
  for (const match of raw.matchAll(pattern)) {
    const twelveHour = !!match[3];
    const named = match[6]?.toLowerCase();
    const originalHour = Number(match[1] ?? match[4] ?? (named === 'noon' ? 12 : 0));
    const minute = Number(match[2] ?? match[5] ?? 0);
    const hour = twelveHour ? originalHour % 12 + (match[3]!.toLowerCase() === 'pm' ? 12 : 0) : originalHour;
    const start = match.index!;
    const end = start + match[0].length;
    tokens.push({ start, end, hour, minute, zone: match[7]?.toUpperCase() as SourceZone | undefined,
      invalid: minute > 59 || (twelveHour ? originalHour < 1 || originalHour > 12 : originalHour > 23)
        || /^\s*:/.test(raw.slice(end)),
      midnightDeadline: named === 'midnight' && /\bby\s*$/i.test(raw.slice(0, start)),
      unsupportedZone: ((!match[7] && unsupportedZone.test(raw.slice(end))) || knownNonPacificZone.test(raw.slice(end)))
        && datesIn(raw.slice(end).trimStart())[0]?.start !== 0,
    });
  }
  return tokens;
}
function distance(a: Span, b: Span): number {
  return Math.max(a.start - b.end, b.start - a.end, 0);
}
function parseClause(raw: string, createdAt: string): AnnouncementTime[] {
  const dates = datesIn(raw);
  const clocks = clocksIn(raw);
  const statedZone = raw.match(/(?<![a-z])(PST|PDT|PT)\b/i)?.[1]?.toUpperCase() as SourceZone | undefined;
  // Unmarked source text assumes literal UTC-8; explicit PT still follows DST.
  const base = (zone = statedZone): AnnouncementTime => ({ raw, sourceZone: zone ?? 'PST', assumedPacific: !zone,
    sourceLocal: null, date: null, instants: [], kind: 'invalid' });
  if (clocks.length) return clocks.map(clock => {
    const result = base(clock.zone ?? statedZone);
    const nearest = [...dates].sort((a, b) => distance(a, clock) - distance(b, clock))[0];
    if (clock.unsupportedZone) { result.assumedPacific = false; return result; }
    result.date = nearest ? resolveDate(nearest, result.sourceZone, createdAt) : null;
    if (clock.invalid || (nearest && (!result.date || !validDate(result.date)))) return result;
    if (!result.date) { result.kind = 'missing-date'; return result; }
    if (clock.midnightDeadline) result.date = moveDate(result.date, 1);
    result.sourceLocal = `${result.date}T${pad(clock.hour)}:${pad(clock.minute)}`;
    // Fixed abbreviations are literal offsets, even out of their usual season.
    const resolution = resolveLocalTime(result.sourceLocal, result.sourceZone === 'PT' ? PACIFIC_ZONE : 'UTC');
    if (resolution.kind !== 'valid') { result.kind = resolution.kind; return result; }
    result.instants = resolution.instants.map(instant => instant + (result.sourceZone === 'PT' ? 0 : result.sourceZone === 'PST' ? 8 : 7) * 3_600_000);
    result.kind = result.instants.length > 1 ? 'ambiguous' : 'exact';
    return result;
  });
  const duration = raw.match(/\bin\s*(?:~|about|around|approximately)?\s*(\d+)\s*(hours?|hrs?|minutes?|mins?)\b/i);
  if (duration) {
    const result = base();
    const remainder = raw.slice(duration.index! + duration[0].length);
    if (/^\s*(?:and\s+)?\d+\s*(?:hours?|hrs?|minutes?|mins?)\b/i.test(remainder)) return [result];
    const instant = Date.parse(createdAt) + Number(duration[1]) * (/^(?:h|hour)/i.test(duration[2]!) ? 3_600_000 : 60_000);
    if (!inSupportedRange(instant)) return [result];
    result.sourceLocal = sourceLocal(instant, result.sourceZone);
    result.date = result.sourceLocal.slice(0, 10);
    result.instants = [instant];
    result.kind = 'exact';
    return [result];
  }
  return dates.map(token => {
    const result = base();
    result.date = resolveDate(token, result.sourceZone, createdAt);
    result.kind = result.date && validDate(result.date) ? 'date-only' : 'invalid';
    return result;
  });
}

/** Parse only reset-governed text supplied by the caller (not quoted posts).
 * Relative calendar dates use the post's source date, never the viewer's now.
 * Approximate wording stays in raw; an exact kind describes resolution, not
 * a guarantee that the announcement's forecast is precise.
 */
export function parseAnnouncementTimes(text: string, createdAt: string): AnnouncementTime[] {
  const results: AnnouncementTime[] = [];
  const clauses = text.split(/[.!?;\r\n]+/).flatMap(sentence => sentence.split(
    /\s*,?\s*\b(?:but|while|whereas)\b\s+|(?:,\s*|\s+and\s+)(?=(?:(?:the|an?)\s+)?(?:editor|update|release|app|model|feature|launch)\b)|\s+(?=(?:if|unless|provided)\b)/i,
  )).map(raw => raw.trim()).filter(Boolean);
  let sinceReset = Infinity;
  let antecedentStart = 0;
  for (const raw of clauses) {
    // A condition about receiving a reset is not a forecast for when the
    // reset lands. Keep it separate even when it repeats the word "reset".
    if (/^(?:PS:\s*)?(?:if|unless|provided)\b/i.test(raw)
      && /\b(?:upgrad(?:e|ing)|subscrib(?:e|ing)|sign(?:ing)?\s+up)\b|\bcreat(?:e|ing)\s+(?:(?:an?|the|your)\s+)?account\b/i.test(raw)) {
      sinceReset += 1;
      continue;
    }
    const reset = /\bresets?\b|\bresetting\b/i.test(raw);
    // Once another announced product is the subject, a subsequent "it"
    // refers to that product, not the older reset antecedent.
    if (!reset && /^(?:(?:the|an?)\s+)?(?:editor|update|release|app|model|feature|launch)\b/i.test(raw)) sinceReset = Infinity;
    const followUp = !reset && sinceReset < 3 && /^(?:lands?\b|landing\b|(?:it|first one|the first one)\s+(?:will\s+)?land\b)/i.test(raw);
    if (reset) { sinceReset = 0; antecedentStart = results.length; }
    else sinceReset += 1;
    if (!reset && !followUp) continue;
    const parsed = parseClause(raw, createdAt);
    if (followUp && parsed.some(result => result.kind === 'exact' || result.kind === 'ambiguous')) {
      // A concrete follow-up refines its own preceding date-only reset; it
      // does not remove date-only results from older reset announcements.
      for (let index = results.length - 1; index >= antecedentStart; index -= 1) {
        if (results[index]!.kind === 'date-only') results.splice(index, 1);
      }
    }
    results.push(...parsed);
  }
  const seen = new Set<string>();
  return results.filter(result => {
    const key = JSON.stringify([result.sourceZone, result.sourceLocal, result.date, result.kind, result.instants]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

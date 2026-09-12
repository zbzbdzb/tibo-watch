export const PACIFIC_ZONE = 'America/Los_Angeles';
export const BEIJING_ZONE = 'Asia/Shanghai';
export const COMMON_ZONES = [
  { id: PACIFIC_ZONE, label: '美西（洛杉矶）' },
  { id: BEIJING_ZONE, label: '北京' },
  { id: 'Asia/Hong_Kong', label: '香港' },
  { id: 'America/New_York', label: '美东（纽约）' },
  { id: 'America/Chicago', label: '美国中部（芝加哥）' },
  { id: 'Europe/London', label: '伦敦' },
  { id: 'Europe/Paris', label: '巴黎' },
  { id: 'Asia/Tokyo', label: '东京' },
  { id: 'Asia/Singapore', label: '新加坡' },
  { id: 'Asia/Kolkata', label: '印度（加尔各答）' },
  { id: 'Australia/Sydney', label: '悉尼' },
  { id: 'UTC', label: 'UTC（协调世界时）' },
] as const;
const commonIds = new Set<string>(COMMON_ZONES.map(zone => zone.id));
export const OTHER_ZONES = Intl.supportedValuesOf('timeZone').filter(zone => !commonIds.has(zone));
export const zoneLabel = (zone: string) => COMMON_ZONES.find(item => item.id === zone)?.label ?? zone;

// Bounded by the runtime's supported time-zone list.
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(zone: string) {
  let value = formatters.get(zone);
  if (!value) {
    value = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    formatters.set(zone, value);
  }
  return value;
}
export function localDateTime(instant: number, zone: string): string {
  const parts = Object.fromEntries(formatter(zone).formatToParts(instant).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
export function utcOffsetMinutes(instant: number, zone: string): number {
  return (Date.parse(`${localDateTime(instant, zone)}:00Z`) - Math.floor(instant / 60_000) * 60_000) / 60_000;
}
export function offsetLabel(minutes: number): string {
  const absolute = Math.abs(minutes);
  return `UTC${minutes < 0 ? '−' : '+'}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
}
export function zoneTimeLabel(instant: number, zone: string): string {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' }).formatToParts(instant).find(part => part.type === 'timeZoneName')?.value;
  return `${name ?? zone} · ${offsetLabel(utcOffsetMinutes(instant, zone))}`;
}
export type LocalTimeResolution = { kind: 'invalid' | 'gap'; instants: [] } | { kind: 'valid'; instants: number[] };

/** Resolve wall-clock input independently of the computer's local zone.
 * Round-trip all candidates: never silently shift DST gaps or pick a fold.
 * Input range is 2000–2100; offsets come from IANA rules, not fixed assumptions.
 */
export function resolveLocalTime(value: string, zone: string): LocalTimeResolution {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return { kind: 'invalid', instants: [] };
  const guess = Date.parse(`${value}:00Z`);
  if (!Number.isFinite(guess) || value.slice(0, 4) < '2000' || value.slice(0, 4) > '2100' || new Date(guess).toISOString().slice(0, 16) !== value) return { kind: 'invalid', instants: [] };
  try {
    const offsets = new Set<number>();
    // Sample both sides of nearby transitions, including half-hour DST and
    // date-line jumps. Round-trip below discards every non-matching candidate.
    for (let hours = -36; hours <= 36; hours += 6) offsets.add(utcOffsetMinutes(guess + hours * 3_600_000, zone));
    const instants = [...offsets].map(offset => guess - offset * 60_000)
      .filter(instant => localDateTime(instant, zone) === value).sort((a, b) => a - b);
    return instants.length ? { kind: 'valid', instants } : { kind: 'gap', instants: [] };
  } catch { return { kind: 'invalid', instants: [] }; }
}
export function dayDifference(instant: number, sourceZone: string, targetZone: string): number {
  const day = (zone: string) => Date.parse(`${localDateTime(instant, zone).slice(0, 10)}T00:00:00Z`);
  return (day(targetZone) - day(sourceZone)) / 86_400_000;
}
export function differenceLabel(minutes: number): string {
  if (!minutes) return '与来源时区相同';
  const value = Math.abs(minutes);
  const duration = `${Math.floor(value / 60) ? `${Math.floor(value / 60)} 小时` : ''}${value % 60 ? ` ${value % 60} 分钟` : ''}`.trim();
  return `比来源时区${minutes > 0 ? '快' : '慢'} ${duration}`;
}

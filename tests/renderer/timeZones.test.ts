import { describe, expect, it } from 'vitest';
import { PACIFIC_ZONE, BEIJING_ZONE, dayDifference, differenceLabel, localDateTime, offsetLabel, resolveLocalTime, utcOffsetMinutes } from '../../src/renderer/timeZones';

describe('IANA time-zone conversion', () => {
  it.each([
    ['2026-09-12T14:00', '2026-09-13T05:00', -420, 1],
    ['2026-01-12T14:00', '2026-01-13T06:00', -480, 1],
    ['2026-12-31T23:45', '2027-01-01T15:45', -480, 1],
    ['2026-03-08T01:59', '2026-03-08T17:59', -480, 0],
    ['2026-03-08T03:00', '2026-03-08T18:00', -420, 0],
    ['2028-02-29T00:00', '2028-02-29T16:00', -480, 0],
  ])('converts Pacific %s to Beijing without host-local assumptions', (value, expected, offset, day) => {
    const result = resolveLocalTime(value, PACIFIC_ZONE);
    expect(result.kind).toBe('valid'); expect(result.instants).toHaveLength(1);
    const instant = result.instants[0]!;
    expect(localDateTime(instant, BEIJING_ZONE)).toBe(expected);
    expect(utcOffsetMinutes(instant, PACIFIC_ZONE)).toBe(offset);
    expect(dayDifference(instant, PACIFIC_ZONE, BEIJING_ZONE)).toBe(day);
  });
  it.each(['2026-03-08T02:00', '2026-03-08T02:30', '2026-03-08T02:59'])('does not invent an instant for DST gap %s', value => {
    expect(resolveLocalTime(value, PACIFIC_ZONE)).toEqual({ kind: 'gap', instants: [] });
  });
  it('returns both real instants for the autumn repeated hour', () => {
    const result = resolveLocalTime('2026-11-01T01:30', PACIFIC_ZONE);
    expect(result.instants.map(value => new Date(value).toISOString())).toEqual(['2026-11-01T08:30:00.000Z', '2026-11-01T09:30:00.000Z']);
    expect(result.instants.map(value => localDateTime(value, BEIJING_ZONE))).toEqual(['2026-11-01T16:30', '2026-11-01T17:30']);
  });
  it('preserves the instant through reverse conversion and supports fractional offsets', () => {
    const instant = resolveLocalTime('2026-09-12T08:15', BEIJING_ZONE).instants[0]!;
    expect(localDateTime(instant, PACIFIC_ZONE)).toBe('2026-09-11T17:15');
    expect(dayDifference(instant, BEIJING_ZONE, PACIFIC_ZONE)).toBe(-1);
    expect(resolveLocalTime(localDateTime(instant, PACIFIC_ZONE), PACIFIC_ZONE).instants).toEqual([instant]);
    expect(localDateTime(instant, 'Asia/Kathmandu')).toBe('2026-09-12T06:00');
    expect(offsetLabel(utcOffsetMinutes(instant, 'Asia/Kathmandu'))).toBe('UTC+05:45');
    expect(differenceLabel(345 - 480)).toBe('比来源时区慢 2 小时 15 分钟');
    expect(differenceLabel(0)).toBe('与来源时区相同');
  });
  it('handles southern half-hour DST and skipped calendar dates', () => {
    expect(resolveLocalTime('2026-10-04T02:15', 'Australia/Lord_Howe').kind).toBe('gap');
    expect(resolveLocalTime('2026-04-05T01:45', 'Australia/Lord_Howe').instants).toHaveLength(2);
    expect(resolveLocalTime('2011-12-30T12:00', 'Pacific/Apia').kind).toBe('gap');
  });
  it.each(['', '2026-02-30T10:00', '2026-02-29T10:00', '2026-01-01T24:00', '2026-01-01T10:99', '1999-01-01T00:00', '2101-01-01T00:00'])('rejects invalid or out-of-range input %s', value => {
    expect(resolveLocalTime(value, PACIFIC_ZONE)).toEqual({ kind: 'invalid', instants: [] });
  });
  it('returns a safe error for an unsupported zone', () => {
    expect(resolveLocalTime('2026-01-01T12:00', 'Invalid/City')).toEqual({ kind: 'invalid', instants: [] });
  });
});

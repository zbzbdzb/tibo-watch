import { parseAnnouncementTimes } from '../../src/renderer/announcementTimes';

const postedAt = '2026-10-02T02:14:00.000Z'; // October 1 in Pacific time.
const utcTimes = (text: string, createdAt = postedAt) => parseAnnouncementTimes(text, createdAt)
  .map(result => ({ ...result, instants: result.instants.map(instant => new Date(instant).toISOString()) }));

describe('parseAnnouncementTimes', () => {
  it('honors literal PST in the original announcement rather than applying daylight time', () => {
    const text = 'Global reset landing tomorrow 10am PST for all paid ChatGPT accounts.';
    expect(utcTimes(text)).toEqual([{
      raw: text.slice(0, -1), sourceZone: 'PST', sourceLocal: '2026-10-02T10:00',
      date: '2026-10-02', instants: ['2026-10-02T18:00:00.000Z'], kind: 'exact', assumedPacific: false,
    }]);
  });

  it.each([
    ['PT', '2026-10-02T17:00:00.000Z'],
    ['PDT', '2026-10-02T17:00:00.000Z'],
  ])('resolves tomorrow at 10am %s with its source-zone rule', (zone, instant) => {
    expect(utcTimes(`Reset landing tomorrow at 10am ${zone}.`)[0]).toMatchObject({
      sourceZone: zone, date: '2026-10-02', kind: 'exact', assumedPacific: false, instants: [instant],
    });
  });

  it('anchors today to the post timestamp rather than the current viewer date', () => {
    expect(utcTimes('Reset today14:30PT.')[0]).toMatchObject({
      date: '2026-10-01', sourceLocal: '2026-10-01T14:30', instants: ['2026-10-01T21:30:00.000Z'], kind: 'exact',
    });
  });

  it('defaults an unmarked source clock to fixed PST and marks the assumption', () => {
    expect(utcTimes('Reset tomorrow at 10am.')[0]).toMatchObject({
      sourceZone: 'PST', assumedPacific: true, date: '2026-10-02', sourceLocal: '2026-10-02T10:00',
      kind: 'exact', instants: ['2026-10-02T18:00:00.000Z'],
    });
  });

  it('does not invent midnight for a tomorrow-only announcement', () => {
    expect(utcTimes('Codex reset will land tomorrow.')[0]).toMatchObject({
      sourceZone: 'PST', date: '2026-10-02', sourceLocal: null, instants: [], kind: 'date-only', assumedPacific: true,
    });
  });

  it('does not invent a calendar date for a clock-only announcement', () => {
    expect(utcTimes('Reset at 10am PST.')[0]).toMatchObject({
      sourceZone: 'PST', date: null, sourceLocal: null, instants: [], kind: 'missing-date',
    });
  });

  it.each([
    'A reset is coming. The editor will launch tomorrow at 10am PT.',
    'The editor launches tomorrow at 10am PT. More reset details soon.',
    'An update arrives tomorrow at 10am PT.',
    'A reset is coming.',
  ])('ignores clocks outside a reset-governed clause: %s', text => {
    expect(parseAnnouncementTimes(text, postedAt)).toEqual([]);
  });

  it.each([
    ['Reset July 1, 2026 at 10am PST.', '2026-07-01T18:00:00.000Z'],
    ['Reset January 2, 2026 at 10am PDT.', '2026-01-02T17:00:00.000Z'],
    ['Reset January 2, 2026 at 10am PT.', '2026-01-02T18:00:00.000Z'],
    ['Reset on 2026-10-02 at 14:30 PT.', '2026-10-02T21:30:00.000Z'],
    ['Reset on Oct 2nd, 2026 at 2:30pm PT.', '2026-10-02T21:30:00.000Z'],
    ['Reset Friday at noon PT.', '2026-10-02T19:00:00.000Z'],
    ['Reset tomorrow at 12am PT.', '2026-10-02T07:00:00.000Z'],
    ['Reset tomorrow at 12pm PT.', '2026-10-02T19:00:00.000Z'],
    ['Reset tomorrow at midnight PT.', '2026-10-02T07:00:00.000Z'],
  ])('resolves a supported explicit or named wall clock: %s', (text, instant) => {
    expect(utcTimes(text)[0]).toMatchObject({ kind: 'exact', instants: [instant] });
  });

  it('moves a by-midnight-today deadline to the end of the source calendar day', () => {
    expect(utcTimes('Reset by midnight today PT.')[0]).toMatchObject({
      date: '2026-10-02', sourceLocal: '2026-10-02T00:00', instants: ['2026-10-02T07:00:00.000Z'], kind: 'exact',
    });
  });

  it('does not invent the date of an undated midnight', () => {
    expect(utcTimes('Reset at midnight PT.')[0]).toMatchObject({ kind: 'missing-date', date: null, instants: [] });
  });

  it('anchors a relative date in the explicit fixed source zone near midnight', () => {
    const createdAt = '2026-07-02T07:30:00.000Z'; // July 1 in PST, July 2 in PT/PDT.
    expect(utcTimes('Reset today at 10am PST.', createdAt)[0]).toMatchObject({
      date: '2026-07-01', instants: ['2026-07-01T18:00:00.000Z'],
    });
    expect(utcTimes('Reset today at 10am PT.', createdAt)[0]).toMatchObject({
      date: '2026-07-02', instants: ['2026-07-02T17:00:00.000Z'],
    });
  });

  it.each([
    ['today', '2026-07-01', '2026-07-01T18:00:00.000Z'],
    ['tomorrow', '2026-07-02', '2026-07-02T18:00:00.000Z'],
  ])('anchors an unmarked %s clock to the fixed-PST source calendar near midnight', (relative, date, instant) => {
    const createdAt = '2026-07-02T07:30:00.000Z'; // July 1 in PST, July 2 in PT/PDT.
    expect(utcTimes(`Reset ${relative} at 10am.`, createdAt)[0]).toMatchObject({
      sourceZone: 'PST', assumedPacific: true, date, sourceLocal: `${date}T10:00`,
      kind: 'exact', instants: [instant],
    });
  });

  it.each([
    ['today', '2026-07-01'],
    ['tomorrow', '2026-07-02'],
  ])('anchors an unmarked %s date-only announcement to the fixed-PST source calendar', (relative, date) => {
    expect(utcTimes(`Reset ${relative}.`, '2026-07-02T07:30:00.000Z')[0]).toMatchObject({
      sourceZone: 'PST', assumedPacific: true, date, sourceLocal: null, kind: 'date-only', instants: [],
    });
  });

  it('advances tomorrow across a calendar year boundary', () => {
    expect(utcTimes('Reset tomorrow at 10am PT.', '2027-01-01T02:00:00.000Z')[0]).toMatchObject({
      date: '2027-01-01', instants: ['2027-01-01T18:00:00.000Z'],
    });
  });

  it('interprets a yearless month and day as the next occurrence after the post', () => {
    expect(utcTimes('Reset on January 2 at 10am PT.', '2027-01-01T02:00:00.000Z')[0]).toMatchObject({
      date: '2027-01-02', instants: ['2027-01-02T18:00:00.000Z'],
    });
  });

  it('retains a stated calendar date without inventing its clock', () => {
    expect(utcTimes('Reset on October 2, 2026.')[0]).toMatchObject({
      sourceZone: 'PST', assumedPacific: true, date: '2026-10-02', kind: 'date-only', sourceLocal: null, instants: [],
    });
  });

  it.each([
    'Reset February 30, 2026 at 10am PT.',
    'Reset on 2026-02-30 at 10am PST.',
    'Reset October 2, 2026 at 25:00 PT.',
    'Reset October 2, 2026 at 10:99am PDT.',
    'Reset October 2, 2026 at 13pm PT.',
    'Reset October 2, 2026 at 13am PT.',
  ])('rejects invalid calendar or clock input without normalizing it: %s', text => {
    expect(utcTimes(text)[0]).toMatchObject({ kind: 'invalid', instants: [] });
  });

  it('reports the spring DST gap instead of moving 02:30 to 03:30', () => {
    expect(utcTimes('Reset on March 8, 2026 at 2:30am PT.')[0]).toMatchObject({
      date: '2026-03-08', sourceLocal: '2026-03-08T02:30', kind: 'gap', instants: [],
    });
  });

  it('returns both fall DST instants without choosing a repeated 01:30', () => {
    expect(utcTimes('Reset on November 1, 2026 at 1:30am PT.')[0]).toMatchObject({
      date: '2026-11-01', sourceLocal: '2026-11-01T01:30', kind: 'ambiguous',
      instants: ['2026-11-01T08:30:00.000Z', '2026-11-01T09:30:00.000Z'],
    });
  });

  it.each([
    ['PST', '2026-11-01T09:30:00.000Z'],
    ['PDT', '2026-11-01T08:30:00.000Z'],
  ])('resolves an explicitly disambiguated repeated hour in %s', (zone, instant) => {
    expect(utcTimes(`Reset on November 1, 2026 at 1:30am ${zone}.`)[0]).toMatchObject({
      kind: 'exact', instants: [instant],
    });
  });

  it('keeps separately stated reset times with their nearest calendar date', () => {
    expect(utcTimes('Resets today at 10am PT and tomorrow at 2pm PT.').map(result => result.instants)).toEqual([
      ['2026-10-01T17:00:00.000Z'], ['2026-10-02T21:00:00.000Z'],
    ]);
  });

  it('deduplicates repeated references to the same instant', () => {
    expect(utcTimes('Reset tomorrow at 10am PT. Reset tomorrow at 10am PT.')).toHaveLength(1);
  });

  it.each([
    'A reset is coming, while the editor launches tomorrow at 10am PT.',
    'A reset is coming and the editor launches tomorrow at 10am PT.',
    'The editor launches tomorrow at 10am PT, but a reset is coming.',
  ])('does not borrow a clock from a separate update clause: %s', text => {
    expect(parseAnnouncementTimes(text, postedAt)).toEqual([]);
  });

  it('does not borrow an editor clock when a reset has its own date-only announcement', () => {
    expect(utcTimes('Reset tomorrow; the editor launches today at 10am PT.')).toMatchObject([
      { date: '2026-10-02', kind: 'date-only', instants: [] },
    ]);
  });

  it('rejects a relative date if the post timestamp is invalid instead of falling back to now', () => {
    expect(utcTimes('Reset tomorrow at 10am PT.', 'not-a-timestamp')[0]).toMatchObject({
      kind: 'invalid', date: null, instants: [],
    });
  });

  it('resolves a fully explicit date even when the post timestamp is unavailable', () => {
    expect(utcTimes('Reset October 2, 2026 at 10am PT.', 'not-a-timestamp')[0]).toMatchObject({
      kind: 'exact', instants: ['2026-10-02T17:00:00.000Z'],
    });
  });

  it('recognizes a bounded subjectless Lands follow-up to a reset announcement', () => {
    const text = 'We will do a global reset of the usage for all paid subscriptions. The work week is about to start.\n\nLands around 6pm PST today.';
    expect(utcTimes(text, '2026-09-07T19:24:57.000Z')).toMatchObject([{
      raw: 'Lands around 6pm PST today', sourceZone: 'PST', date: '2026-09-07',
      kind: 'exact', instants: ['2026-09-08T02:00:00.000Z'],
    }]);
  });

  it('does not convert a PS eligibility cutoff into the reset landing time', () => {
    const text = 'You get a full banked reset today too. Lands end of day.\n\nPS: If you create the account or upgrade before 8pm PT you will get it too.';
    expect(utcTimes(text)).toMatchObject([{ date: '2026-10-01', kind: 'date-only', instants: [] }]);
  });

  it('preserves an approximate elapsed duration instant while rendering assumed PST and refining its earlier date-only reset', () => {
    const text = 'We will give one banked reset for every day starting today.\n\nFirst one will land in ~ 3 hours.';
    expect(utcTimes(text, '2026-09-03T23:12:09.000Z')).toMatchObject([{
      raw: 'First one will land in ~ 3 hours', date: '2026-09-03', sourceLocal: '2026-09-03T18:12',
      sourceZone: 'PST', assumedPacific: true, kind: 'exact', instants: ['2026-09-04T02:12:09.000Z'],
    }]);
  });

  it('converts an elapsed number of minutes without rounding away the post seconds', () => {
    expect(utcTimes('Reset will land in 30 minutes.', '2026-10-02T02:14:09.000Z')[0]).toMatchObject({
      sourceZone: 'PST', assumedPacific: true, sourceLocal: '2026-10-01T18:44',
      kind: 'exact', instants: ['2026-10-02T02:44:09.000Z'],
    });
  });

  it.each([
    'Reset will land within 3 hours.',
    'Reset will land in 2-3 hours.',
    'Reset will land in 2 to 3 hours.',
    'Reset is coming. The editor will launch in 3 hours.',
  ])('does not invent an exact instant for an uncertain or unrelated duration: %s', text => {
    expect(parseAnnouncementTimes(text, postedAt)).toEqual([]);
  });

  it.each(['EST', 'ET', 'UTC', 'GMT', 'CST', 'JST', 'UTC+8', '+08:00', 'PT EST'])('does not silently reinterpret an explicit %s clock as Pacific', zone => {
    expect(utcTimes(`Reset tomorrow at 10am ${zone}.`)[0]).toMatchObject({
      kind: 'invalid', assumedPacific: false, instants: [],
    });
  });

  it('keeps a reset date-only when its clock belongs to a conditional eligibility cutoff', () => {
    expect(utcTimes('You get a reset tomorrow if you upgrade before 8pm PT.')).toMatchObject([
      { date: '2026-10-02', kind: 'date-only', sourceLocal: null, instants: [] },
    ]);
  });

  it('ignores a second reset mention governed by an eligibility condition', () => {
    expect(utcTimes('Reset will land tomorrow. If you upgrade before 8pm PT today you get a reset too.')).toMatchObject([
      { date: '2026-10-02', kind: 'date-only', instants: [] },
    ]);
  });

  it('does not infer a reset antecedent for It after an explicit editor subject', () => {
    expect(parseAnnouncementTimes('A reset is coming. The editor is coming. It will land tomorrow at 10am PT.', postedAt)).toEqual([]);
  });

  it('preserves the reset date-only result when a later It refers to the editor', () => {
    expect(utcTimes('A reset lands tomorrow. The editor is coming. It will land today at 10am PT.')).toMatchObject([
      { date: '2026-10-02', kind: 'date-only', instants: [] },
    ]);
  });

  it('separates a reset date from an editor update governed by an indefinite article', () => {
    expect(utcTimes('A reset lands tomorrow and an editor update lands today at 10am PT.')).toMatchObject([
      { date: '2026-10-02', kind: 'date-only', instants: [] },
    ]);
  });

  it.each(['EET', 'PSTT', 'Europe/London', 'Pacific Standard Time', 'est', 'utc', 'eet'])('does not assume Pacific for an unrecognized explicit zone suffix: %s', zone => {
    expect(utcTimes(`Reset tomorrow at 10am ${zone}.`)[0]).toMatchObject({
      kind: 'invalid', assumedPacific: false, instants: [],
    });
  });

  it.each(['10:30:99', '10:30:45'])('does not truncate unsupported clock seconds into a precise minute: %s', clock => {
    expect(utcTimes(`Reset tomorrow at ${clock} PT.`)).toMatchObject([
      { kind: 'invalid', instants: [] },
    ]);
  });

  it('does not backtrack a malformed explicit year into a yearless date', () => {
    expect(utcTimes('Reset October 2, 20260 at 10am PT.')[0]).toMatchObject({ kind: 'invalid', instants: [] });
  });

  it.each(['99999999999999', '1000000'])('rejects an elapsed duration outside the supported years before formatting: %s hours', hours => {
    expect(utcTimes(`Reset will land in ${hours} hours.`)[0]).toMatchObject({
      kind: 'invalid', sourceLocal: null, date: null, instants: [],
    });
  });

  it.each(['3 hours and 30 minutes', '3 hours 30 minutes'])('does not convert only the first component of an unsupported compound duration: %s', duration => {
    expect(utcTimes(`Reset will land in ${duration}.`)[0]).toMatchObject({
      kind: 'invalid', sourceLocal: null, date: null, instants: [],
    });
  });

  it.each(['sharp', 'too'])('keeps a recognized inline Pacific zone when ordinary wording follows: %s', suffix => {
    expect(utcTimes(`Reset tomorrow at 10am PT ${suffix}.`)[0]).toMatchObject({
      sourceZone: 'PT', assumedPacific: false, kind: 'exact', instants: ['2026-10-02T17:00:00.000Z'],
    });
  });
});

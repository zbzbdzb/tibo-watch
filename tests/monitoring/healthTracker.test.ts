import { describe, expect, it } from 'vitest';

import { SourceHealthTracker } from '../../src/main/monitoring/sourceHealthTracker';

describe('SourceHealthTracker', () => {
  it('marks a source stale after three consecutive failed cycles', () => {
    const tracker = new SourceHealthTracker(['public-rss', 'x-browser']);
    tracker.record('public-rss', false, '2026-07-31T05:00:00.000Z');
    tracker.record('public-rss', false, '2026-07-31T05:05:00.000Z');
    expect(tracker.get('public-rss').state).toBe('error');
    tracker.record('public-rss', false, '2026-07-31T05:10:00.000Z');
    expect(tracker.get('public-rss')).toMatchObject({ state: 'stale', consecutiveFailures: 3 });
  });

  it('resets failures when data succeeds', () => {
    const tracker = new SourceHealthTracker(['public-rss']);
    tracker.record('public-rss', false, '2026-07-31T05:00:00.000Z');
    tracker.record('public-rss', true, '2026-07-31T05:05:00.000Z');
    expect(tracker.get('public-rss')).toMatchObject({ state: 'online', consecutiveFailures: 0 });
  });

  it('emits only one outage incident until either source recovers', () => {
    const tracker = new SourceHealthTracker(['public-rss', 'x-browser']);
    for (let index = 0; index < 3; index += 1) {
      tracker.record('public-rss', false, `2026-07-31T05:${index}0:00.000Z`);
      tracker.record('x-browser', false, `2026-07-31T05:${index}0:00.000Z`);
    }
    expect(tracker.consumeOutageIncident()).toBe(true);
    expect(tracker.consumeOutageIncident()).toBe(false);
    tracker.record('x-browser', true, '2026-07-31T05:30:00.000Z');
    tracker.record('x-browser', false, '2026-07-31T05:35:00.000Z');
    tracker.record('x-browser', false, '2026-07-31T05:40:00.000Z');
    tracker.record('x-browser', false, '2026-07-31T05:45:00.000Z');
    expect(tracker.consumeOutageIncident()).toBe(true);
  });
});

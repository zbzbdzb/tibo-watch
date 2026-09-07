import { describe, expect, it } from 'vitest';

import { SourceHealthTracker } from '../../src/main/monitoring/sourceHealthTracker';

describe('SourceHealthTracker', () => {
  it.each(['syncing', 'partial'] as const)('does not count %s as failure or generate an outage', (state) => {
    const tracker = new SourceHealthTracker(['x-browser']);
    tracker.record('x-browser', true, '2026-09-07T07:00:00Z');
    for (let index = 0; index < 5; index++) tracker.recordState('x-browser', state, '2026-09-07T07:05:00Z');
    expect(tracker.get('x-browser')).toMatchObject({ state, consecutiveFailures: 0, lastSuccessAt: '2026-09-07T07:00:00Z' });
    expect(tracker.consumeOutageIncident()).toBe(false);
  });
  it('preserves actionable login diagnostics through repeated failures', () => {
    const tracker = new SourceHealthTracker(['x-browser']);
    for (let index = 0; index < 4; index += 1) tracker.recordState('x-browser', 'needs_login', '2026-09-05T00:00:00Z', 'X_SESSION_EXPIRED');
    expect(tracker.get('x-browser')).toMatchObject({ state: 'needs_login', errorCode: 'X_SESSION_EXPIRED' });
    expect(tracker.consumeOutageIncident()).toBe(true);
    expect(tracker.consumeOutageIncident()).toBe(false);
    tracker.recordState('x-browser', 'disabled', '2026-09-05T00:00:00Z');
    expect(tracker.get('x-browser').errorCode).toBeNull();
  });
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

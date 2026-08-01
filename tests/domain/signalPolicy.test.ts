import { describe, expect, it } from 'vitest';
import { decideSignalEvent } from '../../src/main/events/signalPolicy';

describe('signal event policy', () => {
  it('does not notify for posts imported during the initial baseline', () => {
    expect(
      decideSignalEvent({ baseline: true, previousLevel: null, currentLevel: 'confirmed' }),
    ).toBeNull();
  });

  it('creates an event for a newly detected confirmed reset', () => {
    expect(
      decideSignalEvent({ baseline: false, previousLevel: null, currentLevel: 'confirmed' }),
    ).toEqual({ level: 'confirmed', previousLevel: null, isEscalation: false });
  });

  it('does not repeat an event at the same classification level', () => {
    expect(
      decideSignalEvent({ baseline: false, previousLevel: 'preview', currentLevel: 'preview' }),
    ).toBeNull();
  });

  it('emits one escalation when a preview becomes confirmed', () => {
    expect(
      decideSignalEvent({ baseline: false, previousLevel: 'preview', currentLevel: 'confirmed' }),
    ).toEqual({ level: 'confirmed', previousLevel: 'preview', isEscalation: true });
  });

  it('does not emit a downgrade from confirmed to preview', () => {
    expect(
      decideSignalEvent({ baseline: false, previousLevel: 'confirmed', currentLevel: 'preview' }),
    ).toBeNull();
  });

  it('creates a silent-related event but ignores irrelevant posts', () => {
    expect(
      decideSignalEvent({ baseline: false, previousLevel: null, currentLevel: 'related' }),
    ).toEqual({ level: 'related', previousLevel: null, isEscalation: false });
    expect(
      decideSignalEvent({ baseline: false, previousLevel: null, currentLevel: 'irrelevant' }),
    ).toBeNull();
  });
});

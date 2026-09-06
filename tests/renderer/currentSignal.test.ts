import type { PostView } from '../../src/shared/api';

import { selectCurrentSignal } from '../../src/renderer/currentSignal';

describe('current reset signal lifetime', () => {
  test('expires a confirmed reset at twelve hours', () => {
    const signal = createSignal('confirmed', '2026-09-01T00:00:00.000Z');

    expect(selectCurrentSignal([signal], '2026-09-01T11:59:59.999Z')).toBe(signal);
    expect(selectCurrentSignal([signal], '2026-09-01T12:00:00.000Z')).toBeNull();
  });

  test('expires a reset preview at thirty-six hours', () => {
    const signal = createSignal('preview', '2026-09-01T00:00:00.000Z');

    expect(selectCurrentSignal([signal], '2026-09-02T11:59:59.999Z')).toBe(signal);
    expect(selectCurrentSignal([signal], '2026-09-02T12:00:00.000Z')).toBeNull();
  });

  test('does not resurrect an older preview after a newer confirmation expires', () => {
    const preview = createSignal('preview', '2026-09-01T00:00:00.000Z');
    const confirmed = createSignal('confirmed', '2026-09-01T08:00:00.000Z');

    expect(selectCurrentSignal(
      [preview, confirmed],
      '2026-09-01T20:00:00.000Z',
    )).toBeNull();
  });
});

function createSignal(
  level: 'confirmed' | 'preview',
  createdAt: string,
): PostView {
  return {
    post: {
      id: level === 'confirmed' ? 'confirmed-signal' : 'preview-signal',
      authorHandle: 'thsottiaux',
      text: level === 'confirmed' ? 'Usage limits reset.' : 'Reset tomorrow.',
      createdAt,
      url: `https://x.com/thsottiaux/status/${level === 'confirmed' ? '1' : '2'}`,
      kind: 'original',
      quotedText: null,
      sourceIds: ['x-browser'],
    },
    classification: {
      level,
      score: 8,
      reasons: ['test fixture'],
      matchedTerms: ['reset'],
      classifierVersion: 'test',
    },
  };
}

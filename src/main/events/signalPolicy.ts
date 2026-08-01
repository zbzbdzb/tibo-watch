import type { SignalLevel } from '../../shared/domain';

export interface SignalDecision {
  level: Exclude<SignalLevel, 'irrelevant'>;
  previousLevel: SignalLevel | null;
  isEscalation: boolean;
}

export function decideSignalEvent(_input: {
  baseline: boolean;
  previousLevel: SignalLevel | null;
  currentLevel: SignalLevel;
}): SignalDecision | null {
  if (_input.baseline || _input.currentLevel === 'irrelevant') return null;

  const rank: Record<SignalLevel, number> = {
    irrelevant: 0,
    related: 1,
    preview: 2,
    confirmed: 3,
  };
  const previousRank = _input.previousLevel ? rank[_input.previousLevel] : -1;
  const currentRank = rank[_input.currentLevel];

  if (currentRank <= previousRank) return null;

  return {
    level: _input.currentLevel,
    previousLevel: _input.previousLevel,
    isEscalation: _input.previousLevel !== null,
  };
}

export type LiveDmoUmpireScoreSource = 'te4' | 'dmo' | 'replay';

export function resolveLiveDmoUmpireScoreSource(
  broadcastMode: 'auto' | 'manual',
  isReplay: boolean,
): LiveDmoUmpireScoreSource {
  if (isReplay) return 'replay';
  return broadcastMode === 'auto' ? 'te4' : 'dmo';
}

export function shouldPairLiveDmoScoreWithPointEnd(
  source: LiveDmoUmpireScoreSource,
  state: 'live' | 'ended',
): boolean {
  return state === 'live' && source !== 'replay';
}

export type LiveDmoUmpireScoreSource = 'te4' | 'dmo' | 'replay';

export function resolveLiveDmoUmpireScoreSource(
  broadcastMode: 'auto' | 'manual',
  isReplay: boolean,
): LiveDmoUmpireScoreSource {
  if (isReplay) return 'replay';
  return broadcastMode === 'auto' ? 'te4' : 'dmo';
}

/**
 * A live-window fallback still plays DMO frames and point-end events. Historical
 * streams must use their DMO score, even when the original broadcast was automatic.
 */
export function resolveLiveDmoUmpireFallbackScoreSource(
  broadcastMode: 'auto' | 'manual',
  isReplay: boolean,
): LiveDmoUmpireScoreSource {
  if (isReplay) return 'dmo';
  return resolveLiveDmoUmpireScoreSource(broadcastMode, false);
}

export function shouldPairLiveDmoScoreWithPointEnd(
  source: LiveDmoUmpireScoreSource,
  state: 'live' | 'ended',
): boolean {
  return state === 'live' && source !== 'replay';
}

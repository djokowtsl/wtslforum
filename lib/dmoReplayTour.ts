/**
 * The replay submission's tournament label records its tour when known.
 * Keep unmarked events unverified instead of treating them as ATP metadata.
 */
export function dmoReplayIsWta(tournament: unknown): boolean | undefined {
  if (typeof tournament !== 'string') return undefined;
  if (/\bWTA\b/i.test(tournament)) return true;
  if (/\bATP\b/i.test(tournament)) return false;
  return undefined;
}

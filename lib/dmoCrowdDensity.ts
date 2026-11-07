export const CROWD_DENSITY_CHOICES = ['auto', 'light', 'standard', 'packed'] as const;
export type CrowdDensityChoice = typeof CROWD_DENSITY_CHOICES[number];

export const TOURNAMENT_ROUND_CHOICES = [
  'auto',
  'round-of-64',
  'round-of-32',
  'round-of-16',
  'quarterfinal',
  'semifinal',
  'final',
] as const;
export type TournamentRoundChoice = typeof TOURNAMENT_ROUND_CHOICES[number];

const ROUND_DENSITIES: Record<Exclude<TournamentRoundChoice, 'auto'>, number> = {
  'round-of-64': 0.58,
  'round-of-32': 0.68,
  'round-of-16': 0.78,
  quarterfinal: 0.87,
  semifinal: 0.94,
  final: 0.99,
};

export function crowdDensityForRound(round: string | null | undefined) {
  const normalized = round?.trim().toLowerCase() ?? '';
  if (normalized in ROUND_DENSITIES) {
    return ROUND_DENSITIES[normalized as Exclude<TournamentRoundChoice, 'auto'>];
  }
  return 0.98;
}

export function resolveCrowdDensity(
  choice: CrowdDensityChoice,
  round: string | null | undefined,
) {
  if (choice === 'auto') return crowdDensityForRound(round);
  if (choice === 'light') return 0.42;
  if (choice === 'packed') return 0.99;
  return 0.98;
}

export function isCrowdSeatOccupied(sourceIndex: number, density: number) {
  let hash = sourceIndex;
  hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d);
  hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 0x1_0000_0000 < Math.max(0, Math.min(1, density));
}

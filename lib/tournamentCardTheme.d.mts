export type TournamentCardTheme =
  | 'australian-open'
  | 'roland-garros'
  | 'wimbledon'
  | 'us-open'
  | 'indian-wells'
  | 'indoor'
  | 'grass'
  | 'clay'
  | 'hard'
  | 'classic';

export function tournamentCardTheme(name: unknown, surface: unknown): TournamentCardTheme;

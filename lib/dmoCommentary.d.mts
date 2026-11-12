export type DmoCommentaryContext = {
  tour: 'ATP' | 'WTA';
  players: Array<{
    name: string;
    rank: number | null;
    tourElo: number | null;
  }>;
  headToHead: {
    firstWins: number;
    secondWins: number;
    matches: number;
  } | null;
};

export type DmoCommentaryPoint = {
  number?: number;
  frame?: number;
  server?: number | null;
  winner?: number | null;
  rallyHits?: number | null;
  rallyShotCount?: number | null;
  highlightReasons?: string | null;
  faults?: number | null;
  inferred?: boolean;
  isTiebreak?: boolean;
  winningStreak?: number;
  serveSpeedKmh?: number | null;
  suppressRallyCommentary?: boolean;
  shots?: readonly { p: number; k: string; bx: number | null; by: number | null; bt?: number | null }[];
  shotEndTime?: number;
  scoreBeforeLabel?: string | null;
  scoreAfterLabel?: string | null;
  setBefore?: number;
  setAfter?: number;
};

export type DmoBrowserVoice = {
  voiceURI: string;
  name: string;
  lang: string;
  localService?: boolean;
  default?: boolean;
};

type DmoCommentaryIntroductionOptions = {
  names?: readonly (string | null | undefined)[];
  tournament?: string | null;
  surface?: string | null;
  round?: string | null;
};

type DmoCommentaryFactsOptions = {
  names?: readonly (string | null | undefined)[];
  context?: DmoCommentaryContext | null;
};

type DmoCommentaryOpeningReplyOptions = {
  names?: readonly (string | null | undefined)[];
  pointNumber?: number;
  recentLines?: readonly string[];
};

type DmoCommentaryResponseOptions = {
  names?: readonly (string | null | undefined)[];
  winner?: number | null;
  pointNumber?: number;
  recentLines?: readonly string[];
};

export function buildDmoCommentaryIntroduction(
  options?: DmoCommentaryIntroductionOptions,
): string;

export function buildDmoCommentaryOpeningReply(
  options?: DmoCommentaryOpeningReplyOptions,
): string;

export function buildDmoCommentaryResponse(
  options?: DmoCommentaryResponseOptions,
): string;

export function buildDmoCommentaryFacts(
  options?: DmoCommentaryFactsOptions,
): string;

export function buildDmoPointCommentary(
  point: DmoCommentaryPoint,
  names?: readonly (string | null | undefined)[],
  recentLines?: readonly string[],
): string;

export function buildDmoRallyCommentary(options: {
  names?: readonly (string | null | undefined)[];
  rallyShotCount: number;
  pointNumber?: number;
  recentLines?: readonly string[];
}): string;

export function rankDmoBrowserVoices<T extends DmoBrowserVoice>(
  voices?: readonly T[],
): T[];

export function chooseDmoCommentaryVoice<T extends DmoBrowserVoice>(
  voices?: readonly T[],
): T | null;

export function chooseDmoCommentaryVoices<T extends DmoBrowserVoice>(
  voices?: readonly T[],
): { female: T | null; male: T | null; distinct: boolean };

export function withDmoCommentaryHistory<T extends DmoCommentaryPoint>(
  point: T, history?: readonly DmoCommentaryPoint[],
): T & { winningStreak: number };

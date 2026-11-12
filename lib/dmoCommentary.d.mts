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
  scoreBeforeLabel?: string | null;
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

export function buildDmoCommentaryIntroduction(
  options?: DmoCommentaryIntroductionOptions,
): string;

export function buildDmoCommentaryFacts(
  options?: DmoCommentaryFactsOptions,
): string;

export function buildDmoPointCommentary(
  point: DmoCommentaryPoint,
  names?: readonly (string | null | undefined)[],
): string;

export function rankDmoBrowserVoices<T extends DmoBrowserVoice>(
  voices?: readonly T[],
): T[];

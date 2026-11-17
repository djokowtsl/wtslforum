export const DMO_REPLAY_SPEEDS: readonly DmoReplaySpeed[];
export const DMO_REPLAY_RESTART_SECONDS: number;

export type DmoReplaySpeed = 0.25 | 0.5 | 1 | 2 | 4 | 8;

export interface DmoReplayPointEntry {
  index: number;
  number: number;
  start: number;
  end: number;
  set: number;
  /** Games in the set before the point, "2-1". */
  games: string;
  /** Point score before the point, "30-15". */
  score: string;
  tiebreak: boolean;
  server: 1 | 2;
  winner: 1 | 2 | null;
  shots: number;
  outcome: 'ace' | 'double-fault' | 'winner' | 'error' | null;
  endsGame: boolean;
  endsSet: boolean;
  endsMatch: boolean;
  isBreak: boolean;
}

export interface DmoReplaySeekMarker {
  fraction: number;
  kind: 'game' | 'set';
  point: number;
}

export type DmoReplayMoment = { point: number } | { seconds: number };

export function buildDmoReplayPointIndex(
  points: readonly {
    k?: number; mf: number; fc?: number; set?: number; g?: string; pt?: string;
    tb?: 0 | 1; s?: 1 | 2; w?: 1 | 2; f?: number; sh?: readonly { p?: number }[];
  }[] | null | undefined,
  options?: { matchOver?: boolean },
): DmoReplayPointEntry[];
export function dmoReplayPointAt(index: readonly DmoReplayPointEntry[], frame: number): number;
export function dmoReplayAdjacentPointFrame(
  index: readonly DmoReplayPointEntry[], frame: number, direction: number, frameRate?: number,
): number | null;
export function dmoReplaySeekMarkers(
  index: readonly DmoReplayPointEntry[], startFrame: number, endFrame: number,
): DmoReplaySeekMarker[];
export function stepDmoReplaySpeed(speed: number, direction: number): DmoReplaySpeed;
export function normalizeDmoReplaySpeed(value: unknown): DmoReplaySpeed;
export function parseDmoReplayMoment(search: string | URLSearchParams | null | undefined): DmoReplayMoment | null;
export function formatDmoReplayMoment(seconds: number): string;
export function dmoReplayMomentFrame(
  moment: DmoReplayMoment | null | undefined,
  index: readonly DmoReplayPointEntry[] | null | undefined,
  startFrame: number,
  endFrame: number,
  frameRate?: number,
): number | null;
export function dmoReplayMomentUrl(
  href: string, seconds: number, params?: Readonly<Record<string, string>>,
): string | null;
export function describeDmoReplayPoint(
  point: DmoReplayPointEntry, players: readonly [string, string] | readonly string[],
): { winner: string; how: string };

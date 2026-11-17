export const DMO_SLIDE_COOLDOWN_SECONDS: number;
export const DMO_STRETCH_REACH: number;
export const DMO_SLIDE_RULES: Readonly<Record<'clay' | 'hard' | 'unknown', Readonly<{ speed: number; reach: number }>> & { grass: null }>;

export type DmoShotMovementKind = 'slide' | 'stretch';

export interface DmoShotMeasure {
  approachSpeed: number;
  speedAfter: number;
  reach: number;
  ballHeight: number;
  depth: number;
}

export interface DmoShotMovement {
  frame: number;
  player: 1 | 2;
  kind: DmoShotMovementKind;
  reach: number;
  ballHeight: number;
  approachSpeed: number;
}

type Sample = { frame: number; values: readonly number[] };
type ShotEvent = { frame: number; kind: string; player?: 1 | 2; shotType?: string };

export function measureDmoShot(samples: readonly Sample[], event: ShotEvent, frameRate?: number): DmoShotMeasure | null;
export function classifyDmoShotMovement(
  measured: DmoShotMeasure | null, surface?: string,
): DmoShotMovementKind | null;
export function planDmoShotMovements(
  samples: readonly Sample[],
  events: readonly ShotEvent[],
  options?: { surface?: string; frameRate?: number },
): DmoShotMovement[];
export function dmoShotMovementAt(
  plan: readonly DmoShotMovement[] | null | undefined, player: 1 | 2, frame: number,
): DmoShotMovement | null;

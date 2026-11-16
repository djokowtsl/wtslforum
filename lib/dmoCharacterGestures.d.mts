export type DmoGestureType =
  | 'ThrowRacket' | 'HitRacket' | 'Stupid' | 'Applause'
  | 'RagingFist' | 'CheerFist' | 'CheerJump' | 'Sorry'
  | 'Victory' | 'VictoryGreat';
export const DMO_GESTURES: ReadonlyArray<{
  type: DmoGestureType; part: number; outcome: 'win' | 'loss' | 'match'; label: string;
}>;
export const DMO_GESTURE_TYPES: readonly DmoGestureType[];
export function dmoGestureType(value: unknown): DmoGestureType | null;
export function getDmoCharacterGestures(name: string | null | undefined): Partial<Record<DmoGestureType, number>>;
export function chooseDmoPointGestures(point: {
  winner: 1 | 2;
  server?: 1 | 2;
  importance?: 'normal' | 'break' | 'set' | 'match';
  rallyHits?: number;
  endedBy?: 'winner' | 'error' | null;
  tiebreak?: boolean;
  decidingSet?: boolean;
  doubleFault?: boolean;
}): Array<{ player: 1 | 2; type: DmoGestureType }>;

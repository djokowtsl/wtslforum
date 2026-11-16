export interface DmoPointGestureEvent {
  frame: number;
  player: 1 | 2;
  type: string;
  style: number | null;
}

export function buildDmoPointGestureEvents(
  points: readonly {
    frame?: number;
    winner: 1 | 2 | null;
    rallyHits?: number;
    faults?: number;
    setNumber?: number;
    endedBy?: 'winner' | 'error' | null;
  }[] | null | undefined,
  options?: {
    characters?: readonly [string | null | undefined, string | null | undefined];
    matchOver?: boolean;
  },
): DmoPointGestureEvent[];

export function resolveDmoGesturePlayback(
  events: readonly DmoPointGestureEvent[],
  player: 1 | 2,
  frame: number,
  frameRate: number,
  clips: Readonly<Record<string, { duration: number }>> | undefined,
): { type: string; time: number; weight: number } | null;

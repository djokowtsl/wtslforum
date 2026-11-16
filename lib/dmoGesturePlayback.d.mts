export interface DmoPointGestureEvent {
  frame: number;
  player: 1 | 2;
  type: string;
  style: number | null;
  /** True when the player really made this gesture (read from the recording). */
  recorded?: boolean;
}

export function buildDmoPointGestureEvents(
  points: readonly {
    frame?: number;
    winner: 1 | 2 | null;
    rallyHits?: number;
    faults?: number;
    setNumber?: number;
    server?: 1 | 2;
    scoreLabel?: string;
    isTiebreak?: boolean;
    endedBy?: 'winner' | 'error' | null;
    recordedGestures?: readonly { player: 1 | 2; type: string; frame?: number }[];
  }[] | null | undefined,
  options?: {
    characters?: readonly [string | null | undefined, string | null | undefined];
    matchOver?: boolean;
    bestOf?: number | null;
  },
): DmoPointGestureEvent[];

export function resolveDmoGesturePlayback(
  events: readonly DmoPointGestureEvent[],
  player: 1 | 2,
  frame: number,
  frameRate: number,
  clips: Readonly<Record<string, { duration: number }>> | undefined,
): { type: string; time: number; weight: number } | null;

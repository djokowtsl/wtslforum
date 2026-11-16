export interface DmoPointGestureEvent {
  frame: number;
  player: 1 | 2;
  type: string;
  style: number | null;
  /** Which of the type's animations to play: this player's nth gesture of the type. */
  variant?: number;
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
  clips: Readonly<Record<string, { duration: number } | readonly { duration: number }[]>> | undefined,
): { type: string; variant: number; time: number; weight: number } | null;

export const DMO_GESTURE_DWELL_MAX_SECONDS: number;

export interface DmoGestureDwell {
  frame: number;
  seconds: number;
  gestures: { player: 1 | 2; type: string; variant: number; duration: number }[];
}

type GestureClips = Readonly<Record<string, { duration: number } | readonly { duration: number }[]>> | undefined;

export function findDmoGestureDwell(
  events: readonly DmoPointGestureEvent[],
  fromFrame: number,
  toFrame: number,
  clipsFor: (player: 1 | 2) => GestureClips,
): DmoGestureDwell | null;

export function dmoGestureDuringDwell(
  dwell: DmoGestureDwell | null | undefined,
  player: 1 | 2,
  time: number,
): { type: string; variant: number; time: number; weight: number } | null;

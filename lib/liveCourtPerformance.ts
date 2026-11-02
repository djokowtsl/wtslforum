export type Point3 = [number, number, number];
export type PlayerHandedness = 'left' | 'right';
export type StrokeHandCount = 'one' | 'two';
export type PlayerStrokeStyle = {
  forehand: StrokeHandCount;
  backhand: StrokeHandCount;
};
export type PlayerStrokeStylePair = [PlayerStrokeStyle, PlayerStrokeStyle];
export const RACKET_HEAD_OFFSET = 0.36;
export const TWO_HANDED_GRIP_SEPARATION = 0.13;
// The face points along local +Z: anatomical right is local -X.
export const RIGHT_HAND_X = -0.39;
export function dominantHandX(handedness: PlayerHandedness) {
  return handedness === 'right' ? RIGHT_HAND_X : -RIGHT_HAND_X;
}

export function defaultPlayerStrokeStyles(): PlayerStrokeStylePair {
  return [
    { forehand: 'one', backhand: 'two' },
    { forehand: 'one', backhand: 'two' },
  ];
}

export function groundstrokeForBallSide(
  localBallX: number,
  handedness: PlayerHandedness,
): 'forehand' | 'backhand' {
  return localBallX * dominantHandX(handedness) >= 0 ? 'forehand' : 'backhand';
}

export function secondHandGripPosition(grip: Point3, racketAxis: Point3): Point3 {
  return grip.map((value, index) =>
    value + racketAxis[index] * TWO_HANDED_GRIP_SEPARATION,
  ) as Point3;
}

export function racketContact(ball: Point3, preferredGrip: Point3) {
  const delta = ball.map((v, i) => v - preferredGrip[i]);
  const length = Math.hypot(...delta);
  const axis: Point3 = length > 0.0001
    ? delta.map(v => v / length) as Point3 : [0, 1, 0];
  return {
    axis,
    grip: ball.map((v, i) => v - axis[i] * RACKET_HEAD_OFFSET) as Point3,
  };
}

export function serveLift(offset: number) {
  return Math.max(0, 1 - Math.abs(offset) / 12) * 0.45;
}

export function crossedFrame(eventFrame: number, previous: number, current: number) {
  return current >= previous && eventFrame > previous && eventFrame <= current;
}

export function trailAllowed(events: {frame: number; kind: string}[], frame: number) {
  let low = 0;
  let high = events.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (events[middle].frame <= frame) low = middle + 1;
    else high = middle;
  }
  return low > 0 && events[low - 1].kind === 'shot';
}

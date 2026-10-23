export type LiveCourtCamera = { azimuth: number; elevation: number };
export type LiveCourtWorldPoint = [number, number, number];
export type LiveCourtProjectedPoint = [number, number, number, number];
export type LiveCourtRacketPlayer = { id: 1 | 2; x: number; y: number };
export type LiveCourtBall = { x: number; y: number; z: number };
export type LiveCourtShotEvent = { frame: number; kind: 'shot' | 'point-end' };

export const DEFAULT_LIVE_COURT_CAMERA: LiveCourtCamera = { azimuth: -42, elevation: 38 };

type Vector3 = LiveCourtWorldPoint;

export function playerRightVector(facing: LiveCourtWorldPoint): LiveCourtWorldPoint {
  return [facing[1], -facing[0], 0];
}

function dot(a: Vector3, b: Vector3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize(vector: Vector3): Vector3 {
  const length = Math.hypot(...vector) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function cross(a: Vector3, b: Vector3): Vector3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function createCourtProjector(camera: LiveCourtCamera, zoom = 1) {
  const azimuth = (Number.isFinite(camera.azimuth) ? camera.azimuth : DEFAULT_LIVE_COURT_CAMERA.azimuth) * Math.PI / 180;
  const elevation = Math.max(
    5,
    Math.min(90, Number.isFinite(camera.elevation) ? camera.elevation : DEFAULT_LIVE_COURT_CAMERA.elevation),
  ) * Math.PI / 180;
  const distance = 4_300;
  const target: Vector3 = [0, 0, 110];
  const eye: Vector3 = [
    target[0] + distance * Math.cos(elevation) * Math.cos(azimuth),
    target[1] + distance * Math.cos(elevation) * Math.sin(azimuth),
    target[2] + distance * Math.sin(elevation),
  ];
  const forward = normalize([target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]]);
  const right: Vector3 = [-Math.sin(azimuth), Math.cos(azimuth), 0];
  const up = normalize(cross(right, forward));
  const safeZoom = Math.max(0.7, Math.min(1.8, Number.isFinite(zoom) ? zoom : 1));
  const focalLength = 1_100 * safeZoom;

  return (point: LiveCourtWorldPoint): LiveCourtProjectedPoint => {
    const relative: Vector3 = [point[0] - eye[0], point[1] - eye[1], point[2] - eye[2]];
    const depth = Math.max(500, dot(relative, forward));
    const scale = focalLength / depth;
    return [
      450 + dot(relative, right) * scale,
      260 - dot(relative, up) * scale,
      scale,
      depth,
    ];
  };
}

export function projectCourtPoint(
  point: LiveCourtWorldPoint,
  camera: LiveCourtCamera,
  zoom = 1,
): LiveCourtProjectedPoint {
  return createCourtProjector(camera, zoom)(point);
}

export function findCourtRacketContact(
  ball: LiveCourtBall,
  players: LiveCourtRacketPlayer[],
  event: LiveCourtShotEvent | null,
  cursor: number,
): 1 | 2 | null {
  if (!event || event.kind !== 'shot' || Math.abs(cursor - event.frame) > 3) return null;
  const nearest = players
    .map((player) => ({
      id: player.id,
      distance: Math.hypot(ball.x - player.x, ball.y - player.y, ball.z - 105),
    }))
    .sort((a, b) => a.distance - b.distance)[0];
  if (!nearest || nearest.distance > 250) return null;
  return nearest.id;
}

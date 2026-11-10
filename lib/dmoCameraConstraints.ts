/** Minimum camera clearance over the flat court surface, in metres. */
export const MIN_DMO_CAMERA_HEIGHT = 0.8;
export const DMO_CAMERA_PAN_LIMIT = 7;
export const DMO_CAMERA_VERTICAL_PAN_LIMIT = 4;

type DmoCameraPoint = { x: number; y: number; z: number };

/** Preserve the embedded mobile view; fit fullscreen court framing to its viewport. */
export function responsiveDmoCourtCameraScale(width: number, height: number, fullscreenActive: boolean) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || width > 720) return 1;
  if (!fullscreenActive) return 1.22;
  const aspect = Math.max(0.25, width / height);
  const aspectScale = Math.sqrt((16 / 9) / aspect);
  return Math.min(2.2, Math.max(1.22, 1.22 * aspectScale));
}

export type DmoFullscreenCourtCamera = { x: number; y: number; z: number; fov: number };

/** Rotate and elevate compact fullscreen views so the full court fits either orientation. */
export function dmoFullscreenCourtCamera(
  width: number,
  height: number,
  fullscreenActive: boolean,
  maxDistance = Infinity,
): DmoFullscreenCourtCamera | null {
  if (
    !fullscreenActive
    || !Number.isFinite(width)
    || !Number.isFinite(height)
    || width <= 0
    || height <= 0
  ) {
    return null;
  }
  // Court length follows X: view from its baseline in portrait and its sideline in landscape.
  const aspect = width / height;
  const position = width <= 720 && aspect < 0.8
    ? { x: 5, y: 28, z: 0 }
    : width <= 1200 && height <= 720 && aspect >= 1
      ? { x: 0, y: 28.6, z: 13 }
      : null;
  if (!position) return null;

  // OrbitControls enforces this limit. Fit at the distance it will actually use.
  const initialDistance = Math.hypot(position.x, position.y - 0.5, position.z);
  const scale = Number.isFinite(maxDistance) && maxDistance > 0
    ? Math.min(1, maxDistance / initialDistance)
    : 1;
  const x = position.x * scale;
  const y = 0.5 + (position.y - 0.5) * scale;
  const z = position.z * scale;
  const distance = initialDistance * scale;
  const horizontal = Math.hypot(x, z);
  const headingX = x / horizontal;
  const headingZ = z / horizontal;
  const elevationSin = (y - 0.5) / distance;
  const elevationCos = horizontal / distance;
  let requiredTan = 0;
  // Include space behind the baselines and doubles sidelines for the players.
  for (const courtX of [-13.4, 13.4]) {
    for (const courtZ of [-6.24, 6.24]) {
      const along = courtX * headingX + courtZ * headingZ;
      const side = courtX * headingZ - courtZ * headingX;
      const depth = distance - along * elevationCos + 0.5 * elevationSin;
      const up = -along * elevationSin - 0.5 * elevationCos;
      requiredTan = Math.max(requiredTan, Math.abs(up) / depth, Math.abs(side) / (depth * aspect));
    }
  }
  // Keep a small margin, accounting for perspective at every corner, not just the centre.
  return { x, y, z, fov: 2 * Math.atan(requiredTan / 0.94) * 180 / Math.PI };
}

/** Keep manual panning anchored to the selected court or player view. */
export function clampDmoCameraTarget(
  target: DmoCameraPoint,
  anchor: DmoCameraPoint,
  horizontalLimit = DMO_CAMERA_PAN_LIMIT,
  verticalLimit = DMO_CAMERA_VERTICAL_PAN_LIMIT,
): DmoCameraPoint {
  return {
    x: Math.max(anchor.x - horizontalLimit, Math.min(anchor.x + horizontalLimit, target.x)),
    y: Math.max(anchor.y - verticalLimit, Math.min(anchor.y + verticalLimit, target.y)),
    z: Math.max(anchor.z - horizontalLimit, Math.min(anchor.z + horizontalLimit, target.z)),
  };
}

/** Keep an orbit, including bounded pan, within the venue's seating radius. */
export function dmoCameraMaxDistanceInsideBowl(
  target: DmoCameraPoint,
  interiorRadius: number,
  panLimit: number,
  preferredMaxDistance: number,
) {
  const targetRadius = Math.hypot(target.x, target.z);
  const panRadius = Math.SQRT2 * Math.max(0, panLimit);
  const availableDistance = Math.max(0, interiorRadius - targetRadius - panRadius);
  return Math.min(Math.max(0, preferredMaxDistance), availableDistance);
}

/**
 * OrbitControls pans its camera and target together. Lift both by the same
 * amount to keep the target above the court and the camera above the floor.
 */
export function dmoCameraFloorLift(cameraY: number, targetY: number) {
  return Math.max(0, -targetY, MIN_DMO_CAMERA_HEIGHT - cameraY);
}

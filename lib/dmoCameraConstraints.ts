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
  const aspect = width / height;
  if (width <= 720 && aspect < 0.8) return { x: 0, y: 22, z: 18, fov: 60 };
  if (width <= 1200 && height <= 600 && aspect >= 1.9) {
    return { x: 13, y: 28.6, z: 0, fov: 22 };
  }
  return null;
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

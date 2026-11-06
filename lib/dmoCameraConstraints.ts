/** Minimum camera clearance over the flat court surface, in metres. */
export const MIN_DMO_CAMERA_HEIGHT = 0.8;

/**
 * OrbitControls pans its camera and target together. Lift both by the same
 * amount to keep the target above the court and the camera above the floor.
 */
export function dmoCameraFloorLift(cameraY: number, targetY: number) {
  return Math.max(0, -targetY, MIN_DMO_CAMERA_HEIGHT - cameraY);
}

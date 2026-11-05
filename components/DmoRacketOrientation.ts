import * as THREE from 'three';

/** Wrist-to-knuckles is +Y; the handle crosses the palm from pinky to index. */
export const HAND_GRIP_CENTER = new THREE.Vector3(0, 0.075, -0.035);
export const HAND_GRIP_SHAFT = new THREE.Vector3(-0.94, 0.34, 0).normalize();

/** Seat the handle across the palm, not parallel to outstretched fingers. */
export function racketHandFrame(rotation: THREE.Quaternion, left: boolean) {
  const across = Math.atan2(0.94, 0.34);
  return rotation.clone()
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), left ? -across : across))
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
}

/** Place the wrist behind the palm while the shaft crosses the closed fingers. */
export function racketGripWrist(grip: THREE.Vector3, rotation: THREE.Quaternion, left: boolean) {
  const hand = racketHandFrame(rotation, left);
  const centre = HAND_GRIP_CENTER.clone();
  if (left) centre.x *= -1;
  return grip.clone().sub(centre.applyQuaternion(hand));
}

/** Bend the whole arm toward the grip, rather than kinking only the wrist. */
export function racketGripElbow(
  shoulder: THREE.Vector3, wrist: THREE.Vector3, rotation: THREE.Quaternion, left: boolean,
) {
  const upperLength = 0.31, lowerLength = 0.29;
  const direction = wrist.clone().sub(shoulder);
  const distance = direction.length();
  if (distance < 1e-6) return shoulder.clone().add(new THREE.Vector3(0, -upperLength, 0));
  direction.divideScalar(distance);
  const along = THREE.MathUtils.clamp(
    (distance * distance + upperLength ** 2 - lowerLength ** 2) / (2 * distance), 0, distance,
  );
  const centre = shoulder.clone().addScaledVector(direction, along);
  const forward = new THREE.Vector3(0, 1, 0).applyQuaternion(racketHandFrame(rotation, left));
  const bend = wrist.clone().addScaledVector(forward, -lowerLength).sub(centre);
  bend.addScaledVector(direction, -bend.dot(direction));
  if (bend.lengthSq() < 1e-8) {
    bend.set(0, 0, 1).addScaledVector(direction, -direction.z);
    if (bend.lengthSq() < 1e-8) bend.set(1, 0, 0);
  }
  return centre.addScaledVector(bend.normalize(), Math.sqrt(Math.max(0, upperLength ** 2 - along ** 2)));
}

/**
 * The racket shaft is local +Y and its string-bed normal is local +Z.
 * Shaft alignment alone leaves the face's roll unconstrained. Resolve that
 * roll from the recorded ball flight, without changing the grip/hoop axis.
 * This is a reconstructed orientation cue, not recorded wrist animation.
 */
export function racketContactOrientation(
  shaftAxis: THREE.Vector3,
  ballFlight: THREE.Vector3,
): THREE.Quaternion {
  const shaft = shaftAxis.clone();
  if (shaft.lengthSq() < 1e-8 || !shaft.toArray().every(Number.isFinite)) shaft.set(0, 1, 0);
  shaft.normalize();
  const normal = ballFlight.clone();
  if (!normal.toArray().every(Number.isFinite)) normal.set(0, 0, 1);
  normal.addScaledVector(shaft, -normal.dot(shaft));
  if (normal.lengthSq() < 1e-8) {
    normal.set(0, 0, 1).addScaledVector(shaft, -shaft.z);
    if (normal.lengthSq() < 1e-8) normal.set(1, 0, 0).addScaledVector(shaft, -shaft.x);
  }
  normal.normalize();
  const across = new THREE.Vector3().crossVectors(shaft, normal).normalize();
  normal.crossVectors(across, shaft).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(across, shaft, normal),
  );
}

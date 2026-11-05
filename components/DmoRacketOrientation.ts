import * as THREE from 'three';

/** Native hand +Y runs wrist-to-fingers, NOT along the racket shaft. */
export function racketHandFrame(rotation: THREE.Quaternion, left: boolean) {
  return rotation.clone().multiply(new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 0, 1), left ? -Math.PI / 2 : Math.PI / 2,
  ));
}

/** Rest the handle across the open palm's exterior, never through its centre. */
export function racketGripWrist(grip: THREE.Vector3, rotation: THREE.Quaternion, left: boolean) {
  const hand = racketHandFrame(rotation, left);
  return grip.clone().sub(new THREE.Vector3(0, 0.075, -0.035).applyQuaternion(hand));
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

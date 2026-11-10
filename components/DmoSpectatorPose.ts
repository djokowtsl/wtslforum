import * as THREE from 'three';

const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
function bone(model: THREE.Object3D, name: string) {
  const found = model.getObjectByName(name);
  if (!found) throw new Error(`Spectator model is missing ${name}.`);
  return found;
}
function position(object: THREE.Object3D) {
  object.updateWorldMatrix(true, false);
  return object.getWorldPosition(v());
}
function setWorldQuaternion(object: THREE.Object3D, world: THREE.Quaternion) {
  object.quaternion.copy(object.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world));
  object.updateWorldMatrix(false, true);
}
function aim(model: THREE.Object3D, name: string, childName: string, target: THREE.Vector3) {
  const object = bone(model, name);
  const origin = position(object);
  const from = position(bone(model, childName)).sub(origin).normalize();
  const to = target.clone().sub(origin).normalize();
  const delta = new THREE.Quaternion().setFromUnitVectors(from, to);
  setWorldQuaternion(object, delta.multiply(object.getWorldQuaternion(new THREE.Quaternion())));
}
function solveArm(model: THREE.Object3D, prefix: string, target: THREE.Vector3, hint: THREE.Vector3) {
  const root = position(bone(model, `${prefix}Arm`));
  const elbow = position(bone(model, `${prefix}ForeArm`));
  const wrist = position(bone(model, `${prefix}Hand`));
  const upper = root.distanceTo(elbow), lower = elbow.distanceTo(wrist);
  const axis = target.clone().sub(root);
  const distance = axis.length();
  if (distance >= upper + lower) throw new Error('Spectator hand target cannot be reached without stretching.');
  axis.normalize();
  const along = (upper ** 2 - lower ** 2 + distance ** 2) / (2 * distance);
  const out = hint.clone().sub(root);
  out.addScaledVector(axis, -out.dot(axis)).normalize();
  const solvedElbow = root.clone().addScaledVector(axis, along)
    .addScaledVector(out, Math.sqrt(Math.max(0, upper ** 2 - along ** 2)));
  aim(model, `${prefix}Arm`, `${prefix}ForeArm`, solvedElbow);
  aim(model, `${prefix}ForeArm`, `${prefix}Hand`, target);
}
function orientHand(
  model: THREE.Object3D,
  prefix: string,
  direction: THREE.Vector3,
  thumbSide: THREE.Vector3,
) {
  const forearm = bone(model, `${prefix}ForeArm`);
  const hand = bone(model, `${prefix}Hand`);
  const armAxis = position(hand).sub(position(forearm)).normalize();
  const initialForward = position(bone(model, `${prefix}HandMiddle1`)).sub(position(hand)).normalize();
  const initialWidth = position(bone(model, `${prefix}HandIndex1`))
    .sub(position(bone(model, `${prefix}HandPinky1`)));
  initialWidth.addScaledVector(initialForward, -initialWidth.dot(initialForward)).normalize();
  direction.normalize();
  thumbSide.addScaledVector(direction, -thumbSide.dot(direction)).normalize();
  const currentNormal = initialForward.clone().cross(initialWidth);
  const desiredNormal = direction.clone().cross(thumbSide);
  currentNormal.addScaledVector(armAxis, -currentNormal.dot(armAxis)).normalize();
  desiredNormal.addScaledVector(armAxis, -desiredNormal.dot(armAxis)).normalize();
  const angle = Math.atan2(armAxis.dot(currentNormal.clone().cross(desiredNormal)), currentNormal.dot(desiredNormal));
  // These source rigs have no forearm-twist helpers. Share a large turn with
  // the VALID wrist rather than collapsing its exposed elbow into a twisted
  // ribbon. The final hand frame below still supplies the exact palm target.
  const share = model.userData.spectatorIdentity?.startsWith('valid-') ? 0.5 : 1;
  setWorldQuaternion(forearm, new THREE.Quaternion().setFromAxisAngle(armAxis, angle * share)
    .multiply(forearm.getWorldQuaternion(new THREE.Quaternion())));
  const origin = position(hand);
  const forward = position(bone(model, `${prefix}HandMiddle1`)).sub(origin).normalize();
  const width = position(bone(model, `${prefix}HandIndex1`))
    .sub(position(bone(model, `${prefix}HandPinky1`)));
  width.addScaledVector(forward, -width.dot(forward)).normalize();
  const source = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
    width, forward.clone().cross(width).normalize(), forward,
  ));
  const target = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
    thumbSide, direction.clone().cross(thumbSide).normalize(), direction,
  ));
  setWorldQuaternion(hand, target.multiply(source.invert())
    .multiply(hand.getWorldQuaternion(new THREE.Quaternion())));
}

/** Leaf finger joints have no child bone to aim. Measure their authored distal
 * skin in bind-local coordinates, instead of leaving the curled fingertip pose
 * untouched just because the visible bone chain ends at joint three. */
function nativeFingerTipAxes(model: THREE.Group) {
  const sums = new Map<string, THREE.Vector3>();
  model.traverse(object => {
    if (!(object instanceof THREE.SkinnedMesh)) return;
    const positions = object.geometry.getAttribute('position');
    const joints = object.geometry.getAttribute('skinIndex');
    const weights = object.geometry.getAttribute('skinWeight');
    const point = v();
    const relevant = object.skeleton.bones.map(joint => /Hand(?:Thumb|Index|Middle|Ring|Pinky)3$/.test(joint.name));
    for (let i = 0; i < positions.count; i++) for (let c = 0; c < 4; c++) {
      const index = joints.getComponent(i, c), weight = weights.getComponent(i, c);
      if (!relevant[index] || weight < 0.5) continue;
      const name = object.skeleton.bones[index].name;
      const sum = sums.get(name) ?? v();
      point.fromBufferAttribute(positions, i).applyMatrix4(object.bindMatrix)
        .applyMatrix4(object.skeleton.boneInverses[index]);
      sum.addScaledVector(point, weight);
      sums.set(name, sum);
    }
  });
  for (const axis of sums.values()) axis.normalize();
  return sums;
}

function relaxFingerTip(model: THREE.Group, name: string, direction: THREE.Vector3, axes: Map<string, THREE.Vector3>) {
  const local = axes.get(name);
  if (!local || local.lengthSq() < 0.9) return;
  const joint = bone(model, name);
  joint.updateWorldMatrix(true, false);
  const current = local.clone().transformDirection(joint.matrixWorld);
  const delta = new THREE.Quaternion().setFromUnitVectors(current, direction.clone().normalize());
  setWorldQuaternion(joint, delta.multiply(joint.getWorldQuaternion(new THREE.Quaternion())));
}

/** Pose a fresh clone of the approved whole-body model. Never scale a bone or
 * rewrite the original skin: its authored fingers and wrist joins stay intact. */
export function poseSpectator(model: THREE.Group, applause: 'rest' | 'open' | 'closed', look = 0) {
  model.updateMatrixWorld(true);
  const tipAxes = applause === 'rest' ? nativeFingerTipAxes(model) : new Map<string, THREE.Vector3>();
  const ground = new THREE.Box3().setFromObject(model).min.y;
  const prefixes = ['Left', 'Right'];
  const offsets = prefixes.map(prefix => position(bone(model, `${prefix}Foot`)).y - ground);
  const footRotations = prefixes.map(prefix => bone(model, `${prefix}Foot`).getWorldQuaternion(new THREE.Quaternion()));
  model.position.y += 0.53 - position(bone(model, 'Hips')).y;
  model.updateMatrixWorld(true);
  for (const [index, prefix] of prefixes.entries()) {
    const side = index === 0 ? 1 : -1;
    const hip = position(bone(model, `${prefix}UpLeg`));
    const knee = position(bone(model, `${prefix}Leg`));
    const ankle = position(bone(model, `${prefix}Foot`));
    const thighLength = hip.distanceTo(knee), shinLength = knee.distanceTo(ankle);
    const kneeY = offsets[index] + shinLength;
    const kneeZ = hip.z + Math.sqrt(thighLength ** 2 - (hip.y - kneeY) ** 2);
    aim(model, `${prefix}UpLeg`, `${prefix}Leg`, v(hip.x, kneeY, kneeZ));
    const posedKnee = position(bone(model, `${prefix}Leg`));
    aim(model, `${prefix}Leg`, `${prefix}Foot`, v(posedKnee.x, offsets[index], posedKnee.z));
    setWorldQuaternion(bone(model, `${prefix}Foot`), footRotations[index]);
    const wrist = applause === 'rest'
      ? v(hip.x + side * 0.015, 0.65, 0.26)
      : v(side * (applause === 'open' ? 0.085 : 0.045), 0.98, 0.35);
    solveArm(model, prefix, wrist, v(side * 0.37, 0.77, 0.10));
    orientHand(
      model,
      prefix,
      applause === 'rest' ? v(0, -0.03, 1) : v(0, 1, 0.08),
      applause === 'rest' ? v(-side, 0, 0) : v(0, 0, -1),
    );
    if (applause === 'rest') {
      // Relax the source's gripping curl at the individual knuckles, retaining
      // a little lateral finger spread and only a small, natural downward bend.
      for (const finger of ['Index', 'Middle', 'Ring', 'Pinky']) {
        const first = `${prefix}Hand${finger}1`;
        const second = `${prefix}Hand${finger}2`;
        const third = `${prefix}Hand${finger}3`;
        const sourceDirection = position(bone(model, second)).sub(position(bone(model, first)));
        const spread = THREE.MathUtils.clamp(sourceDirection.x / Math.max(0.001, Math.abs(sourceDirection.z)), -0.12, 0.12);
        aim(model, first, second, position(bone(model, first)).add(v(spread, -0.035, 1)));
        aim(model, second, third, position(bone(model, second)).add(v(spread, -0.07, 1)));
        const fourth = `${prefix}Hand${finger}4`;
        if (model.getObjectByName(fourth)) {
          aim(model, third, fourth, position(bone(model, third)).add(v(spread, -0.10, 1)));
        } else relaxFingerTip(model, third, v(spread, -0.10, 1), tipAxes);
      }
      // Keep a small natural splay at the thumb base. The remaining thumb
      // segments run forward in the same plane as the four resting fingers.
      const thumbForward = v(side * 0.08, -0.05, 1);
      for (const [joint, child, direction] of [
        ['Thumb1', 'Thumb2', v(-side * 0.52, -0.04, 0.86)],
        ['Thumb2', 'Thumb3', thumbForward],
      ] as const) {
        const name = `${prefix}Hand${joint}`;
        aim(model, name, `${prefix}Hand${child}`,
          position(bone(model, name)).add(direction));
      }
      const thumbFourth = `${prefix}HandThumb4`;
      if (model.getObjectByName(thumbFourth)) {
        const thumbThird = `${prefix}HandThumb3`;
        aim(model, thumbThird, thumbFourth, position(bone(model, thumbThird)).add(thumbForward));
      } else relaxFingerTip(model, `${prefix}HandThumb3`, thumbForward, tipAxes);
    }
  }
  const head = bone(model, 'Head');
  setWorldQuaternion(head, new THREE.Quaternion().setFromAxisAngle(v(0, 1), look)
    .multiply(head.getWorldQuaternion(new THREE.Quaternion())));
  model.updateMatrixWorld(true);
}

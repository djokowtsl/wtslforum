import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { PlayerRig } from './DmoLiveCourt3DScene';
import { racketContactOrientation } from './DmoRacketOrientation';
import { makeNativeGrip } from './DmoNativeGrip';
import { dressNativePlayer } from './DmoNativeKit';

const UP = new THREE.Vector3(0, 1, 0);
const BODY_SCALE = 1.075;
function ends(mesh: THREE.Mesh) {
  const half = UP.clone().applyQuaternion(mesh.quaternion).multiplyScalar(mesh.scale.y / 2);
  return [mesh.position.clone().sub(half), mesh.position.clone().add(half)];
}

/** Native offsets never change: each segment rotates about its own joint. */
export class NativePlayerPose {
  readonly bones = new Map<string, THREE.Bone>();
  readonly rest = new Map<string, { rotation: THREE.Quaternion; direction: THREE.Vector3; local: THREE.Quaternion }>();
  constructor(readonly model: THREE.Group, readonly space: THREE.Group) {
    model.updateMatrixWorld(true);
    const inverse = space.getWorldQuaternion(new THREE.Quaternion()).invert();
    model.traverse(o => { if (o instanceof THREE.Bone) this.bones.set(o.name, o); });
    this.bones.forEach((bone, name) => {
      const child = name === 'spine_03' ? this.bones.get('neck_01') : name.startsWith('hand_')
        ? this.bones.get(`middle_01_${name.endsWith('_l') ? 'l' : 'r'}`)
        : bone.children.find(o => o instanceof THREE.Bone);
      const direction = child
        ? child.getWorldPosition(new THREE.Vector3()).sub(bone.getWorldPosition(new THREE.Vector3())).normalize().applyQuaternion(inverse)
        : UP.clone();
      this.rest.set(name, { rotation: inverse.clone().multiply(bone.getWorldQuaternion(new THREE.Quaternion())),
        direction, local: bone.quaternion.clone() });
    });
    for (const name of ['pelvis', 'spine_03', 'head', 'hand_l', 'hand_r', 'middle_01_l', 'middle_01_r']) {
      if (!this.bones.has(name)) throw new Error(`Missing continuous player joint: ${name}`);
    }
  }
  point(name: string) {
    const bone = this.bones.get(name)!;
    bone.updateWorldMatrix(true, false);
    return this.space.worldToLocal(bone.getWorldPosition(new THREE.Vector3()));
  }
  orient(name: string, orientation: THREE.Quaternion) {
    const bone = this.bones.get(name)!;
    bone.parent!.updateWorldMatrix(true, false);
    const world = this.space.getWorldQuaternion(new THREE.Quaternion()).multiply(orientation);
    bone.quaternion.copy(bone.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world));
    bone.updateMatrixWorld(true);
  }
  aim(name: string, target: THREE.Vector3, roll?: THREE.Quaternion) {
    const rest = this.rest.get(name)!;
    const direction = target.clone().sub(this.point(name));
    if (direction.lengthSq() < 1e-10) return;
    direction.normalize();
    const orientation = new THREE.Quaternion().setFromUnitVectors(rest.direction, direction).multiply(rest.rotation);
    if (roll) {
      const residual = roll.clone().multiply(orientation.clone().invert());
      const projection = new THREE.Vector3(residual.x, residual.y, residual.z).dot(direction);
      const twist = new THREE.Quaternion(direction.x * projection, direction.y * projection, direction.z * projection, residual.w);
      if (twist.lengthSq() > 1e-10) orientation.premultiply(twist.normalize());
    }
    this.orient(name, orientation);
  }
  finish() {
    this.model.updateMatrixWorld(true);
    this.model.traverse(o => { if (o instanceof THREE.SkinnedMesh) o.skeleton.update(); });
  }
}

export function nativeTwoBone(
  shoulder: THREE.Vector3, target: THREE.Vector3, upper: number, lower: number, preference: THREE.Vector3,
) {
  const axis = target.clone().sub(shoulder);
  let distance = axis.length();
  if (distance < 1e-8) { axis.set(0, -1, 0); distance = 1e-8; } else axis.divideScalar(distance);
  distance = THREE.MathUtils.clamp(distance, Math.abs(upper - lower) + 1e-5, upper + lower - 1e-5);
  const wrist = shoulder.clone().addScaledVector(axis, distance);
  const along = (distance ** 2 + upper ** 2 - lower ** 2) / (2 * distance);
  const centre = shoulder.clone().addScaledVector(axis, along);
  const bend = preference.clone().sub(centre);
  bend.addScaledVector(axis, -bend.dot(axis));
  if (bend.lengthSq() < 1e-8) {
    bend.set(0, 0, 1).addScaledVector(axis, -axis.z);
    if (bend.lengthSq() < 1e-8) bend.set(1, 0, 0);
  }
  const elbow = centre.addScaledVector(bend.normalize(), Math.sqrt(Math.max(0, upper ** 2 - along ** 2)));
  return { elbow, wrist };
}

export function attachNativePlayer(template: THREE.Group, rig: PlayerRig, shirtColor: number) {
  const model = clone(template) as THREE.Group;
  model.name = 'wtsl-continuous-player';
  dressNativePlayer(model, shirtColor, template.userData.gender === 'female');
  model.scale.multiplyScalar(BODY_SCALE);
  const original = [...rig.root.children];
  rig.root.add(model);
  original.forEach(child => {
    if (![rig.racket, rig.leftShoe, rig.rightShoe].includes(child as THREE.Group)) child.visible = false;
  });
  for (const shoe of [rig.leftShoe, rig.rightShoe]) {
    const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.043, 0.046, 0.11, 16),
      new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.9 }));
    sock.name = 'tennis-sock'; sock.position.set(0, 0.075, -0.04); shoe.add(sock);
  }
  const pose = new NativePlayerPose(model, rig.root);
  const grips = { l: makeNativeGrip(pose.bones, 'l'), r: makeNativeGrip(pose.bones, 'r') };
  const armLengths = Object.fromEntries((['l', 'r'] as const).map(side => [side, [
    pose.point(`upperarm_${side}`).distanceTo(pose.point(`lowerarm_${side}`)),
    pose.point(`lowerarm_${side}`).distanceTo(pose.point(`hand_${side}`)),
  ]])) as Record<'l' | 'r', number[]>;
  const legLengths = Object.fromEntries((['l', 'r'] as const).map(side => [side, [
    pose.point(`thigh_${side}`).distanceTo(pose.point(`calf_${side}`)),
    pose.point(`calf_${side}`).distanceTo(pose.point(`foot_${side}`)),
  ]])) as Record<'l' | 'r', number[]>;
  const localRacket = { l: racketContactOrientation(grips.l.shaft, grips.l.palm),
    r: racketContactOrientation(grips.r.shaft, grips.r.palm) };
  const update = () => {
    const delta = rig.hip.position.clone().sub(pose.point('pelvis'));
    model.position.add(delta);
    pose.orient('pelvis', rig.hip.quaternion.clone().multiply(pose.rest.get('pelvis')!.rotation));
    const neck = rig.head.position.clone().add(new THREE.Vector3(0, -0.23, 0));
    const trunk = neck.clone().sub(pose.point('pelvis'));
    trunk.y = Math.max(0.2, trunk.y);
    trunk.normalize();
    for (const name of ['spine_01', 'spine_02', 'spine_03']) {
      pose.aim(name, pose.point(name).add(trunk),
        rig.body.quaternion.clone().multiply(pose.rest.get(name)!.rotation));
    }
    const neckPosition = pose.point('neck_01');
    const headDirection = rig.head.position.clone().sub(neckPosition);
    headDirection.y = Math.max(0.08, headDirection.y);
    pose.aim('neck_01', neckPosition.add(headDirection));
    pose.orient('head', rig.head.quaternion.clone().multiply(pose.rest.get('head')!.rotation));
    const dominant = rig.root.userData.dominantHandedness === 'left' ? 'l' : 'r';
    const sides = [dominant, dominant === 'l' ? 'r' : 'l'] as const;
    for (const side of sides) {
      const left = side === 'l', primary = side === dominant;
      const arm = left ? rig.leftArm : rig.rightArm;
      const forearm = left ? rig.leftForearm : rig.rightForearm;
      const [shoulderHint, elbowHint] = ends(arm);
      const [, relaxedWrist] = ends(forearm);
      pose.aim(`clavicle_${side}`, shoulderHint);
      const shoulder = pose.point(`upperarm_${side}`);
      const holding = primary || Boolean(rig.root.userData.twoHandedGrip);
      const grip = grips[side];
      grip.setClosed(holding);
      let orientation: THREE.Quaternion | undefined;
      let target = relaxedWrist, preference = elbowHint;
      if (holding) {
        const racketRotation = rig.racket.quaternion.clone();
        if (!primary) racketRotation.multiply(new THREE.Quaternion().setFromAxisAngle(UP, Math.PI));
        orientation = racketRotation.multiply(localRacket[side].clone().invert());
        const centre = rig.racket.position.clone();
        if (!primary) centre.add(new THREE.Vector3(0, 0.11, 0).applyQuaternion(rig.racket.quaternion));
        target = centre.sub(grip.centre.clone().multiplyScalar(BODY_SCALE).applyQuaternion(orientation));
        preference = target.clone().addScaledVector(grip.forward.clone().applyQuaternion(orientation), -armLengths[side][1]);
      }
      const solved = nativeTwoBone(shoulder, target, armLengths[side][0], armLengths[side][1], preference);
      pose.aim(`upperarm_${side}`, solved.elbow);
      const lowerRoll = orientation?.clone().multiply(pose.rest.get(`hand_${side}`)!.local.clone().invert());
      pose.aim(`lowerarm_${side}`, solved.wrist, lowerRoll);
      if (orientation) pose.orient(`hand_${side}`, orientation);
      else {
        const lower = pose.bones.get(`lowerarm_${side}`)!;
        const local = rig.root.getWorldQuaternion(new THREE.Quaternion()).invert()
          .multiply(lower.getWorldQuaternion(new THREE.Quaternion()))
          .multiply(pose.rest.get(`hand_${side}`)!.local);
        pose.orient(`hand_${side}`, local);
      }
      if (primary) rig.racket.position.copy(pose.point(`hand_${side}`))
        .add(grip.centre.clone().multiplyScalar(BODY_SCALE).applyQuaternion(orientation!));
    }
    for (const side of ['l', 'r'] as const) {
      // Legacy legs use screen-space labels, opposite anatomical asset labels.
      const thigh = side === 'l' ? rig.rightLeg : rig.leftLeg;
      const calf = side === 'l' ? rig.rightCalf : rig.leftCalf;
      const [, knee] = ends(thigh), [, ankle] = ends(calf);
      const solved = nativeTwoBone(pose.point(`thigh_${side}`), ankle, legLengths[side][0], legLengths[side][1], knee);
      pose.aim(`thigh_${side}`, solved.elbow);
      pose.aim(`calf_${side}`, solved.wrist);
      pose.orient(`foot_${side}`, pose.rest.get(`foot_${side}`)!.rotation);
    }
    pose.finish();
  };
  rig.detailed = { update };
  return { model, pose, grips, update };
}

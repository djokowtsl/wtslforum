import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { PlayerRig } from './DmoLiveCourt3DScene';
import { racketContactOrientation } from './DmoRacketOrientation';
import { makeNativeGrip } from './DmoNativeGrip';
import {
  addNativePlayerAccessories,
  BROADCAST_PLAYER_KITS,
  dressNativePlayer,
  type NativePlayerKit,
} from './DmoNativeKit';
import { addNativeTwistBones, distributeNativeTwist, twistAngle } from './DmoNativeTwist';
import {
  DmoCapturedGroundstroke,
  recordedBackhandFaceRoll,
  type GroundstrokeMotionSources,
  type GroundstrokePlayback,
} from './DmoCapturedGroundstroke';
import { DmoCapturedLocomotion } from './DmoCapturedLocomotion';

const UP = new THREE.Vector3(0, 1, 0);
const BODY_SCALE = 1.075;
/** String-bed centre along the racket's local +Y (see makePlayer's racket). */
const RACKET_HEAD = new THREE.Vector3(0, 0.36, 0);
/** Bounded head turn toward the ball, eased per player update. */
const HEAD_YAW_LIMIT = 1.25;
const HEAD_TURN_STEP = 0.15;
/** Anatomical wrist limits relative to a neutral, in-line hand. */
const WRIST_SWING_LIMIT = 1.05;
const FOREARM_ROLL_LIMIT = 1.65;
const ELBOW_FLEX_RANGE = [0.06, 2.45] as const;

export function serveTossTuckWeight(frameDelta: number, captureWeight: number) {
  return THREE.MathUtils.clamp(captureWeight, 0, 1)
    * THREE.MathUtils.smoothstep(frameDelta, -10, -1)
    * (1 - THREE.MathUtils.smoothstep(frameDelta, 44, 62));
}

function ends(mesh: THREE.Mesh) {
  const half = UP.clone().applyQuaternion(mesh.quaternion).multiplyScalar(mesh.scale.y / 2);
  return [mesh.position.clone().sub(half), mesh.position.clone().add(half)];
}

/** Rotation taking orthonormal frame (a1, b1) onto (a2, b2). */
function frameRotation(a1: THREE.Vector3, b1: THREE.Vector3, a2: THREE.Vector3, b2: THREE.Vector3) {
  const m1 = new THREE.Matrix4().makeBasis(a1, b1, a1.clone().cross(b1));
  const m2 = new THREE.Matrix4().makeBasis(a2, b2, a2.clone().cross(b2));
  return new THREE.Quaternion().setFromRotationMatrix(m2.multiply(m1.transpose()));
}

/** Interpolate between orientations along either arc around the sphere. */
function slerpPath(a: THREE.Quaternion, b: THREE.Quaternion, t: number, long: boolean) {
  const delta = a.clone().invert().multiply(b);
  if ((delta.w < 0) !== long) delta.set(-delta.x, -delta.y, -delta.z, -delta.w);
  const angle = 2 * Math.acos(THREE.MathUtils.clamp(delta.w, -1, 1));
  const sine = Math.sqrt(Math.max(0, 1 - delta.w * delta.w));
  if (sine < 1e-6) return a.clone();
  const axis = new THREE.Vector3(delta.x / sine, delta.y / sine, delta.z / sine);
  return a.clone().multiply(new THREE.Quaternion().setFromAxisAngle(axis, angle * t));
}

/** Keep only a quarter of the contact correction's trunk bend. */
const SPINE_BEND_SHARE = 0.25;
const TRUNK_LEAN_LIMIT = THREE.MathUtils.degToRad(24);

function clampRotation(q: THREE.Quaternion, limit: number) {
  const angle = 2 * Math.acos(THREE.MathUtils.clamp(Math.abs(q.w), -1, 1));
  if (angle <= limit) return q;
  return new THREE.Quaternion().slerp(q.w < 0 ? new THREE.Quaternion(-q.x, -q.y, -q.z, -q.w) : q, limit / angle);
}

/** Native offsets never change: each segment rotates about its own joint. */
export class NativePlayerPose {
  readonly bones = new Map<string, THREE.Bone>();
  readonly rest = new Map<string, {
    position: THREE.Vector3;
    rotation: THREE.Quaternion;
    direction: THREE.Vector3;
    local: THREE.Quaternion;
  }>();
  constructor(readonly model: THREE.Group, readonly space: THREE.Group) {
    model.updateMatrixWorld(true);
    const inverse = space.getWorldQuaternion(new THREE.Quaternion()).invert();
    model.traverse(o => { if (o instanceof THREE.Bone) this.bones.set(o.name, o); });
    this.bones.forEach((bone, name) => {
      const child = name === 'spine_03' ? this.bones.get('neck_01') : name.startsWith('hand_')
        ? this.bones.get(`middle_01_${name.endsWith('_l') ? 'l' : 'r'}`)
        : bone.children.find(o => o instanceof THREE.Bone && !o.name.includes('_twist_'));
      const direction = child
        ? child.getWorldPosition(new THREE.Vector3()).sub(bone.getWorldPosition(new THREE.Vector3())).normalize().applyQuaternion(inverse)
        : UP.clone();
      this.rest.set(name, { position: bone.position.clone(),
        rotation: inverse.clone().multiply(bone.getWorldQuaternion(new THREE.Quaternion())),
        direction, local: bone.quaternion.clone() });
    });
    for (const name of ['pelvis', 'spine_03', 'head', 'hand_l', 'hand_r', 'middle_01_l', 'middle_01_r']) {
      if (!this.bones.has(name)) throw new Error(`Missing continuous player joint: ${name}`);
    }
  }
  reset() {
    this.rest.forEach((rest, name) => {
      const bone = this.bones.get(name)!;
      bone.position.copy(rest.position);
      bone.quaternion.copy(rest.local);
    });
    this.model.updateMatrixWorld(true);
  }
  point(name: string) {
    const bone = this.bones.get(name)!;
    bone.updateWorldMatrix(true, false);
    return this.space.worldToLocal(bone.getWorldPosition(new THREE.Vector3()));
  }
  /** Bone orientation in `space` coordinates. */
  rotation(name: string) {
    const bone = this.bones.get(name)!;
    bone.updateWorldMatrix(true, false);
    return this.space.getWorldQuaternion(new THREE.Quaternion()).invert()
      .multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
  }
  orient(name: string, orientation: THREE.Quaternion) {
    const bone = this.bones.get(name)!;
    bone.parent!.updateWorldMatrix(true, false);
    const world = this.space.getWorldQuaternion(new THREE.Quaternion()).multiply(orientation);
    bone.quaternion.copy(bone.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world));
    bone.updateMatrixWorld(true);
  }
  /** Apply a `space` rotation about the bone's own joint. */
  turn(name: string, delta: THREE.Quaternion) {
    this.orient(name, delta.clone().multiply(this.rotation(name)));
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
  bend.normalize();
  const elbow = centre.addScaledVector(bend, Math.sqrt(Math.max(0, upper ** 2 - along ** 2)));
  // Hinge axis of the middle joint: d1 x d2 is parallel to bend x axis even
  // when the limb is fully straight, so the joint's twist stays defined.
  const hinge = bend.clone().cross(axis).normalize();
  return { elbow, wrist, hinge };
}

type Side = 'l' | 'r';
type Limb = { root: string; middle: string; end: string; restHinge: THREE.Vector3; lengths: [number, number] };
type ContactTarget = { key: string; point: [number, number, number] };
type Correction = { key: string; spine: THREE.Quaternion; shoulder: THREE.Quaternion; elbow: number };

export function attachNativePlayer(
  template: THREE.Group,
  rig: PlayerRig,
  shirtColor: number,
  motionSources: GroundstrokeMotionSources,
  kit: NativePlayerKit = BROADCAST_PLAYER_KITS[0],
  kitIndex = 0,
) {
  const model = clone(template) as THREE.Group;
  model.name = 'wtsl-continuous-player-claude';
  addNativeTwistBones(model);
  dressNativePlayer(model, shirtColor, template.userData.gender === 'female', kit, kitIndex);
  addNativePlayerAccessories(
    model,
    kit,
    rig.root.userData.dominantHandedness === 'left' ? 'left' : 'right',
    kitIndex,
  );
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
  const limb = (root: string, middle: string, end: string): Limb => {
    const a = pose.point(root), b = pose.point(middle), c = pose.point(end);
    return { root, middle, end,
      restHinge: b.clone().sub(a).cross(c.clone().sub(b)).normalize(),
      lengths: [a.distanceTo(b), b.distanceTo(c)] };
  };
  const arms = { l: limb('upperarm_l', 'lowerarm_l', 'hand_l'), r: limb('upperarm_r', 'lowerarm_r', 'hand_r') };
  const legs = { l: limb('thigh_l', 'calf_l', 'foot_l'), r: limb('thigh_r', 'calf_r', 'foot_r') };
  const localRacket = { l: racketContactOrientation(grips.l.shaft, grips.l.palm),
    r: racketContactOrientation(grips.r.shaft, grips.r.palm) };
  const capturedGroundstroke = new DmoCapturedGroundstroke(model, rig.root, pose.rest, motionSources);
  rig.root.userData.capturedSmash = capturedGroundstroke.hasSmash;
  let capturedLocomotion: DmoCapturedLocomotion | null = null;
  try {
    capturedLocomotion = new DmoCapturedLocomotion(pose.rest, {
      ...(motionSources.locomotion ?? {}),
      ready: motionSources.backhand,
    });
  } catch (error) {
    console.warn('Captured between-shot motion could not be prepared; using the existing carry behavior.', error);
  }
  const previousRoll: Partial<Record<Side, number>> = {};
  const previousSupportHand: Partial<Record<Side, THREE.Quaternion>> = {};
  const previousCradle: Partial<Record<Side, number>> = {};

  /** Pose a two-segment limb through its anatomical hinge (no free twist). */
  const setLimb = (l: Limb, middle: THREE.Vector3, end: THREE.Vector3, hinge: THREE.Vector3) => {
    const start = pose.point(l.root);
    const r0 = pose.rest.get(l.root)!, r1 = pose.rest.get(l.middle)!;
    const d1 = middle.clone().sub(start).normalize(), d2 = end.clone().sub(middle).normalize();
    const h = hinge.clone().addScaledVector(d1, -hinge.dot(d1)).normalize();
    const h2 = hinge.clone().addScaledVector(d2, -hinge.dot(d2)).normalize();
    const restH1 = l.restHinge.clone().addScaledVector(r0.direction, -l.restHinge.dot(r0.direction)).normalize();
    const restH2 = l.restHinge.clone().addScaledVector(r1.direction, -l.restHinge.dot(r1.direction)).normalize();
    pose.orient(l.root, frameRotation(r0.direction, restH1, d1, h).multiply(r0.rotation));
    pose.orient(l.middle, frameRotation(r1.direction, restH2, d2, h2).multiply(r1.rotation));
  };
  /** The hand's orientation if the wrist were straight (rest wrist offset). */
  const neutralHand = (side: Side) => pose.rotation(`lowerarm_${side}`)
    .multiply(pose.rest.get(`lowerarm_${side}`)!.rotation.clone().invert())
    .multiply(pose.rest.get(`hand_${side}`)!.rotation);
  /** Bring a requested hand orientation within anatomical wrist range. */
  const limitWrist = (side: Side, desired: THREE.Quaternion) => {
    const neutral = neutralHand(side);
    const forearm = pose.point(`hand_${side}`).sub(pose.point(`lowerarm_${side}`)).normalize();
    const delta = desired.clone().multiply(neutral.clone().invert());
    let rawRoll = twistAngle(delta, forearm);
    const lastRoll = previousRoll[side];
    if (lastRoll !== undefined && Math.abs(rawRoll - lastRoll) > Math.PI) {
      rawRoll -= Math.sign(rawRoll - lastRoll) * 2 * Math.PI;
    }
    const roll = THREE.MathUtils.clamp(rawRoll, -FOREARM_ROLL_LIMIT, FOREARM_ROLL_LIMIT);
    previousRoll[side] = roll;
    const twist = new THREE.Quaternion().setFromAxisAngle(forearm, twistAngle(delta, forearm));
    const swing = clampRotation(delta.clone().multiply(twist.invert()), WRIST_SWING_LIMIT);
    return swing.multiply(new THREE.Quaternion().setFromAxisAngle(forearm, roll)).multiply(neutral);
  };
  const handGripPoint = (side: Side, orientation: THREE.Quaternion) => pose.point(`hand_${side}`)
    .add(grips[side].centre.clone().multiplyScalar(BODY_SCALE).applyQuaternion(orientation));
  /** Solve an arm so its hand holds a grip point with (limited) orientation. */
  const reachArm = (side: Side, gripPoint: THREE.Vector3 | null, wristTarget: THREE.Vector3 | null,
    desiredHand: THREE.Quaternion | null, preference: THREE.Vector3) => {
    const arm = arms[side];
    const clavicle = `clavicle_${side}`;
    const clavicleRest = pose.rotation(clavicle);
    let hand = desiredHand;
    for (let pass = 0; pass < 3; pass++) {
      const target = gripPoint && hand
        ? gripPoint.clone().sub(grips[side].centre.clone().multiplyScalar(BODY_SCALE).applyQuaternion(hand))
        : wristTarget!;
      if (pass === 0) {
        // Shrug the clavicle with arm elevation so a raised arm does not crush
        // the deltoid into the neck (the asset's shoulder skin follows it).
        const shoulder = pose.point(arm.root);
        const lift = THREE.MathUtils.clamp((target.y - shoulder.y + 0.15) / 0.45, 0, 1);
        const forward = THREE.MathUtils.clamp((target.z - shoulder.z) / 0.5, -1, 1);
        const sign = side === 'l' ? 1 : -1;
        pose.orient(clavicle, new THREE.Quaternion().setFromEuler(new THREE.Euler(
          0, -sign * 0.16 * Math.max(0, forward), sign * 0.3 * lift)).multiply(clavicleRest));
      }
      const solved = nativeTwoBone(pose.point(arm.root), target, arm.lengths[0], arm.lengths[1], preference);
      setLimb(arm, solved.elbow, solved.wrist, solved.hinge);
      hand = desiredHand ? limitWrist(side, desiredHand) : neutralHand(side);
      pose.orient(`hand_${side}`, hand);
      if (!gripPoint) break;
    }
    return hand!;
  };

  /** Coordinated contact correction: chest, shoulder swing and elbow hinge. */
  let correction: Correction | null = null;
  const racketHead = (side: Side, roll: THREE.Quaternion) => {
    const orientation = pose.rotation(`hand_${side}`);
    const racket = orientation.clone().multiply(localRacket[side]).multiply(roll);
    return handGripPoint(side, orientation).add(RACKET_HEAD.clone().applyQuaternion(racket));
  };
  const elbowHinge = (side: Side) => {
    const s = pose.point(`upperarm_${side}`), e = pose.point(`lowerarm_${side}`), w = pose.point(`hand_${side}`);
    const h = e.clone().sub(s).cross(w.clone().sub(e));
    return h.lengthSq() > 1e-10 ? h.normalize() : null;
  };
  const elbowFlex = (side: Side) => {
    const s = pose.point(`upperarm_${side}`), e = pose.point(`lowerarm_${side}`), w = pose.point(`hand_${side}`);
    return e.clone().sub(s).angleTo(w.clone().sub(e));
  };
  const bendElbow = (side: Side, angle: number) => {
    const hinge = elbowHinge(side);
    if (!hinge) return 0;
    const flex = elbowFlex(side);
    const next = THREE.MathUtils.clamp(flex + angle, ELBOW_FLEX_RANGE[0], ELBOW_FLEX_RANGE[1]);
    const applied = next - flex;
    const hand = pose.rotation(`hand_${side}`);
    const q = new THREE.Quaternion().setFromAxisAngle(hinge, applied);
    pose.turn(`lowerarm_${side}`, q);
    pose.orient(`hand_${side}`, q.multiply(hand));
    return applied;
  };
  const angleOf = (q: THREE.Quaternion) => 2 * Math.acos(THREE.MathUtils.clamp(Math.abs(q.w), 0, 1));
  /** Turn the trunk evenly through all three spine joints (no kink at one joint). */
  const turnSpine = (q: THREE.Quaternion) => {
    const part = new THREE.Quaternion().slerp(q, 1 / 3);
    for (const name of ['spine_01', 'spine_02', 'spine_03']) pose.turn(name, part);
  };
  const limitTrunkLean = (weight: number) => {
    if (weight <= 0) return;
    for (let pass = 0; pass < 3; pass++) {
      const trunk = pose.point('neck_01').sub(pose.point('pelvis'));
      const lean = Math.acos(THREE.MathUtils.clamp(trunk.y / Math.max(1e-6, trunk.length()), -1, 1));
      const excess = (lean - TRUNK_LEAN_LIMIT) * weight;
      if (excess <= 1e-4) return;
      const axis = trunk.clone().cross(UP);
      if (axis.lengthSq() < 1e-10) return;
      turnSpine(new THREE.Quaternion().setFromAxisAngle(axis.normalize(), excess));
      model.updateMatrixWorld(true);
    }
  };
  /** One CCD step about `joint`, limited so the accumulated turn stays within `total`. */
  const swingToward = (joint: string, side: Side, roll: THREE.Quaternion, goal: THREE.Vector3,
    step: number, accumulated: THREE.Quaternion, total: number) => {
    const pivot = pose.point(joint);
    const from = racketHead(side, roll).sub(pivot), to = goal.clone().sub(pivot);
    if (from.lengthSq() < 1e-8 || to.lengthSq() < 1e-8) return new THREE.Quaternion();
    let q = clampRotation(new THREE.Quaternion().setFromUnitVectors(from.normalize(), to.normalize()), step);
    if (joint === 'spine_01') {
      const axis = pose.point('neck_01').sub(pivot).normalize();
      const twist = new THREE.Quaternion().setFromAxisAngle(axis, twistAngle(q, axis));
      const bend = q.clone().multiply(twist.clone().invert());
      q = new THREE.Quaternion().slerp(bend, SPINE_BEND_SHARE).multiply(twist);
    }
    const room = total - angleOf(accumulated);
    if (room <= 0) return new THREE.Quaternion();
    q = clampRotation(q, room);
    if (joint === 'spine_01') turnSpine(q); else pose.turn(joint, q);
    return q;
  };
  /** Express a `space` rotation in a bone's parent frame, and back. */
  const parentRotation = (joint: string) => {
    const parent = pose.bones.get(joint)!.parent!;
    pose.bones.get(joint)!.updateWorldMatrix(true, false);
    return rig.root.getWorldQuaternion(new THREE.Quaternion()).invert()
      .multiply(parent.getWorldQuaternion(new THREE.Quaternion()));
  };
  const toParent = (joint: string, q: THREE.Quaternion) => {
    const p = parentRotation(joint);
    return p.clone().invert().multiply(q).multiply(p);
  };
  const fromParent = (joint: string, q: THREE.Quaternion) => {
    const p = parentRotation(joint);
    return p.clone().multiply(q).multiply(p.invert());
  };
  const solveCorrection = (side: Side, roll: THREE.Quaternion, goal: THREE.Vector3) => {
    let spine = new THREE.Quaternion(), shoulder = new THREE.Quaternion();
    let elbow = 0;
    for (let i = 0; i < 8; i++) {
      // trunk rotation first (where a forehand's forward reach comes from),
      // then shoulder swing, then the elbow hinge for the remaining distance.
      spine = toParent('spine_01', swingToward('spine_01', side, roll, goal, 0.12,
        fromParent('spine_01', spine), 0.6)).multiply(spine);
      shoulder = toParent(`upperarm_${side}`, swingToward(`upperarm_${side}`, side, roll, goal, 0.2,
        fromParent(`upperarm_${side}`, shoulder), 0.95)).multiply(shoulder);
      const s = pose.point(`upperarm_${side}`);
      const err = goal.distanceTo(s) - racketHead(side, roll).distanceTo(s);
      elbow += bendElbow(side, THREE.MathUtils.clamp(-err * 2.2, -0.3, 0.3));
    }
    return { spine, shoulder, elbow };
  };

  const update = () => {
    pose.reset();
    const delta = rig.hip.position.clone().sub(pose.point('pelvis'));
    model.position.add(delta);
    pose.orient('pelvis', rig.hip.quaternion.clone().multiply(pose.rest.get('pelvis')!.rotation));
    // The DMO pose already gives the torso's pitch, roll and turn. Applying
    // that same absolute body rotation to each native spine joint preserves
    // its bind offsets while avoiding cumulative bends through the torso.
    for (const name of ['spine_01', 'spine_02', 'spine_03']) {
      pose.orient(name, rig.body.quaternion.clone().multiply(pose.rest.get(name)!.rotation));
    }
    const neckPosition = pose.point('neck_01');
    const headDirection = rig.head.position.clone().sub(neckPosition);
    headDirection.y = Math.max(0.08, headDirection.y);
    pose.aim('neck_01', neckPosition.add(headDirection));
    pose.orient('head', rig.head.quaternion.clone().multiply(pose.rest.get('head')!.rotation));
    const playback = rig.root.userData.groundstrokePlayback as GroundstrokePlayback | undefined;
    const captureWeight = THREE.MathUtils.clamp(playback?.weight ?? 0, 0, 1);
    const dominant: Side = rig.root.userData.dominantHandedness === 'left' ? 'l' : 'r';
    const support: Side = dominant === 'l' ? 'r' : 'l';
    const twoHanded = playback?.hands
      ? playback.hands === 'two'
      : Boolean(rig.root.userData.twoHandedGrip);
    const oneHandedStroke = playback?.hands
      ? playback.hands === 'one'
      : !twoHanded;

    // 1. Procedural base pose (always), so captured motion blends from a
    //    plausible stance rather than from the bind A-pose.
    for (const side of ['l', 'r'] as const) {
      // Legacy legs use screen-space labels, opposite anatomical asset labels.
      const thigh = side === 'l' ? rig.rightLeg : rig.leftLeg;
      const calf = side === 'l' ? rig.rightCalf : rig.leftCalf;
      const [, legacyKnee] = ends(thigh), [, ankle] = ends(calf);
      const hip = pose.point(`thigh_${side}`);
      // Knees track over the toes: bend forward and slightly outward, never
      // toward the other leg (the legacy dummy knee sits too close to centre).
      const mid = hip.clone().lerp(ankle, 0.5);
      const preference = new THREE.Vector3(
        mid.x + (side === 'l' ? 1 : -1) * 0.05, legacyKnee.y, Math.max(legacyKnee.z, mid.z) + 0.35);
      const solved = nativeTwoBone(hip, ankle, legs[side].lengths[0], legs[side].lengths[1], preference);
      setLimb(legs[side], solved.elbow, solved.wrist, solved.hinge);
      pose.orient(`foot_${side}`, pose.rest.get(`foot_${side}`)!.rotation);
    }
    // Recorded legs on a walk or run: the swinging leg follows the recording
    // (knee drive, heel lift) and lands where the gait puts it; a planted foot
    // is never moved. Feet and knees point along the hips' run direction.
    {
      const hipYaw = Number(rig.root.userData.runHipYaw ?? 0);
      const yaw = new THREE.Quaternion().setFromAxisAngle(UP, hipYaw);
      const legWeight = THREE.MathUtils.clamp(Number(rig.root.userData.recordedLegs ?? 0), 0, 1);
      const lifts = rig.root.userData.gaitLift as { l: number; r: number } | undefined;
      const lunge = rig.root.userData.lunge as { weight: number; side: number } | undefined;
      const recorded = legWeight > 0.001 && lifts
        ? capturedLocomotion?.legs(
          Number(rig.root.userData.locomotionPhase ?? 0),
          Number(rig.root.userData.locomotionSpeed ?? 0),
        ) ?? null
        : null;
      if (Math.abs(hipYaw) > 1e-3 || recorded || (lunge?.weight ?? 0) > 0.001) {
        for (const side of ['l', 'r'] as const) {
          const hip = pose.point(`thigh_${side}`);
          const ankle = pose.point(`foot_${side}`);
          const length = legs[side].lengths[0] + legs[side].lengths[1];
          const mid = hip.clone().lerp(ankle, 0.5);
          let preference = mid.clone().add(
            new THREE.Vector3((side === 'l' ? 1 : -1) * 0.05, 0, 0.35).applyQuaternion(yaw),
          );
          if (lunge && (lunge.side > 0 ? 'l' : 'r') === side) {
            preference.x += lunge.side * 0.3 * lunge.weight;
          }
          let target = ankle;
          if (recorded) {
            const swing = legWeight * THREE.MathUtils.smoothstep(lifts![side], 0.005, 0.05);
            const unyaw = yaw.clone().invert();
            const ownLateral = (point: THREE.Vector3) => point.clone().sub(hip).applyQuaternion(unyaw).x;
            const fromHip = (point: THREE.Vector3, lateral: number) => {
              const local = point.clone().multiplyScalar(length);
              local.x = lateral;
              return hip.clone().add(local.applyQuaternion(yaw));
            };
            preference = preference.lerp(fromHip(recorded[side].knee, ownLateral(preference)).add(
              new THREE.Vector3(0, 0, 0.15).applyQuaternion(yaw)), legWeight);
            target = ankle.clone().lerp(fromHip(recorded[side].ankle, ownLateral(ankle)), swing);
            target.y = Math.max(target.y, ankle.y);
          }
          const solved = nativeTwoBone(hip, target, legs[side].lengths[0], legs[side].lengths[1], preference);
          setLimb(legs[side], solved.elbow, solved.wrist, solved.hinge);
          pose.orient(`foot_${side}`, yaw.clone().multiply(pose.rest.get(`foot_${side}`)!.rotation));
        }
        model.updateMatrixWorld(true);
      }
    }
    const proceduralRacket = rig.racket.quaternion.clone();
    const proceduralGrip = rig.racket.position.clone();
    {
      const desired = proceduralRacket.clone().multiply(localRacket[dominant].clone().invert());
      const elbowPreference = proceduralGrip.clone().sub(grips[dominant].centre.clone().multiplyScalar(BODY_SCALE)
        .applyQuaternion(desired)).addScaledVector(grips[dominant].forward.clone().applyQuaternion(desired), -arms[dominant].lengths[1])
        .add(new THREE.Vector3(0, -0.08, -0.04));
      // This is the live renderer's default implementation. Keep the r11
      // locomotion correction here as well as in the comparison implementation.
      const chestTurn = pose.rotation('spine_03').multiply(pose.rest.get('spine_03')!.rotation.clone().invert());
      const relaxedCarry = THREE.MathUtils.clamp(Number(rig.root.userData.relaxedCarry ?? 0), 0, 1);
      if (relaxedCarry > 0) {
        const outward = dominant === 'l' ? 1 : -1;
        const hangingElbow = pose.point(arms[dominant].root).lerp(proceduralGrip, 0.5)
          .add(new THREE.Vector3(outward * 0.04, 0, -0.14).applyQuaternion(chestTurn));
        elbowPreference.lerp(hangingElbow, relaxedCarry);
      }
      reachArm(dominant, proceduralGrip, null, desired, elbowPreference);
      const forearm = support === 'l' ? rig.leftForearm : rig.rightForearm;
      const [, relaxedWrist] = ends(forearm);
      const outward = support === 'l' ? 1 : -1;
      const relaxedElbow = pose.point(arms[support].root).lerp(relaxedWrist, 0.5)
        .add(new THREE.Vector3(outward * 0.02, 0, -0.14).applyQuaternion(chestTurn));
      reachArm(support, null, relaxedWrist, null, relaxedElbow);
      const readyArms = THREE.MathUtils.clamp(Number(rig.root.userData.readyArms ?? 0), 0, 1);
      if (capturedLocomotion && readyArms > 0) {
        capturedLocomotion.applyReady(pose, {
          time: Number(rig.root.userData.readyTime ?? 0),
          weight: readyArms,
          mirrored: dominant === 'l',
        });
        const crouch = THREE.MathUtils.clamp(Number(rig.root.userData.returnCrouch ?? 0), 0, 1) * readyArms;
        if (crouch > 0) {
          bendElbow(dominant, 1.1 * crouch);
          bendElbow(support, 1.1 * crouch);
          model.updateMatrixWorld(true);
        }
        const recordedHand = pose.rotation(`hand_${dominant}`);
        pose.orient(`hand_${dominant}`, recordedHand.slerp(limitWrist(dominant, desired), readyArms));
        model.updateMatrixWorld(true);
      }
      const locomotionArms = THREE.MathUtils.clamp(Number(rig.root.userData.locomotionArms ?? 0), 0, 1);
      if (capturedLocomotion?.hasLocomotion && locomotionArms > 0) {
        capturedLocomotion.apply(pose, {
          phase: Number(rig.root.userData.locomotionPhase ?? 0),
          speed: Number(rig.root.userData.locomotionArmsSpeed ?? rig.root.userData.locomotionSpeed ?? 0),
          weight: locomotionArms,
        });
        const recordedHand = pose.rotation(`hand_${dominant}`);
        pose.orient(`hand_${dominant}`, recordedHand.slerp(limitWrist(dominant, desired), locomotionArms));
        model.updateMatrixWorld(true);
      }
      // The live renderer defaults to this player implementation. Preserve
      // recorded elbow/hand positions, but resolve each arm through its natural
      // elbow hinge instead of copying twist along the upper arm.
      if (capturedLocomotion && Math.max(readyArms, locomotionArms) > 0) {
        for (const side of [dominant, support]) {
          const arm = arms[side];
          const s = pose.point(arm.root), e = pose.point(arm.middle), w = pose.point(arm.end);
          const hand = pose.rotation(`hand_${side}`);
          const upper = e.clone().sub(s), lower = w.clone().sub(e);
          let hinge = upper.clone().cross(lower);
          if (hinge.lengthSq() < 1e-6) {
            // Nearly straight: carry the rest hinge round with the upper arm.
            hinge = arm.restHinge.clone().applyQuaternion(new THREE.Quaternion()
              .setFromUnitVectors(pose.rest.get(arm.root)!.direction, upper.clone().normalize()));
          }
          setLimb(arm, e, w, hinge.normalize());
          pose.orient(`hand_${side}`, limitWrist(side, hand));
        }
        model.updateMatrixWorld(true);
      }
    }

    // 2. Captured stroke motion blends over the whole body, arms included:
    //    the captured shoulder/elbow/wrist chain is kept, not re-solved.
    const LEG_BONES = ['thigh_l', 'calf_l', 'foot_l', 'thigh_r', 'calf_r', 'foot_r'];
    const steppingLegs = LEG_BONES.map(name => pose.bones.get(name)!.quaternion.clone());
    const strokePlayback = playback ? { ...playback, oneHanded: oneHandedStroke } : undefined;
    const capturedBody = strokePlayback ? capturedGroundstroke.apply(strokePlayback) : null;
    if (capturedBody) {
      // A stroke played on the run keeps the stepping legs: the captured legs
      // stand still and would glide across the court with the moving player.
      const running = THREE.MathUtils.smoothstep(Number(rig.root.userData.locomotionSpeed ?? 0), 1.2, 3);
      if (running > 0) {
        LEG_BONES.forEach((name, i) => pose.bones.get(name)!.quaternion.slerp(steppingLegs[i], running));
        model.updateMatrixWorld(true);
      }
    }
    if (capturedBody && playback && playback.stroke !== 'serve') limitTrunkLean(captureWeight);
    const strokeRoll = new THREE.Quaternion();
    const backhandRoll = recordedBackhandFaceRoll(playback?.stroke, oneHandedStroke, playback?.slice);
    if (capturedBody && playback) {
      if (backhandRoll) {
        strokeRoll.setFromAxisAngle(UP, (dominant === 'r' ? 1 : -1) * backhandRoll * captureWeight);
      }
      const contact = rig.root.userData.contactTarget as ContactTarget | undefined;
      if (contact && playback.stroke !== 'serve') {
        const goal = new THREE.Vector3(...contact.point);
        if (correction?.key !== contact.key) {
          // Solve once per shot on the captured contact pose, then apply the
          // same chest/shoulder/elbow offsets (fading out away from contact) so
          // the stroke path shifts coherently instead of kinking at impact.
          const saved = [...pose.bones.values()].map(b => [b, b.position.clone(), b.quaternion.clone()] as const);
          capturedGroundstroke.apply({ ...strokePlayback!, deltaSeconds: 0, weight: 1 });
          limitTrunkLean(1);
          const fullRoll = backhandRoll
            ? new THREE.Quaternion().setFromAxisAngle(UP, (dominant === 'r' ? 1 : -1) * backhandRoll)
            : new THREE.Quaternion();
          correction = { key: contact.key, ...solveCorrection(dominant, fullRoll, goal) };
          // A recorded contact the body cannot reach (bad sample, or a fixture
          // whose player is metres from the ball) must not contort the swing.
          if (racketHead(dominant, fullRoll).distanceTo(goal) > 0.45) {
            correction = { key: contact.key, spine: new THREE.Quaternion(), shoulder: new THREE.Quaternion(), elbow: 0 };
          }
          saved.forEach(([b, p, q]) => { b.position.copy(p); b.quaternion.copy(q); });
          model.updateMatrixWorld(true);
        }
        const frames = Math.abs(playback.deltaSeconds) * 60;
        const weight = captureWeight * (1 - THREE.MathUtils.smoothstep(frames, 8, 20));
        if (weight > 0) {
          const identity = new THREE.Quaternion();
          turnSpine(fromParent('spine_01', identity.clone().slerp(correction.spine, weight)));
          pose.turn(`upperarm_${dominant}`,
            fromParent(`upperarm_${dominant}`, identity.clone().slerp(correction.shoulder, weight)));
          bendElbow(dominant, correction.elbow * weight);
        }
      }
    }

    // The tossing arm follows the captured lift, then comes down in front
    // through contact and the landing instead of flinging behind the body.
    if (capturedBody && playback?.stroke === 'serve') {
      const frames = playback.deltaSeconds * 60;
      const tuck = serveTossTuckWeight(frames, captureWeight);
      if (tuck > 0) {
        const chest = pose.point('spine_03');
        const chestTurn = pose.rotation('spine_03')
          .multiply(pose.rest.get('spine_03')!.rotation.clone().invert());
        const across = dominant === 'r' ? -1 : 1;
        const wrist = chest.clone().add(
          new THREE.Vector3(across * 0.08, -0.24, 0.2).applyQuaternion(chestTurn),
        );
        const elbow = chest.clone().add(
          new THREE.Vector3(-across * 0.24, -0.3, 0.06).applyQuaternion(chestTurn),
        );
        const chain = [`clavicle_${support}`, `upperarm_${support}`, `lowerarm_${support}`, `hand_${support}`];
        const captured = chain.map(name => pose.bones.get(name)!.quaternion.clone());
        reachArm(support, null, wrist, null, elbow);
        chain.forEach((name, index) => {
          const bone = pose.bones.get(name)!;
          bone.quaternion.copy(captured[index].clone().slerp(bone.quaternion, tuck));
        });
        model.updateMatrixWorld(true);
      }
    }

    // Eyes on the ball. The neck takes part of the turn, within anatomical
    // limits; the head follows smoothly instead of snapping between updates.
    const lookWeight = THREE.MathUtils.clamp(Number(rig.root.userData.lookWeight ?? 0), 0, 1);
    const lookTarget = rig.root.userData.lookTarget as [number, number, number] | undefined;
    if (lookTarget && lookWeight > 0.001) {
      const relative = (name: string) => pose.rotation(name).multiply(pose.rest.get(name)!.rotation.clone().invert());
      const chest = relative('spine_03');
      const toBall = new THREE.Vector3(...lookTarget).sub(pose.point('head'));
      if (toBall.lengthSq() > 1e-4) {
        const local = toBall.normalize().applyQuaternion(chest.clone().invert());
        const yawTarget = THREE.MathUtils.clamp(Math.atan2(local.x, local.z), -HEAD_YAW_LIMIT, HEAD_YAW_LIMIT);
        const pitchTarget = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(local.y, -1, 1)), -0.8, 1.0);
        const previous = rig.root.userData.headLook as { yaw: number; pitch: number } | undefined;
        const step = (from: number, to: number) => from + THREE.MathUtils.clamp(to - from, -HEAD_TURN_STEP, HEAD_TURN_STEP);
        const look = previous
          ? { yaw: step(previous.yaw, yawTarget), pitch: step(previous.pitch, pitchTarget) }
          : { yaw: yawTarget, pitch: pitchTarget };
        rig.root.userData.headLook = look;
        const current = new THREE.Vector3(0, 0, 1).applyQuaternion(relative('head'));
        const wanted = new THREE.Vector3(
          Math.sin(look.yaw) * Math.cos(look.pitch),
          Math.sin(look.pitch),
          Math.cos(look.yaw) * Math.cos(look.pitch),
        ).applyQuaternion(chest);
        const turn = new THREE.Quaternion().setFromUnitVectors(current, current.clone().lerp(wanted, lookWeight).normalize());
        const neckTurn = new THREE.Quaternion().slerp(turn, 0.4);
        pose.orient('neck_01', neckTurn.multiply(pose.rotation('neck_01')));
        const headNow = new THREE.Vector3(0, 0, 1).applyQuaternion(relative('head'));
        const rest = new THREE.Quaternion().setFromUnitVectors(headNow, current.clone().lerp(wanted, lookWeight).normalize());
        pose.orient('head', rest.multiply(pose.rotation('head')));
        model.updateMatrixWorld(true);
      }
    } else {
      delete rig.root.userData.headLook;
    }

    // 3. The racket is carried by the dominant hand; the hand never chases a
    //    separately animated racket.
    const handOrientation = pose.rotation(`hand_${dominant}`);
    rig.racket.quaternion.copy(handOrientation.clone().multiply(localRacket[dominant]).multiply(strokeRoll)).normalize();
    rig.racket.position.copy(handGripPoint(dominant, handOrientation));
    grips[dominant].setClosed(true);
    // (a captured stroke keeps its own free-arm motion)
    const strokeHold = THREE.MathUtils.clamp(
      Number(rig.root.userData.supportStrokeWeight ?? (twoHanded ? 1 : 0)),
      0,
      1,
    );
    const supportHold = Math.max(
      strokeHold,
      THREE.MathUtils.clamp(Number(rig.root.userData.supportHoldWeight ?? 0), 0, 1) * (1 - captureWeight),
    );
    grips[support].setClosed(supportHold > 0.5);
    if (supportHold > 0) {
      const racketRotation = rig.racket.quaternion.clone();
      let desired = racketRotation.clone().multiply(new THREE.Quaternion().setFromAxisAngle(UP, Math.PI))
        .multiply(localRacket[support].clone().invert());
      let grip = rig.racket.position.clone().add(
        new THREE.Vector3(0, Number(rig.root.userData.supportGripOffset ?? 0.11), 0).applyQuaternion(racketRotation));
      // In a stationary carry, turn the support hand around the shaft to find
      // the least strained forearm angle. Keep captured two-handed strokes
      // unchanged, and ease the selected cradle angle between frames.
      const cradle = 1 - strokeHold;
      if (cradle > 0) {
        const shaft = UP.clone().applyQuaternion(racketRotation);
        const elbowGuess = grip.clone().add(new THREE.Vector3(0, -0.12, -0.02))
          .addScaledVector(grips[support].forward.clone().applyQuaternion(desired), -arms[support].lengths[1]);
        const strain = (hand: THREE.Quaternion) => {
          reachArm(support, grip, null, hand, elbowGuess);
          const neutral = neutralHand(support);
          const forearm = pose.point(`hand_${support}`)
            .sub(pose.point(`lowerarm_${support}`)).normalize();
          const delta = hand.clone().multiply(neutral.clone().invert());
          const roll = twistAngle(delta, forearm);
          const swing = angleOf(delta.clone().multiply(
            new THREE.Quaternion().setFromAxisAngle(forearm, -roll),
          ));
          return Math.abs(roll) + 1.5 * Math.max(0, swing - 0.45);
        };
        const previous = previousCradle[support] ?? 0;
        const savedRoll = previousRoll[support];
        const chain = [`clavicle_${support}`, `upperarm_${support}`, `lowerarm_${support}`, `hand_${support}`];
        const savedChain = chain.map(name => pose.bones.get(name)!.quaternion.clone());
        let best = previous;
        let bestCost = Number.POSITIVE_INFINITY;
        for (let step = -6; step <= 6; step += 1) {
          const angle = step * Math.PI / 12;
          const candidate = new THREE.Quaternion().setFromAxisAngle(shaft, angle).multiply(desired);
          const cost = strain(candidate) + 0.25 * Math.abs(angle - previous);
          if (cost < bestCost) {
            bestCost = cost;
            best = angle;
          }
        }
        previousRoll[support] = savedRoll;
        chain.forEach((name, index) => pose.bones.get(name)!.quaternion.copy(savedChain[index]));
        model.updateMatrixWorld(true);
        const turn = previous + THREE.MathUtils.clamp(best - previous, -0.12, 0.12);
        previousCradle[support] = turn;
        desired = new THREE.Quaternion().setFromAxisAngle(shaft, turn * cradle).multiply(desired);
      }
      if (supportHold < 1) {
        // Ease the free hand between its relaxed pose and the racket.
        const relaxed = pose.rotation(`hand_${support}`);
        grip = handGripPoint(support, relaxed).lerp(grip, supportHold);
        const shortPath = slerpPath(relaxed, desired, supportHold, false);
        const longPath = slerpPath(relaxed, desired, supportHold, true);
        const previous = previousSupportHand[support];
        desired = previous && longPath.angleTo(previous) < shortPath.angleTo(previous)
          ? longPath
          : shortPath;
      }
      previousSupportHand[support] = desired.clone();
      const elbowPreference = grip.clone().addScaledVector(grips[support].forward.clone().applyQuaternion(desired),
        -arms[support].lengths[1])
        .add(new THREE.Vector3(0, -0.12, -0.02));
      reachArm(support, grip, null, desired, elbowPreference);
    } else {
      delete previousSupportHand[support];
    }
    // Pre-serve bounce: bring the free hand to the supplied ball target.
    const serveBounce = rig.root.userData.serveBounce as { weight: number; hand: [number, number, number] } | undefined;
    if (serveBounce && serveBounce.weight > 0.001) {
      const handNow = pose.rotation(`hand_${support}`);
      const gripNow = handGripPoint(support, handNow);
      const target = gripNow.clone().lerp(
        new THREE.Vector3(...serveBounce.hand),
        THREE.MathUtils.clamp(serveBounce.weight, 0, 1),
      );
      const shoulder = pose.point(arms[support].root);
      const elbowPreference = shoulder.clone().lerp(target, 0.5)
        .add(new THREE.Vector3((support === 'l' ? 1 : -1) * 0.18, -0.08, -0.05));
      reachArm(support, target, null, handNow, elbowPreference);
    }
    distributeNativeTwist(pose.bones, pose.rest);
    pose.finish();
    {
      const placeCapturedShoe = (shoe: THREE.Object3D, footName: string) => {
        const foot = pose.bones.get(footName)!;
        const ankle = pose.point(footName);
        // Shoe geometry is already horizontal; a bone's bind frame is not.
        // Apply only the foot's rotation away from that bind frame.
        shoe.quaternion.copy(
          rig.root.getWorldQuaternion(new THREE.Quaternion()).invert()
            .multiply(foot.getWorldQuaternion(new THREE.Quaternion()))
            .multiply(pose.rest.get(footName)!.rotation.clone().invert()),
        ).normalize();
        shoe.position.copy(new THREE.Vector3(0, -0.045, 0.05)
          .applyQuaternion(shoe.quaternion).add(ankle));
      };
      // The legacy shoe groups use screen-space labels, opposite anatomical sides.
      placeCapturedShoe(rig.leftShoe, 'foot_r');
      placeCapturedShoe(rig.rightShoe, 'foot_l');
    }
    {
      // Serve: keep both shoes behind the baseline until contact by moving the
      // whole body back (never by bending a leg), then release after contact.
      const guard = rig.root.userData.baselineGuard as { weight: number; baseline: number } | undefined;
      const rootWorld = rig.root.getWorldPosition(new THREE.Vector3());
      if (guard && guard.weight > 0 && Math.abs(rootWorld.x) > guard.baseline - 1.5) {
        const side = Math.sign(rootWorld.x) || 1;
        let overstep = 0;
        for (const shoe of [rig.leftShoe, rig.rightShoe]) {
          const box = new THREE.Box3().setFromObject(shoe);
          const nearest = side > 0 ? box.min.x : -box.max.x;
          overstep = Math.max(overstep, guard.baseline + 0.02 - nearest);
        }
        if (overstep > 0) {
          const shift = new THREE.Vector3(side * Math.min(overstep, 0.8) * guard.weight, 0, 0)
            .applyQuaternion(rig.root.getWorldQuaternion(new THREE.Quaternion()).invert())
            .divide(rig.root.getWorldScale(new THREE.Vector3()));
          for (const object of [model, rig.leftShoe, rig.rightShoe, rig.racket]) object.position.add(shift);
          model.updateMatrixWorld(true);
        }
      }
    }
  };
  rig.detailed = { update };
  return { model, pose, grips, update };
}

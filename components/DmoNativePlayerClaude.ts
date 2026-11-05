import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { PlayerRig } from './DmoLiveCourt3DScene';
import { racketContactOrientation } from './DmoRacketOrientation';
import { makeNativeGrip } from './DmoNativeGrip';
import { dressNativePlayer } from './DmoNativeKit';
import { addNativeTwistBones, distributeNativeTwist, twistAngle } from './DmoNativeTwist';
import {
  DmoCapturedGroundstroke,
  type GroundstrokeMotionSources,
  type GroundstrokePlayback,
} from './DmoCapturedGroundstroke';

const UP = new THREE.Vector3(0, 1, 0);
const BODY_SCALE = 1.075;
/** String-bed centre along the racket's local +Y (see makePlayer's racket). */
const RACKET_HEAD = new THREE.Vector3(0, 0.36, 0);
/** One-handed backhand regrip about the handle (as in the native capture study). */
const BACKHAND_FACE_ROLL = 72 * Math.PI / 180;
/** Anatomical wrist limits relative to a neutral, in-line hand. */
const WRIST_SWING_LIMIT = 1.05;
const FOREARM_ROLL_LIMIT = 1.65;
const ELBOW_FLEX_RANGE = [0.06, 2.45] as const;

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

function clampRotation(q: THREE.Quaternion, limit: number) {
  const angle = 2 * Math.acos(THREE.MathUtils.clamp(Math.abs(q.w), -1, 1));
  if (angle <= limit) return q;
  return new THREE.Quaternion().slerp(
    q.w < 0 ? new THREE.Quaternion(-q.x, -q.y, -q.z, -q.w) : q,
    limit / angle,
  );
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
    model.traverse((object) => {
      if (object instanceof THREE.Bone) this.bones.set(object.name, object);
    });
    this.bones.forEach((bone, name) => {
      const child = name === 'spine_03'
        ? this.bones.get('neck_01')
        : name.startsWith('hand_')
          ? this.bones.get(`middle_01_${name.endsWith('_l') ? 'l' : 'r'}`)
          : bone.children.find((object) => object instanceof THREE.Bone && !object.name.includes('_twist_'));
      const direction = child
        ? child.getWorldPosition(new THREE.Vector3())
          .sub(bone.getWorldPosition(new THREE.Vector3()))
          .normalize()
          .applyQuaternion(inverse)
        : UP.clone();
      this.rest.set(name, {
        position: bone.position.clone(),
        rotation: inverse.clone().multiply(bone.getWorldQuaternion(new THREE.Quaternion())),
        direction,
        local: bone.quaternion.clone(),
      });
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
      const twist = new THREE.Quaternion(
        direction.x * projection,
        direction.y * projection,
        direction.z * projection,
        residual.w,
      );
      if (twist.lengthSq() > 1e-10) orientation.premultiply(twist.normalize());
    }
    this.orient(name, orientation);
  }

  finish() {
    this.model.updateMatrixWorld(true);
    this.model.traverse((object) => {
      if (object instanceof THREE.SkinnedMesh) object.skeleton.update();
    });
  }
}

export function nativeTwoBone(
  shoulder: THREE.Vector3,
  target: THREE.Vector3,
  upper: number,
  lower: number,
  preference: THREE.Vector3,
) {
  const axis = target.clone().sub(shoulder);
  let distance = axis.length();
  if (distance < 1e-8) {
    axis.set(0, -1, 0);
    distance = 1e-8;
  } else axis.divideScalar(distance);
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
) {
  const model = clone(template) as THREE.Group;
  model.name = 'wtsl-continuous-player-claude';
  addNativeTwistBones(model);
  dressNativePlayer(model, shirtColor, template.userData.gender === 'female');
  model.scale.multiplyScalar(BODY_SCALE);
  const original = [...rig.root.children];
  rig.root.add(model);
  original.forEach((child) => {
    if (![rig.racket, rig.leftShoe, rig.rightShoe].includes(child as THREE.Group)) child.visible = false;
  });
  for (const shoe of [rig.leftShoe, rig.rightShoe]) {
    const sock = new THREE.Mesh(
      new THREE.CylinderGeometry(0.043, 0.046, 0.11, 16),
      new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.9 }),
    );
    sock.name = 'tennis-sock';
    sock.position.set(0, 0.075, -0.04);
    shoe.add(sock);
  }
  const pose = new NativePlayerPose(model, rig.root);
  const grips = { l: makeNativeGrip(pose.bones, 'l'), r: makeNativeGrip(pose.bones, 'r') };
  const limb = (root: string, middle: string, end: string): Limb => {
    const a = pose.point(root), b = pose.point(middle), c = pose.point(end);
    return {
      root,
      middle,
      end,
      restHinge: b.clone().sub(a).cross(c.clone().sub(b)).normalize(),
      lengths: [a.distanceTo(b), b.distanceTo(c)],
    };
  };
  const arms = { l: limb('upperarm_l', 'lowerarm_l', 'hand_l'), r: limb('upperarm_r', 'lowerarm_r', 'hand_r') };
  const legs = { l: limb('thigh_l', 'calf_l', 'foot_l'), r: limb('thigh_r', 'calf_r', 'foot_r') };
  const localRacket = {
    l: racketContactOrientation(grips.l.shaft, grips.l.palm),
    r: racketContactOrientation(grips.r.shaft, grips.r.palm),
  };
  const capturedGroundstroke = new DmoCapturedGroundstroke(model, rig.root, pose.rest, motionSources);

  /** Pose a two-segment limb through its anatomical hinge (no free twist). */
  const setLimb = (limbData: Limb, middle: THREE.Vector3, end: THREE.Vector3, hinge: THREE.Vector3) => {
    const start = pose.point(limbData.root);
    const rootRest = pose.rest.get(limbData.root)!, middleRest = pose.rest.get(limbData.middle)!;
    const firstDirection = middle.clone().sub(start).normalize();
    const secondDirection = end.clone().sub(middle).normalize();
    const firstHinge = hinge.clone().addScaledVector(firstDirection, -hinge.dot(firstDirection)).normalize();
    const secondHinge = hinge.clone().addScaledVector(secondDirection, -hinge.dot(secondDirection)).normalize();
    const rootRestHinge = limbData.restHinge.clone()
      .addScaledVector(rootRest.direction, -limbData.restHinge.dot(rootRest.direction)).normalize();
    const middleRestHinge = limbData.restHinge.clone()
      .addScaledVector(middleRest.direction, -limbData.restHinge.dot(middleRest.direction)).normalize();
    pose.orient(
      limbData.root,
      frameRotation(rootRest.direction, rootRestHinge, firstDirection, firstHinge).multiply(rootRest.rotation),
    );
    pose.orient(
      limbData.middle,
      frameRotation(middleRest.direction, middleRestHinge, secondDirection, secondHinge).multiply(middleRest.rotation),
    );
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
    const roll = THREE.MathUtils.clamp(twistAngle(delta, forearm), -FOREARM_ROLL_LIMIT, FOREARM_ROLL_LIMIT);
    const twist = new THREE.Quaternion().setFromAxisAngle(forearm, twistAngle(delta, forearm));
    const swing = clampRotation(delta.clone().multiply(twist.invert()), WRIST_SWING_LIMIT);
    return swing.multiply(new THREE.Quaternion().setFromAxisAngle(forearm, roll)).multiply(neutral);
  };

  const handGripPoint = (side: Side, orientation: THREE.Quaternion) => pose.point(`hand_${side}`)
    .add(grips[side].centre.clone().multiplyScalar(BODY_SCALE).applyQuaternion(orientation));

  /** Solve an arm so its hand holds a grip point with (limited) orientation. */
  const reachArm = (
    side: Side,
    gripPoint: THREE.Vector3 | null,
    wristTarget: THREE.Vector3 | null,
    desiredHand: THREE.Quaternion | null,
    preference: THREE.Vector3,
  ) => {
    const arm = arms[side];
    const clavicle = `clavicle_${side}`;
    const clavicleRest = pose.rotation(clavicle);
    let hand = desiredHand;
    for (let pass = 0; pass < 3; pass += 1) {
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
          0, -sign * 0.16 * Math.max(0, forward), sign * 0.3 * lift,
        )).multiply(clavicleRest));
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
    const shoulder = pose.point(`upperarm_${side}`);
    const elbow = pose.point(`lowerarm_${side}`);
    const wrist = pose.point(`hand_${side}`);
    const hinge = elbow.clone().sub(shoulder).cross(wrist.clone().sub(elbow));
    return hinge.lengthSq() > 1e-10 ? hinge.normalize() : null;
  };
  const elbowFlex = (side: Side) => {
    const shoulder = pose.point(`upperarm_${side}`);
    const elbow = pose.point(`lowerarm_${side}`);
    const wrist = pose.point(`hand_${side}`);
    return elbow.clone().sub(shoulder).angleTo(wrist.clone().sub(elbow));
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

  /** One CCD step about `joint`, limited so the accumulated turn stays within `total`. */
  const swingToward = (
    joint: string,
    side: Side,
    roll: THREE.Quaternion,
    goal: THREE.Vector3,
    step: number,
    accumulated: THREE.Quaternion,
    total: number,
  ) => {
    const pivot = pose.point(joint);
    const from = racketHead(side, roll).sub(pivot), to = goal.clone().sub(pivot);
    if (from.lengthSq() < 1e-8 || to.lengthSq() < 1e-8) return new THREE.Quaternion();
    let q = clampRotation(new THREE.Quaternion().setFromUnitVectors(from.normalize(), to.normalize()), step);
    const room = total - angleOf(accumulated);
    if (room <= 0) return new THREE.Quaternion();
    q = clampRotation(q, room);
    if (joint === 'spine_01') turnSpine(q);
    else pose.turn(joint, q);
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
    const parent = parentRotation(joint);
    return parent.clone().invert().multiply(q).multiply(parent);
  };
  const fromParent = (joint: string, q: THREE.Quaternion) => {
    const parent = parentRotation(joint);
    return parent.clone().multiply(q).multiply(parent.invert());
  };
  const solveCorrection = (side: Side, roll: THREE.Quaternion, goal: THREE.Vector3) => {
    let spine = new THREE.Quaternion(), shoulder = new THREE.Quaternion();
    let elbow = 0;
    for (let iteration = 0; iteration < 8; iteration += 1) {
      // Trunk rotation first (where a forehand's forward reach comes from),
      // then shoulder swing, then the elbow hinge for the remaining distance.
      spine = toParent('spine_01', swingToward(
        'spine_01', side, roll, goal, 0.12, fromParent('spine_01', spine), 0.6,
      )).multiply(spine);
      shoulder = toParent(`upperarm_${side}`, swingToward(
        `upperarm_${side}`, side, roll, goal, 0.2, fromParent(`upperarm_${side}`, shoulder), 0.95,
      )).multiply(shoulder);
      const shoulderPoint = pose.point(`upperarm_${side}`);
      const error = goal.distanceTo(shoulderPoint) - racketHead(side, roll).distanceTo(shoulderPoint);
      elbow += bendElbow(side, THREE.MathUtils.clamp(-error * 2.2, -0.3, 0.3));
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
    const twoHanded = Boolean(rig.root.userData.twoHandedGrip)
      || Boolean(rig.root.userData.waitingPose);

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
      const midpoint = hip.clone().lerp(ankle, 0.5);
      const preference = new THREE.Vector3(
        midpoint.x + (side === 'l' ? 1 : -1) * 0.05,
        legacyKnee.y,
        Math.max(legacyKnee.z, midpoint.z) + 0.35,
      );
      const solved = nativeTwoBone(hip, ankle, legs[side].lengths[0], legs[side].lengths[1], preference);
      setLimb(legs[side], solved.elbow, solved.wrist, solved.hinge);
      pose.orient(`foot_${side}`, pose.rest.get(`foot_${side}`)!.rotation);
    }
    const proceduralRacket = rig.racket.quaternion.clone();
    const proceduralGrip = rig.racket.position.clone();
    {
      const desired = proceduralRacket.clone().multiply(localRacket[dominant].clone().invert());
      const elbowPreference = proceduralGrip.clone()
        .sub(grips[dominant].centre.clone().multiplyScalar(BODY_SCALE).applyQuaternion(desired))
        .addScaledVector(grips[dominant].forward.clone().applyQuaternion(desired), -arms[dominant].lengths[1])
        .add(new THREE.Vector3(0, -0.08, -0.04));
      reachArm(dominant, proceduralGrip, null, desired, elbowPreference);
      const arm = support === 'l' ? rig.leftArm : rig.rightArm;
      const forearm = support === 'l' ? rig.leftForearm : rig.rightForearm;
      const [, elbowHint] = ends(arm), [, relaxedWrist] = ends(forearm);
      reachArm(support, null, relaxedWrist, null, elbowHint);
    }

    // 2. Captured stroke motion blends over the whole body, arms included:
    //    the captured shoulder/elbow/wrist chain is kept, not re-solved.
    const LEG_BONES = ['thigh_l', 'calf_l', 'foot_l', 'thigh_r', 'calf_r', 'foot_r'];
    const steppingLegs = LEG_BONES.map(name => pose.bones.get(name)!.quaternion.clone());
    const capturedBody = playback ? capturedGroundstroke.apply(playback) : null;
    if (capturedBody) {
      // Keep the procedural running step during strokes so captured standing
      // legs do not slide across the court with the moving player.
      const running = THREE.MathUtils.smoothstep(
        Number(rig.root.userData.locomotionSpeed ?? 0),
        1.2,
        3,
      );
      if (running > 0) {
        LEG_BONES.forEach((name, i) => pose.bones.get(name)!.quaternion.slerp(steppingLegs[i], running));
        model.updateMatrixWorld(true);
      }
    }
    const strokeRoll = new THREE.Quaternion();
    if (capturedBody && playback) {
      if (playback.stroke === 'backhand' && !twoHanded) {
        strokeRoll.setFromAxisAngle(UP, (dominant === 'r' ? 1 : -1) * BACKHAND_FACE_ROLL * captureWeight);
      }
      const contact = rig.root.userData.contactTarget as ContactTarget | undefined;
      if (contact && playback.stroke !== 'serve') {
        const goal = new THREE.Vector3(...contact.point);
        if (correction?.key !== contact.key) {
          // Solve once per shot on the captured contact pose, then apply the
          // same chest/shoulder/elbow offsets (fading out away from contact) so
          // the stroke path shifts coherently instead of kinking at impact.
          const saved = [...pose.bones.values()].map((bone) =>
            [bone, bone.position.clone(), bone.quaternion.clone()] as const);
          capturedGroundstroke.apply({ ...playback, deltaSeconds: 0, weight: 1 });
          const fullRoll = playback.stroke === 'backhand' && !twoHanded
            ? new THREE.Quaternion().setFromAxisAngle(UP, (dominant === 'r' ? 1 : -1) * BACKHAND_FACE_ROLL)
            : new THREE.Quaternion();
          correction = { key: contact.key, ...solveCorrection(dominant, fullRoll, goal) };
          // A recorded contact the body cannot reach (bad sample, or a fixture
          // whose player is metres from the ball) must not contort the swing.
          if (racketHead(dominant, fullRoll).distanceTo(goal) > 0.45) {
            correction = {
              key: contact.key,
              spine: new THREE.Quaternion(),
              shoulder: new THREE.Quaternion(),
              elbow: 0,
            };
          }
          saved.forEach(([bone, position, quaternion]) => {
            bone.position.copy(position);
            bone.quaternion.copy(quaternion);
          });
          model.updateMatrixWorld(true);
        }
        const frames = Math.abs(playback.deltaSeconds) * 60;
        const weight = captureWeight * (1 - THREE.MathUtils.smoothstep(frames, 8, 20));
        if (weight > 0) {
          const identity = new THREE.Quaternion();
          turnSpine(fromParent('spine_01', identity.clone().slerp(correction.spine, weight)));
          pose.turn(
            `upperarm_${dominant}`,
            fromParent(`upperarm_${dominant}`, identity.clone().slerp(correction.shoulder, weight)),
          );
          bendElbow(dominant, correction.elbow * weight);
        }
      }
    }

    // 3. The racket is carried by the dominant hand; the hand never chases a
    //    separately animated racket.
    const handOrientation = pose.rotation(`hand_${dominant}`);
    rig.racket.quaternion.copy(
      handOrientation.clone().multiply(localRacket[dominant]).multiply(strokeRoll),
    ).normalize();
    rig.racket.position.copy(handGripPoint(dominant, handOrientation));
    grips[dominant].setClosed(true);
    grips[support].setClosed(twoHanded);
    if (twoHanded) {
      const racketRotation = rig.racket.quaternion.clone();
      const desired = racketRotation.clone()
        .multiply(new THREE.Quaternion().setFromAxisAngle(UP, Math.PI))
        .multiply(localRacket[support].clone().invert());
      const grip = rig.racket.position.clone().add(
        new THREE.Vector3(0, Number(rig.root.userData.supportGripOffset ?? 0.11), 0)
          .applyQuaternion(racketRotation),
      );
      const elbowPreference = grip.clone()
        .addScaledVector(grips[support].forward.clone().applyQuaternion(desired), -arms[support].lengths[1])
        .add(new THREE.Vector3(0, -0.12, -0.02));
      reachArm(support, grip, null, desired, elbowPreference);
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
        shoe.position.copy(new THREE.Vector3(0, -0.045, 0.05).applyQuaternion(shoe.quaternion).add(ankle));
      };
      // The legacy shoe groups use screen-space labels, opposite anatomical sides.
      placeCapturedShoe(rig.leftShoe, 'foot_r');
      placeCapturedShoe(rig.rightShoe, 'foot_l');
    }
    {
      // Keep both shoes behind the baseline until serve contact by moving the
      // whole body back, never by bending a leg.
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

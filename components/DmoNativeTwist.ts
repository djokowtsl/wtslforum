import * as THREE from 'three';

/**
 * Twist distribution for the continuous native body.
 *
 * The CC0 base mesh binds the whole forearm rigidly to `lowerarm_*` (weight 1.0
 * from just below the elbow to just above the wrist) and the whole upper arm to
 * `upperarm_*`. Any roll about a limb's own axis is therefore sheared entirely
 * into the narrow skin bands at the shoulder, elbow and wrist — the collapsed
 * armpits, flattened elbows and "candy-wrapper" wrists seen in replays.
 *
 * We add one helper bone per segment (`*_twist_*`) that coincides with its
 * parent at bind time, and fade the segment's skin weights onto it along the
 * limb. At runtime the anatomical bone keeps only its swing (or, for the
 * forearm, its pure elbow hinge) and the helper carries the roll, so the roll
 * is spread along the segment instead of being concentrated at a joint.
 * Final world orientations of the arm and hand are unchanged.
 */

type Side = 'l' | 'r';
const SIDES: Side[] = ['l', 'r'];

const SEGMENTS = [
  // [segment bone, its distal child, helper name, weight ramp start/end along the segment]
  { bone: 'upperarm', child: 'lowerarm', helper: 'upperarm_twist', ramp: [0.12, 0.85] as const },
  { bone: 'lowerarm', child: 'hand', helper: 'lowerarm_twist', ramp: [0.08, 0.9] as const },
  { bone: 'thigh', child: 'calf', helper: 'thigh_twist', ramp: [0.12, 0.85] as const },
];

const smooth = (x: number, a: number, b: number) => THREE.MathUtils.smoothstep(x, a, b);

/** Insert helper twist bones and reweight skin. Must run before garments are built. */
export function addNativeTwistBones(model: THREE.Group) {
  model.updateMatrixWorld(true);
  const bodies: THREE.SkinnedMesh[] = [];
  model.traverse(o => { if (o instanceof THREE.SkinnedMesh) bodies.push(o); });
  if (!bodies.length) return;
  const skeleton = bodies[0].skeleton;
  const bones = [...skeleton.bones];
  const inverses = skeleton.boneInverses.map(m => m.clone());
  const index = new Map(bones.map((b, i) => [b.name, i]));
  const plan: { segment: number; helper: number; start: THREE.Vector3; end: THREE.Vector3; ramp: readonly [number, number] }[] = [];
  for (const side of SIDES) {
    for (const seg of SEGMENTS) {
      const name = `${seg.bone}_${side}`, helperName = `${seg.helper}_${side}`;
      if (index.has(helperName)) continue;
      const parent = bones[index.get(name) ?? -1], child = bones[index.get(`${seg.child}_${side}`) ?? -1];
      if (!parent || !child) continue;
      const helper = new THREE.Bone();
      helper.name = helperName;
      parent.add(helper); // identity local transform: coincides with the segment at bind
      helper.updateMatrixWorld(true);
      const parentIndex = index.get(name)!;
      bones.push(helper);
      inverses.push(inverses[parentIndex].clone());
      index.set(helperName, bones.length - 1);
      // Joint positions in the mesh's bind space (inverse bind matrices map
      // bind space -> bone space, so invert to recover joint origins).
      const start = new THREE.Vector3().setFromMatrixPosition(inverses[parentIndex].clone().invert());
      const end = new THREE.Vector3().setFromMatrixPosition(inverses[index.get(`${seg.child}_${side}`)!].clone().invert());
      plan.push({ segment: parentIndex, helper: bones.length - 1, start, end, ramp: seg.ramp });
    }
  }
  const nextSkeleton = new THREE.Skeleton(bones, inverses);
  for (const body of bodies) {
    const geometry = body.geometry.clone();
    const position = geometry.getAttribute('position');
    const skinIndex = geometry.getAttribute('skinIndex');
    const skinWeight = geometry.getAttribute('skinWeight');
    const joints = new Uint16Array(skinIndex.count * 4);
    const weights = new Float32Array(skinWeight.count * 4);
    const point = new THREE.Vector3();
    for (let v = 0; v < position.count; v++) {
      point.fromBufferAttribute(position, v).applyMatrix4(body.bindMatrix);
      const entries = new Map<number, number>();
      for (let k = 0; k < 4; k++) {
        const w = skinWeight.getComponent(v, k);
        if (w > 0) {
          const j = skinIndex.getComponent(v, k);
          entries.set(j, (entries.get(j) ?? 0) + w);
        }
      }
      for (const step of plan) {
        const w = entries.get(step.segment);
        if (!w) continue;
        const axis = step.end.clone().sub(step.start);
        const t = point.clone().sub(step.start).dot(axis) / axis.lengthSq();
        const moved = w * smooth(t, step.ramp[0], step.ramp[1]);
        if (moved <= 1e-4) continue;
        entries.set(step.segment, w - moved);
        entries.set(step.helper, (entries.get(step.helper) ?? 0) + moved);
      }
      const strongest = [...entries].filter(([, w]) => w > 1e-5).sort((a, b) => b[1] - a[1]).slice(0, 4);
      const total = strongest.reduce((n, [, w]) => n + w, 0) || 1;
      for (let k = 0; k < 4; k++) {
        joints[v * 4 + k] = strongest[k]?.[0] ?? 0;
        weights[v * 4 + k] = (strongest[k]?.[1] ?? 0) / total;
      }
    }
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(joints, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
    body.geometry = geometry;
    body.bind(nextSkeleton, body.bindMatrix);
  }
}

function worldQ(o: THREE.Object3D) { return o.getWorldQuaternion(new THREE.Quaternion()); }

function setWorldQ(bone: THREE.Object3D, world: THREE.Quaternion) {
  bone.parent!.updateWorldMatrix(true, false);
  bone.quaternion.copy(worldQ(bone.parent!).invert().multiply(world));
  bone.updateMatrixWorld(true);
}

/** Signed rotation about unit `axis` contained in q (swing-twist decomposition). */
export function twistAngle(q: THREE.Quaternion, axis: THREE.Vector3) {
  const p = q.x * axis.x + q.y * axis.y + q.z * axis.z;
  const angle = 2 * Math.atan2(p, q.w);
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

export type TwistRest = Map<string, { local: THREE.Quaternion }>;

function helperOf(bone: THREE.Bone | undefined, name: string) {
  return bone?.children.find(c => c.name === name) as THREE.Bone | undefined;
}

/**
 * Split one segment's world orientation into a roll-free anatomical bone and a
 * helper that carries the roll. `reference` is the parent's FULL orientation.
 * Returns the removed roll (radians) about the segment axis.
 */
function splitSegment(
  bone: THREE.Bone, helper: THREE.Bone, restLocal: THREE.Quaternion, reference: THREE.Quaternion,
  axisLocal: THREE.Vector3, keepDescendants: THREE.Object3D[],
) {
  bone.updateWorldMatrix(true, true);
  const kept = keepDescendants.map(o => worldQ(o));
  const relative = reference.clone().invert().multiply(worldQ(bone)); // segment in its full parent frame
  const delta = restLocal.clone().invert().multiply(relative); // rest -> current, in the rest-bone frame
  const angle = twistAngle(delta, axisLocal);
  const roll = new THREE.Quaternion().setFromAxisAngle(axisLocal, angle);
  const swing = delta.multiply(roll.clone().invert());
  setWorldQ(bone, reference.clone().multiply(restLocal).multiply(swing));
  helper.quaternion.copy(roll);
  helper.updateMatrixWorld(true);
  keepDescendants.forEach((o, i) => setWorldQ(o, kept[i]));
  return angle;
}

/**
 * Move limb roll out of the anatomical upper-arm, forearm and thigh bones into
 * helper twist bones. Every joint position and the final world orientation of
 * each hand, forearm and shin are unchanged; only how skin follows them changes.
 */
export function distributeNativeTwist(bones: Map<string, THREE.Bone>, rest: TwistRest, sides: Side[] = SIDES) {
  for (const side of sides) {
    const clavicle = bones.get(`clavicle_${side}`), upper = bones.get(`upperarm_${side}`);
    const lower = bones.get(`lowerarm_${side}`), hand = bones.get(`hand_${side}`);
    const upperHelper = helperOf(upper, `upperarm_twist_${side}`), foreHelper = helperOf(lower, `lowerarm_twist_${side}`);
    if (clavicle && upper && lower && hand && upperHelper && foreHelper) {
      // Upper arm: shoulder skin follows the swing, elbow skin the full humeral roll.
      clavicle.updateWorldMatrix(true, false);
      const upperFull = worldQ(upper);
      splitSegment(upper, upperHelper, rest.get(upper.name)!.local, worldQ(clavicle),
        lower.position.clone().normalize(), [lower]);
      // Forearm: keep the bone a pure elbow hinge relative to the full upper arm;
      // all pronation (forearm + hand roll) fades along the forearm onto the helper.
      const axisLocal = hand.position.clone().normalize();
      const handWorld = worldQ(hand);
      lower.updateWorldMatrix(true, true);
      const relative = upperFull.clone().invert().multiply(worldQ(lower));
      const restLower = rest.get(lower.name)!.local;
      const delta = restLower.clone().invert().multiply(relative);
      const forearmRoll = twistAngle(delta, axisLocal);
      const swing = delta.multiply(new THREE.Quaternion().setFromAxisAngle(axisLocal, -forearmRoll));
      setWorldQ(lower, upperFull.clone().multiply(restLower).multiply(swing));
      const restHand = rest.get(hand.name)!.local;
      const handRelative = worldQ(lower).invert().multiply(handWorld);
      const handDelta = restHand.clone().invert().multiply(handRelative);
      const handAxis = axisLocal.clone().applyQuaternion(restHand.clone().invert());
      const pronation = twistAngle(handDelta, handAxis);
      foreHelper.quaternion.setFromAxisAngle(axisLocal, pronation * 0.9);
      foreHelper.updateMatrixWorld(true);
      setWorldQ(hand, handWorld);
    }
    const pelvis = bones.get('pelvis'), thigh = bones.get(`thigh_${side}`), calf = bones.get(`calf_${side}`);
    const thighHelper = helperOf(thigh, `thigh_twist_${side}`);
    if (pelvis && thigh && calf && thighHelper) {
      pelvis.updateWorldMatrix(true, false);
      splitSegment(thigh, thighHelper, rest.get(thigh.name)!.local, worldQ(pelvis),
        calf.position.clone().normalize(), [calf]);
    }
  }
}

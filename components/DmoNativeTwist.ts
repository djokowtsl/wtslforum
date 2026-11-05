import * as THREE from 'three';

/**
 * Twist distribution for the continuous native body.
 *
 * The source mesh binds the whole forearm and upper arm rigidly to their
 * anatomical bones. That concentrates roll deformation at the shoulders,
 * elbows, and wrists. Helper bones share that roll along the limb instead.
 */
type Side = 'l' | 'r';
const SIDES: Side[] = ['l', 'r'];

const SEGMENTS = [
  { bone: 'upperarm', child: 'lowerarm', helper: 'upperarm_twist', ramp: [0.12, 0.85] as const },
  { bone: 'lowerarm', child: 'hand', helper: 'lowerarm_twist', ramp: [0.08, 0.9] as const },
  { bone: 'thigh', child: 'calf', helper: 'thigh_twist', ramp: [0.12, 0.85] as const },
];

const smooth = (x: number, a: number, b: number) => THREE.MathUtils.smoothstep(x, a, b);

/** Insert helper bones and reweight the skin before garments are built. */
export function addNativeTwistBones(model: THREE.Group) {
  model.updateMatrixWorld(true);
  const bodies: THREE.SkinnedMesh[] = [];
  model.traverse(o => { if (o instanceof THREE.SkinnedMesh) bodies.push(o); });
  if (!bodies.length) return;
  const skeleton = bodies[0].skeleton;
  const bones = [...skeleton.bones];
  const inverses = skeleton.boneInverses.map(m => m.clone());
  const index = new Map(bones.map((bone, i) => [bone.name, i]));
  const plan: {
    segment: number;
    helper: number;
    start: THREE.Vector3;
    end: THREE.Vector3;
    ramp: readonly [number, number];
  }[] = [];
  for (const side of SIDES) {
    for (const segment of SEGMENTS) {
      const name = `${segment.bone}_${side}`;
      const helperName = `${segment.helper}_${side}`;
      if (index.has(helperName)) continue;
      const parent = bones[index.get(name) ?? -1];
      const child = bones[index.get(`${segment.child}_${side}`) ?? -1];
      if (!parent || !child) continue;
      const helper = new THREE.Bone();
      helper.name = helperName;
      parent.add(helper);
      helper.updateMatrixWorld(true);
      const parentIndex = index.get(name)!;
      bones.push(helper);
      inverses.push(inverses[parentIndex].clone());
      index.set(helperName, bones.length - 1);
      const start = new THREE.Vector3()
        .setFromMatrixPosition(inverses[parentIndex].clone().invert());
      const end = new THREE.Vector3().setFromMatrixPosition(
        inverses[index.get(`${segment.child}_${side}`)!].clone().invert(),
      );
      plan.push({ segment: parentIndex, helper: bones.length - 1, start, end, ramp: segment.ramp });
    }
  }
  if (!plan.length) return;
  const nextSkeleton = new THREE.Skeleton(bones, inverses);
  for (const body of bodies) {
    const geometry = body.geometry.clone();
    const position = geometry.getAttribute('position');
    const skinIndex = geometry.getAttribute('skinIndex');
    const skinWeight = geometry.getAttribute('skinWeight');
    const joints = new Uint16Array(skinIndex.count * 4);
    const weights = new Float32Array(skinWeight.count * 4);
    const point = new THREE.Vector3();
    for (let vertex = 0; vertex < position.count; vertex++) {
      point.fromBufferAttribute(position, vertex).applyMatrix4(body.bindMatrix);
      const entries = new Map<number, number>();
      for (let slot = 0; slot < 4; slot++) {
        const weight = skinWeight.getComponent(vertex, slot);
        if (weight > 0) {
          const joint = skinIndex.getComponent(vertex, slot);
          entries.set(joint, (entries.get(joint) ?? 0) + weight);
        }
      }
      for (const step of plan) {
        const weight = entries.get(step.segment);
        if (!weight) continue;
        const axis = step.end.clone().sub(step.start);
        const t = point.clone().sub(step.start).dot(axis) / axis.lengthSq();
        const moved = weight * smooth(t, step.ramp[0], step.ramp[1]);
        if (moved <= 1e-4) continue;
        entries.set(step.segment, weight - moved);
        entries.set(step.helper, (entries.get(step.helper) ?? 0) + moved);
      }
      const strongest = [...entries].filter(([, weight]) => weight > 1e-5)
        .sort((a, b) => b[1] - a[1]).slice(0, 4);
      const total = strongest.reduce((sum, [, weight]) => sum + weight, 0) || 1;
      for (let slot = 0; slot < 4; slot++) {
        joints[vertex * 4 + slot] = strongest[slot]?.[0] ?? 0;
        weights[vertex * 4 + slot] = (strongest[slot]?.[1] ?? 0) / total;
      }
    }
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(joints, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
    body.geometry = geometry;
    body.bind(nextSkeleton, body.bindMatrix);
  }
}

function worldQ(object: THREE.Object3D) {
  return object.getWorldQuaternion(new THREE.Quaternion());
}

function setWorldQ(bone: THREE.Object3D, world: THREE.Quaternion) {
  bone.parent!.updateWorldMatrix(true, false);
  bone.quaternion.copy(worldQ(bone.parent!).invert().multiply(world));
  bone.updateMatrixWorld(true);
}

/** Signed rotation about unit `axis` contained in q (swing-twist decomposition). */
export function twistAngle(q: THREE.Quaternion, axis: THREE.Vector3) {
  const projection = q.x * axis.x + q.y * axis.y + q.z * axis.z;
  const angle = 2 * Math.atan2(projection, q.w);
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

export type TwistRest = Map<string, { local: THREE.Quaternion }>;

function helperOf(bone: THREE.Bone | undefined, name: string) {
  return bone?.children.find(child => child.name === name) as THREE.Bone | undefined;
}

/** Split segment roll onto its helper while preserving descendant world poses. */
function splitSegment(
  bone: THREE.Bone,
  helper: THREE.Bone,
  restLocal: THREE.Quaternion,
  reference: THREE.Quaternion,
  axisLocal: THREE.Vector3,
  keepDescendants: THREE.Object3D[],
) {
  bone.updateWorldMatrix(true, true);
  const kept = keepDescendants.map(object => worldQ(object));
  const relative = reference.clone().invert().multiply(worldQ(bone));
  const delta = restLocal.clone().invert().multiply(relative);
  const angle = twistAngle(delta, axisLocal);
  const roll = new THREE.Quaternion().setFromAxisAngle(axisLocal, angle);
  const swing = delta.multiply(roll.clone().invert());
  setWorldQ(bone, reference.clone().multiply(restLocal).multiply(swing));
  helper.quaternion.copy(roll);
  helper.updateMatrixWorld(true);
  keepDescendants.forEach((object, i) => setWorldQ(object, kept[i]));
  return angle;
}

/**
 * Distribute arm and thigh roll after the complete pose has been applied.
 * Joint positions and end-effector orientations remain unchanged.
 */
export function distributeNativeTwist(
  bones: Map<string, THREE.Bone>,
  rest: TwistRest,
  sides: Side[] = SIDES,
) {
  for (const side of sides) {
    const clavicle = bones.get(`clavicle_${side}`);
    const upper = bones.get(`upperarm_${side}`);
    const lower = bones.get(`lowerarm_${side}`);
    const hand = bones.get(`hand_${side}`);
    const upperHelper = helperOf(upper, `upperarm_twist_${side}`);
    const forearmHelper = helperOf(lower, `lowerarm_twist_${side}`);
    if (clavicle && upper && lower && hand && upperHelper && forearmHelper) {
      clavicle.updateWorldMatrix(true, false);
      const upperFull = worldQ(upper);
      splitSegment(upper, upperHelper, rest.get(upper.name)!.local, worldQ(clavicle),
        lower.position.clone().normalize(), [lower]);
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
      forearmHelper.quaternion.setFromAxisAngle(axisLocal, pronation * 0.9);
      forearmHelper.updateMatrixWorld(true);
      setWorldQ(hand, handWorld);
    }
    const pelvis = bones.get('pelvis');
    const thigh = bones.get(`thigh_${side}`);
    const calf = bones.get(`calf_${side}`);
    const thighHelper = helperOf(thigh, `thigh_twist_${side}`);
    if (pelvis && thigh && calf && thighHelper) {
      pelvis.updateWorldMatrix(true, false);
      splitSegment(thigh, thighHelper, rest.get(thigh.name)!.local, worldQ(pelvis),
        calf.position.clone().normalize(), [calf]);
    }
  }
}

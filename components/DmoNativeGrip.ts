import * as THREE from 'three';

/** A grasp authored on the body's own fingers; no replacement hand geometry. */
export function makeNativeGrip(bones: Map<string, THREE.Bone>, side: 'l' | 'r') {
  const hand = bones.get(`hand_${side}`)!;
  hand.updateWorldMatrix(true, true);
  const index = bones.get(`index_01_${side}`)!.position.clone();
  const pinky = bones.get(`pinky_01_${side}`)!.position.clone();
  const knuckle = bones.get(`middle_01_${side}`)!.position.clone();
  const forward = knuckle.clone().normalize();
  const across = index.sub(pinky);
  across.addScaledVector(forward, -across.dot(forward)).normalize();
  const palm = new THREE.Vector3().crossVectors(across, forward).normalize();
  const middle = [1, 2, 3].map(i =>
    hand.worldToLocal(bones.get(`middle_0${i}_${side}`)!.getWorldPosition(new THREE.Vector3())));
  const naturalCurl = middle[2].clone().sub(middle[1]).normalize()
    .sub(middle[1].clone().sub(middle[0]).normalize());
  if (naturalCurl.dot(palm) < 0) palm.negate();
  const centre = knuckle.clone().addScaledVector(forward, -0.008).addScaledVector(palm, 0.035);
  const shaft = across.clone().multiplyScalar(0.94).addScaledVector(forward, 0.34).normalize();
  const fingerBones = [...bones].filter(([name]) => /^(index|middle|ring|pinky|thumb)_/.test(name) && name.endsWith(`_${side}`))
    .map(([, bone]) => bone);
  const open = fingerBones.map(b => b.quaternion.clone());
  for (const digit of ['index', 'middle', 'ring', 'pinky']) {
    const joints = [1, 2, 3].map(i => bones.get(`${digit}_0${i}_${side}`)!);
    const rest = joints.map(b => b.quaternion.clone());
    const axes = joints.map(b => {
      const rotation = b.getWorldQuaternion(new THREE.Quaternion());
      const direction = new THREE.Vector3(0, 1, 0).applyQuaternion(rotation);
      const normal = palm.clone().applyQuaternion(hand.getWorldQuaternion(new THREE.Quaternion()));
      return new THREE.Vector3().crossVectors(direction, normal).normalize().applyQuaternion(rotation.invert());
    });
    const tip = new THREE.Object3D();
    tip.position.set(0, digit === 'pinky' ? 0.016 : 0.022, 0);
    joints[2].add(tip);
    const apply = (angles: number[]) => {
      joints.forEach((bone, i) => bone.quaternion.copy(rest[i])
        .multiply(new THREE.Quaternion().setFromAxisAngle(axes[i], angles[i])));
      hand.updateWorldMatrix(true, true);
    };
    let best = Infinity, angles = [0.65, 1.1, 0.65];
    for (let a = 0.35; a <= 1.55; a += 0.2) for (let b = 0.55; b <= 1.75; b += 0.2) for (let c = 0.25; c <= 1.05; c += 0.2) {
      if (b < a || c > b * 0.8) continue;
      apply([a, b, c]);
      const points = [...joints, tip].map(j => hand.worldToLocal(j.getWorldPosition(new THREE.Vector3())));
      let score = 0;
      for (let i = 0; i < 3; i++) for (const t of [0.25, 0.5, 0.75, 1]) {
        const offset = points[i].clone().lerp(points[i + 1], t).sub(centre);
        const radius = offset.addScaledVector(shaft, -THREE.MathUtils.clamp(offset.dot(shaft), -0.045, 0.135)).length();
        score += 2000 * Math.max(0, 0.025 - radius) ** 2 + (i > 0 ? 8 * (radius - 0.027) ** 2 : 0);
      }
      score += 0.0002 * ((a - 0.6) ** 2 + (b - 1.1) ** 2 + (c - 0.6) ** 2);
      if (score < best) { best = score; angles = [a, b, c]; }
    }
    apply(angles);
    joints[2].remove(tip);
  }
  const thumb = [1, 2, 3].map(i => bones.get(`thumb_0${i}_${side}`)!);
  const tip = new THREE.Object3D(); tip.position.set(0, 0.025, 0); thumb[2].add(tip);
  const offset = thumb[0].position.clone().sub(centre);
  const along = THREE.MathUtils.clamp(offset.dot(shaft), -0.045, 0.105);
  const radial = offset.addScaledVector(shaft, -offset.dot(shaft)).normalize();
  const thumbContact = centre.clone().addScaledVector(shaft, along).addScaledVector(radial, 0.024);
  const target = hand.localToWorld(thumbContact.clone());
  for (let iteration = 0; iteration < 8; iteration++) for (const joint of [...thumb].reverse()) {
    hand.updateWorldMatrix(true, true);
    const pivot = joint.getWorldPosition(new THREE.Vector3());
    const delta = new THREE.Quaternion().setFromUnitVectors(
      tip.getWorldPosition(new THREE.Vector3()).sub(pivot).normalize(), target.clone().sub(pivot).normalize(),
    );
    const angle = delta.angleTo(new THREE.Quaternion());
    if (angle > 0.25) delta.slerp(new THREE.Quaternion(), 1 - 0.25 / angle);
    const world = joint.getWorldQuaternion(new THREE.Quaternion()).premultiply(delta);
    joint.quaternion.copy(joint.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world));
  }
  thumb[2].remove(tip);
  const closed = fingerBones.map(b => b.quaternion.clone());
  let isClosed = true;
  return {
    hand, centre, shaft, palm, forward,
    setClosed(value: boolean) {
      if (value === isClosed) return;
      fingerBones.forEach((bone, i) => bone.quaternion.copy((value ? closed : open)[i]));
      isClosed = value;
    },
  };
}

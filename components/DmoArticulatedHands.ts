import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { PlayerRig } from './DmoLiveCourt3DScene';

// WebXR generic-hand, MIT, immersive-web/webxr-input-profiles. All 25 joints
// are retained. Finger closure below is an authored joint pose, not mesh folding.
export async function loadArticulatedHand(signal: AbortSignal, base = '/models/dmo-humans') {
  const response = await fetch(`${base}/articulated-hand.glb`, { signal });
  if (!response.ok) throw new Error(`Articulated hand request failed (${response.status}).`);
  const gltf = await new GLTFLoader().parseAsync(await response.arrayBuffer(), '');
  return gltf.scene;
}

const canonical = new THREE.Matrix4().makeBasis(
  new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, 0, 0),
);
const toHand = new THREE.Quaternion().setFromRotationMatrix(canonical);
const fromHand = toHand.clone().invert();
const prefixes = ['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'];
type GripTarget = { center: THREE.Vector3; shaft: THREE.Vector3; radius: number };

const defaultGrip: GripTarget = {
  center: new THREE.Vector3(0, 0.075, -0.035),
  shaft: new THREE.Vector3(0, 1, 0),
  radius: 0.019,
};
const preferredBends: Record<string, [number, number, number]> = {
  'index-finger': [0.18, 0.3, 0.2],
  'middle-finger': [0.2, 0.32, 0.22],
  'ring-finger': [0.24, 0.36, 0.22],
  'pinky-finger': [0.28, 0.38, 0.2],
};
const preferredAdduction: Record<string, number> = {
  'index-finger': 0.1,
  'middle-finger': 0,
  'ring-finger': 0.15,
  'pinky-finger': 0.4,
};

function distanceToShaft(point: THREE.Vector3, center: THREE.Vector3, shaft: THREE.Vector3) {
  const offset = point.clone().sub(center);
  return offset.addScaledVector(shaft, -offset.dot(shaft)).length();
}

function sameGrip(a: GripTarget | undefined, b: GripTarget) {
  return !!a
    && a.center.distanceToSquared(b.center) <= 1e-8
    && a.shaft.distanceToSquared(b.shaft) <= 1e-8
    && Math.abs(a.radius - b.radius) <= 1e-4;
}

function fitFinger(
  base: THREE.Vector3,
  segments: THREE.Vector3[],
  center: THREE.Vector3,
  shaft: THREE.Vector3,
  bendAxis: THREE.Vector3,
  adductionAxis: THREE.Vector3,
  side: number,
  radius: number,
  preferred: [number, number, number],
  preferredAdduct: number,
) {
  const targetRadius = radius + 0.006;
  let bestScore = Infinity;
  let best = { angles: preferred, adduction: preferredAdduct };
  for (let adduction = 0; adduction <= 0.8; adduction += 0.1) {
    for (let a = 0.05; a <= 1.2; a += 0.1) {
      for (let b = 0.05; b <= 1.4; b += 0.1) {
        for (let c = 0.05; c <= 0.9; c += 0.1) {
          if (b < a * 0.8 || c > b * 0.9) continue;
          const angles: [number, number, number] = [a, b, c];
          let point = base.clone();
          let flexionAngle = 0;
          let score = 0;
          for (let i = 0; i < 3; i++) {
            flexionAngle -= angles[i];
            const adductionAngle = side * adduction * [0.4, 0.75, 1][i];
            const direction = segments[i].clone()
              .applyAxisAngle(adductionAxis, adductionAngle)
              .applyAxisAngle(bendAxis, flexionAngle);
            for (const fraction of [0.25, 0.5, 0.75, 1]) {
              const distance = distanceToShaft(
                point.clone().addScaledVector(direction, fraction), center, shaft,
              );
              const penetration = Math.max(0, targetRadius - distance);
              const gap = Math.max(0, distance - targetRadius);
              score += 500 * penetration ** 2 + 2 * gap ** 2;
            }
            point.add(direction);
          }
          score += 0.004 * angles.reduce((sum, value, index) => sum + (value - preferred[index]) ** 2, 0);
          score += 0.002 * (adduction - preferredAdduct) ** 2;
          if (score < bestScore) {
            bestScore = score;
            best = { angles, adduction };
          }
        }
      }
    }
  }
  return best;
}

export function makeArticulatedHand(template: THREE.Group, left: boolean) {
  const model = clone(template) as THREE.Group;
  const wrist = model.getObjectByName('wrist');
  if (!(wrist instanceof THREE.Bone)) throw new Error('Articulated hand has no wrist joint.');
  const origin = wrist.position.clone();
  const joints = new Map<string, { bone: THREE.Bone; position: THREE.Vector3; rotation: THREE.Quaternion; point: THREE.Vector3 }>();
  model.traverse(object => {
    if (object instanceof THREE.Bone) joints.set(object.name, {
      bone: object, position: object.position.clone(), rotation: object.quaternion.clone(),
      point: object.position.clone().sub(origin).applyQuaternion(toHand),
    });
    if (object instanceof THREE.SkinnedMesh) {
      object.geometry = object.geometry.clone();
      object.material = new THREE.MeshStandardMaterial({ color: 0xd7ae91, roughness: 0.72, metalness: 0 });
      object.castShadow = true; object.receiveShadow = true; object.frustumCulled = false;
    }
  });
  if (joints.size !== 25) throw new Error('Articulated hand requires all 25 finger joints.');
  const root = new THREE.Group();
  root.name = left ? 'articulated-left-hand' : 'articulated-right-hand';
  const space = new THREE.Group();
  space.quaternion.copy(toHand);
  space.position.copy(origin).applyQuaternion(toHand).negate();
  root.add(space); space.add(model);
  // A reflected right-hand mesh supplies the anatomically mirrored left hand.
  const mirror = new THREE.Group();
  mirror.scale.x = left ? -1 : 1;
  mirror.add(root);
  mirror.name = root.name;
  const target = new THREE.Vector3(), delta = new THREE.Quaternion();
  function segment(name: string, point: THREE.Vector3, originalDirection: THREE.Vector3, direction: THREE.Vector3) {
    const j = joints.get(name)!;
    target.copy(point).applyQuaternion(fromHand).add(origin);
    j.bone.position.copy(target);
    delta.setFromUnitVectors(originalDirection.clone().normalize(), direction.clone().normalize());
    delta.premultiply(fromHand).multiply(toHand);
    j.bone.quaternion.copy(delta).multiply(j.rotation);
  }
  let gripping: boolean | undefined;
  let previousGrip: GripTarget | undefined;
  let cachedGrip: GripTarget | undefined;
  let cachedClosedPose: Array<{
    bone: THREE.Bone; position: THREE.Vector3; rotation: THREE.Quaternion;
  }> | undefined;
  const setGrip = (closed: boolean, grip?: GripTarget) => {
    const nextGrip = {
      center: grip?.center.clone() ?? defaultGrip.center.clone(),
      shaft: grip?.shaft.clone() ?? defaultGrip.shaft.clone(),
      radius: Number.isFinite(grip?.radius) ? Math.max(0.008, grip!.radius) : defaultGrip.radius,
    };
    if (nextGrip.shaft.lengthSq() < 1e-8) nextGrip.shaft.copy(defaultGrip.shaft);
    nextGrip.shaft.normalize();
    const gripChanged = !sameGrip(previousGrip, nextGrip);
    if (gripping === closed && (!closed || !gripChanged)) return;
    gripping = closed;
    if (!closed) {
      previousGrip = undefined;
      joints.forEach(j => { j.bone.position.copy(j.position); j.bone.quaternion.copy(j.rotation); });
      model.updateMatrixWorld(true);
      model.traverse(o => { if (o instanceof THREE.SkinnedMesh) o.skeleton.update(); });
      return;
    }
    previousGrip = nextGrip;
    if (sameGrip(cachedGrip, nextGrip) && cachedClosedPose) {
      cachedClosedPose.forEach(j => {
        j.bone.position.copy(j.position);
        j.bone.quaternion.copy(j.rotation);
      });
      model.updateMatrixWorld(true);
      model.traverse(o => { if (o instanceof THREE.SkinnedMesh) o.skeleton.update(); });
      return;
    }
    joints.forEach(j => { j.bone.position.copy(j.position); j.bone.quaternion.copy(j.rotation); });
    {
      const { center, shaft, radius } = nextGrip;
      const bendAxis = new THREE.Vector3(1, 0, 0)
        .addScaledVector(shaft, -shaft.x);
      const adductionAxis = new THREE.Vector3(0, 0, 1)
        .addScaledVector(shaft, -shaft.z);
      if (bendAxis.lengthSq() < 1e-8) {
        bendAxis.set(0, 0, 1).addScaledVector(shaft, -shaft.z);
      }
      if (adductionAxis.lengthSq() < 1e-8) {
        adductionAxis.set(1, 0, 0).addScaledVector(shaft, -shaft.x);
      }
      bendAxis.normalize();
      adductionAxis.normalize();
      const fingerSide = new THREE.Vector3();
      for (const prefix of prefixes) {
        const base = joints.get(`${prefix}-phalanx-proximal`)!.point;
        const radial = base.clone().sub(center);
        radial.addScaledVector(shaft, -radial.dot(shaft));
        fingerSide.add(radial);
      }
      if (fingerSide.lengthSq() < 1e-8) fingerSide.set(0, 0, 1);
      fingerSide.normalize();
      for (const prefix of prefixes) {
        const names = ['phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'].map(s => `${prefix}-${s}`);
        let point = joints.get(names[0])!.point.clone();
        const segments = names.slice(0, 3).map((name, i) =>
          joints.get(names[i + 1])!.point.clone().sub(joints.get(name)!.point));
        const side = Math.sign(point.x - center.x);
        const fit = fitFinger(
          point, segments, center, shaft, bendAxis, adductionAxis, side, radius,
          preferredBends[prefix], preferredAdduction[prefix],
        );
        let angle = 0;
        for (let i = 0; i < 3; i++) {
          const source = segments[i];
          angle -= fit.angles[i];
          const adductionAngle = side * fit.adduction * [0.4, 0.75, 1][i];
          const direction = source.clone()
            .applyAxisAngle(adductionAxis, adductionAngle)
            .applyAxisAngle(bendAxis, angle);
          segment(names[i], point, source, direction);
          point = point.clone().add(direction);
        }
        const tip = joints.get(names[3])!;
        tip.bone.position.copy(point).applyQuaternion(fromHand).add(origin);
      }
      const thumb = ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'];
      const thumbPoints = thumb.map(name => joints.get(name)!.point.clone());
      const thumbLengths = thumbPoints.slice(0, 3).map((point, i) => point.distanceTo(thumbPoints[i + 1]));
      const thumbBase = thumbPoints[0].clone();
      const thumbAlong = THREE.MathUtils.clamp(thumbBase.clone().sub(center).dot(shaft), -0.045, 0.105);
      const thumbTarget = center.clone()
        .addScaledVector(shaft, thumbAlong)
        .addScaledVector(fingerSide.clone().negate(), radius + 0.006);
      const reach = thumbTarget.distanceTo(thumbBase);
      const totalLength = thumbLengths.reduce((sum, value) => sum + value, 0);
      if (reach >= totalLength) {
        const reachDirection = thumbTarget.clone().sub(thumbBase).normalize();
        thumbTarget.copy(thumbBase).addScaledVector(reachDirection, totalLength - 1e-4);
      }
      const solvedThumb = thumbPoints.map(point => point.clone());
      for (let iteration = 0; iteration < 16; iteration++) {
        solvedThumb[3].copy(thumbTarget);
        for (let i = 2; i >= 0; i--) {
          const direction = solvedThumb[i].clone().sub(solvedThumb[i + 1]);
          if (direction.lengthSq() < 1e-8) direction.set(0, 1, 0);
          solvedThumb[i].copy(solvedThumb[i + 1]).addScaledVector(direction.normalize(), thumbLengths[i]);
        }
        solvedThumb[0].copy(thumbBase);
        for (let i = 0; i < 3; i++) {
          const direction = solvedThumb[i + 1].clone().sub(solvedThumb[i]);
          if (direction.lengthSq() < 1e-8) direction.set(0, 1, 0);
          solvedThumb[i + 1].copy(solvedThumb[i]).addScaledVector(direction.normalize(), thumbLengths[i]);
        }
      }
      let point = solvedThumb[0].clone();
      for (let i = 0; i < 3; i++) {
        const source = thumbPoints[i + 1].clone().sub(thumbPoints[i]);
        const direction = solvedThumb[i + 1].clone().sub(solvedThumb[i]);
        segment(thumb[i], point, source, direction);
        point = solvedThumb[i + 1].clone();
      }
      joints.get('thumb-tip')!.bone.position.copy(point).applyQuaternion(fromHand).add(origin);
    }
    model.updateMatrixWorld(true);
    model.traverse(o => { if (o instanceof THREE.SkinnedMesh) o.skeleton.update(); });
    cachedGrip = {
      center: nextGrip.center.clone(),
      shaft: nextGrip.shaft.clone(),
      radius: nextGrip.radius,
    };
    cachedClosedPose = [...joints.values()].map(j => ({
      bone: j.bone,
      position: j.bone.position.clone(),
      rotation: j.bone.quaternion.clone(),
    }));
  };
  setGrip(false);
  return { root: mirror, model, setGrip, joints };
}

export function attachArticulatedHands(template: THREE.Group, rig: PlayerRig, body: THREE.Group) {
  const hands = [makeArticulatedHand(template, true), makeArticulatedHand(template, false)];
  hands.forEach(hand => rig.root.add(hand.root));
  const inverse = new THREE.Quaternion(), rotation = new THREE.Quaternion(), position = new THREE.Vector3();
  const racketRotation = new THREE.Quaternion();
  const gripWorld = new THREE.Vector3(), shaftWorld = new THREE.Vector3(), shaftEndWorld = new THREE.Vector3();
  const gripRadius = (() => {
    const tape = rig.racket.getObjectByName('racket-grip-tape');
    if (tape instanceof THREE.Mesh && tape.geometry instanceof THREE.CylinderGeometry) {
      return Math.max(tape.geometry.parameters.radiusTop, tape.geometry.parameters.radiusBottom);
    }
    return defaultGrip.radius;
  })();
  return () => {
    rig.root.updateMatrixWorld(true);
    rig.root.getWorldQuaternion(inverse).invert();
    rig.racket.getWorldPosition(gripWorld);
    rig.racket.getWorldQuaternion(racketRotation);
    shaftWorld.set(0, 1, 0).applyQuaternion(racketRotation).normalize();
    hands.forEach((hand, i) => {
      const left = i === 0;
      const wrist = body.getObjectByName(left ? 'LeftHand' : 'RightHand')!;
      wrist.getWorldPosition(position);
      hand.root.position.copy(rig.root.worldToLocal(position));
      wrist.getWorldQuaternion(rotation);
      hand.root.quaternion.copy(inverse).multiply(rotation);
      hand.root.updateMatrixWorld(true);
      const gripCenter = hand.root.worldToLocal(gripWorld.clone());
      shaftEndWorld.copy(gripWorld).add(shaftWorld);
      const gripShaft = hand.root.worldToLocal(shaftEndWorld).sub(gripCenter).normalize();
      hand.setGrip(
        left === (rig.root.userData.dominantHandedness === 'left') || !!rig.root.userData.twoHandedGrip,
        { center: gripCenter, shaft: gripShaft, radius: gripRadius },
      );
    });
  };
}

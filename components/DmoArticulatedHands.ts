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
  // A tennis sweatband covers the authored mesh-to-body wrist seam.
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.029, 0.030, 0.035, 24, 1, true),
    new THREE.MeshStandardMaterial({ color: 0xe5e3d8, roughness: 1, side: THREE.DoubleSide }));
  band.position.y = -0.008;
  band.name = 'cotton-wristband';
  root.add(band);
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
  const setGrip = (closed: boolean) => {
    if (gripping === closed) return;
    gripping = closed;
    joints.forEach(j => { j.bone.position.copy(j.position); j.bone.quaternion.copy(j.rotation); });
    if (closed) {
      for (const prefix of prefixes) {
        const names = ['phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'].map(s => `${prefix}-${s}`);
        let point = joints.get(names[0])!.point.clone();
        let angle = 0;
        for (let i = 0; i < 3; i++) {
          const source = joints.get(names[i + 1])!.point.clone().sub(joints.get(names[i])!.point);
          angle += [-1.2, -1.3, -0.5][i];
          const direction = source.clone().applyAxisAngle(new THREE.Vector3(1, 0, 0), angle);
          segment(names[i], point, source, direction);
          point = point.clone().add(direction);
        }
        const tip = joints.get(names[3])!;
        tip.bone.position.copy(point).applyQuaternion(fromHand).add(origin);
      }
      const thumb = ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'];
      let point = joints.get(thumb[0])!.point.clone();
      const aims = [
        new THREE.Vector3(-0.025, 0.060, -0.004),
        new THREE.Vector3(-0.010, 0.078, -0.010),
        new THREE.Vector3(0.005, 0.080, -0.026),
      ];
      for (let i = 0; i < 3; i++) {
        const source = joints.get(thumb[i + 1])!.point.clone().sub(joints.get(thumb[i])!.point);
        const direction = aims[i].clone().sub(point).normalize().multiplyScalar(source.length());
        segment(thumb[i], point, source, direction);
        point = point.clone().add(direction);
      }
      joints.get('thumb-tip')!.bone.position.copy(point).applyQuaternion(fromHand).add(origin);
    }
    model.updateMatrixWorld(true);
    model.traverse(o => { if (o instanceof THREE.SkinnedMesh) o.skeleton.update(); });
  };
  setGrip(false);
  return { root: mirror, model, setGrip, joints };
}

export function attachArticulatedHands(template: THREE.Group, rig: PlayerRig, body: THREE.Group) {
  const hands = [makeArticulatedHand(template, true), makeArticulatedHand(template, false)];
  hands.forEach(hand => rig.root.add(hand.root));
  const inverse = new THREE.Quaternion(), rotation = new THREE.Quaternion(), position = new THREE.Vector3();
  return () => {
    rig.root.getWorldQuaternion(inverse).invert();
    hands.forEach((hand, i) => {
      const left = i === 0;
      const wrist = body.getObjectByName(left ? 'LeftHand' : 'RightHand')!;
      wrist.getWorldPosition(position);
      hand.root.position.copy(rig.root.worldToLocal(position));
      wrist.getWorldQuaternion(rotation);
      hand.root.quaternion.copy(inverse).multiply(rotation);
      hand.setGrip(left === (rig.root.userData.dominantHandedness === 'left') || !!rig.root.userData.twoHandedGrip);
    });
  };
}

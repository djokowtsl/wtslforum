import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SimplifyModifier } from 'three/examples/jsm/modifiers/SimplifyModifier.js';

let anatomicalHand: THREE.BufferGeometry | undefined;
const handGeometryCache = new Map<string, THREE.BufferGeometry>();
export type CrowdHandFit = {
  center: THREE.Vector3;
  halfWidth: number;
  halfThickness: number;
};
let wristShape = { x: 0, y: 0, halfWidth: 0.02, halfThickness: 0.015 };

export function getSeatedCrowdHandTargets(side: number, applauding: boolean) {
  const sign = side < 0 ? -1 : 1;
  const wrist = applauding
    ? new THREE.Vector3(sign * 0.04, 1.14, 0.28)
    : new THREE.Vector3(sign * 0.19, 0.57, 0.26);
  const tip = wrist.clone().add(applauding
    ? new THREE.Vector3(0, 0.075, 0.02)
    : new THREE.Vector3(-sign * 0.09, -0.006, 0.005));
  return { wrist, tip };
}

export function getSeatedCrowdHandFrame(side: number, applauding: boolean) {
  const { wrist, tip } = getSeatedCrowdHandTargets(side, applauding);
  const direction = tip.sub(wrist).normalize();
  // Resting fingertips point across the lap with palms down. Raised clapping
  // fingers point up and their palms face each other.
  const width = new THREE.Vector3(0, 0, -1)
    .addScaledVector(direction, direction.z).normalize();
  const normal = direction.clone().cross(width).normalize();
  const palmDirection = applauding
    ? new THREE.Vector3(-side, 0, 0)
    : new THREE.Vector3(0, -1, 0);
  if (normal.dot(palmDirection) < 0) normal.negate();
  return { direction, width, normal };
}

export function refineCrowdForearms(
  geometry: THREE.BufferGeometry,
  skeleton: THREE.Skeleton,
  fits: CrowdHandFit[],
  applauding: boolean,
) {
  const positions = geometry.getAttribute('position');
  const skinIndex = geometry.getAttribute('skinIndex');
  const skinWeight = geometry.getAttribute('skinWeight');
  const boneIds = ['LeftForeArm', 'RightForeArm'].map(name =>
    skeleton.bones.findIndex(bone => bone.name === name));
  fits.forEach(fit => {
    fit.halfWidth = THREE.MathUtils.clamp(fit.halfWidth * 0.85, 0.021, 0.026);
    fit.halfThickness = THREE.MathUtils.clamp(fit.halfThickness * 0.85, 0.016, 0.021);
  });
  for (let i = 0; i < positions.count; i++) {
    let handIndex = -1, influence = 0;
    for (let c = 0; c < 4; c++) {
      const candidate = boneIds.indexOf(skinIndex.getComponent(i, c));
      if (candidate >= 0 && skinWeight.getComponent(i, c) > influence) {
        handIndex = candidate;
        influence = skinWeight.getComponent(i, c);
      }
    }
    if (handIndex < 0 || influence < 0.1) continue;
    const side = handIndex === 0 ? 1 : -1;
    const fit = fits[handIndex];
    const elbow = applauding
      ? new THREE.Vector3(side * 0.2, 0.98, 0.22)
      : new THREE.Vector3(side * 0.23, 0.76, 0.08);
    const axis = fit.center.clone().sub(elbow);
    const point = new THREE.Vector3().fromBufferAttribute(positions, i);
    const t = point.clone().sub(elbow).dot(axis) / axis.lengthSq();
    if (t < 0 || t > 1.08) continue;
    const { width: handWidth } = getSeatedCrowdHandFrame(side, applauding);
    const width = handWidth.addScaledVector(axis, -handWidth.dot(axis) / axis.lengthSq()).normalize();
    const normal = axis.clone().normalize().cross(width).normalize();
    const center = elbow.clone().addScaledVector(axis, t);
    const radial = point.clone().sub(center);
    const x = radial.dot(width), y = radial.dot(normal);
    const radiusX = fit.halfWidth * THREE.MathUtils.lerp(1.5, 1, THREE.MathUtils.clamp(t, 0, 1));
    const radiusY = fit.halfThickness * THREE.MathUtils.lerp(1.6, 1, THREE.MathUtils.clamp(t, 0, 1));
    const factor = Math.hypot(x / radiusX, y / radiusY);
    if (factor < 1e-5) continue;
    const target = center.addScaledVector(width, x / factor).addScaledVector(normal, y / factor);
    point.lerp(target, Math.min(1, influence * 2) * THREE.MathUtils.smoothstep(t, 0, 0.25));
    positions.setXYZ(i, point.x, point.y, point.z);
  }
}

/** Bake the existing MIT-licensed WebXR anatomical hand, not primitive fingers. */
export async function prepareCrowdHandGeometry(template: THREE.Group) {
  template.updateMatrixWorld(true);
  const wrist = template.getObjectByName('wrist');
  const middle = template.getObjectByName('middle-finger-tip');
  const index = template.getObjectByName('index-finger-phalanx-proximal');
  const pinky = template.getObjectByName('pinky-finger-phalanx-proximal');
  if (!wrist || !middle || !index || !pinky) throw new Error('NPC hand asset is missing anatomical landmarks.');
  const origin = wrist.getWorldPosition(new THREE.Vector3());
  const length = middle.getWorldPosition(new THREE.Vector3()).sub(origin);
  const scale = 0.145 / length.length();
  length.normalize();
  const width = pinky.getWorldPosition(new THREE.Vector3())
    .sub(index.getWorldPosition(new THREE.Vector3()));
  width.addScaledVector(length, -width.dot(length)).normalize();
  const normal = length.clone().cross(width).normalize();
  let pending: Promise<THREE.BufferGeometry> | undefined;
  template.traverse(object => {
    if (!(object instanceof THREE.SkinnedMesh)) return;
    object.skeleton.update();
    const geometry = object.geometry.clone();
    const positions = geometry.getAttribute('position');
    const point = new THREE.Vector3();
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i);
      object.applyBoneTransform(i, point);
      point.applyMatrix4(object.matrixWorld).sub(origin);
      positions.setXYZ(i, point.dot(width) * scale, point.dot(normal) * scale, point.dot(length) * scale);
    }
    for (const name of Object.keys(geometry.attributes)) {
      if (name !== 'position') geometry.deleteAttribute(name);
    }
    const welded = mergeVertices(geometry, 1e-5);
    geometry.dispose();
    const remove = Math.max(0, welded.getAttribute('position').count - 340);
    pending = (remove ? new SimplifyModifier().modify(welded, remove) : Promise.resolve(welded.clone()))
      .finally(() => welded.dispose());
  });
  const baked = await pending;
  if (!baked) throw new Error('NPC anatomical hand asset has no mesh.');
  const baseBounds = new THREE.Box3();
  const bakedPositions = baked.getAttribute('position');
  for (let i = 0; i < bakedPositions.count; i++) {
    if (bakedPositions.getZ(i) < 0.012) {
      baseBounds.expandByPoint(new THREE.Vector3().fromBufferAttribute(bakedPositions, i));
    }
    const z = bakedPositions.getZ(i);
    if (z > 0.065) {
      const distance = z - 0.065;
      const angle = distance / 0.15;
      bakedPositions.setY(i, bakedPositions.getY(i) - 0.15 * (1 - Math.cos(angle)));
      bakedPositions.setZ(i, 0.065 + 0.15 * Math.sin(angle));
    }
  }
  wristShape = {
    x: (baseBounds.min.x + baseBounds.max.x) / 2,
    y: (baseBounds.min.y + baseBounds.max.y) / 2,
    halfWidth: (baseBounds.max.x - baseBounds.min.x) / 2,
    halfThickness: (baseBounds.max.y - baseBounds.min.y) / 2,
  };
  baked.computeVertexNormals();
  baked.setAttribute('uv', new THREE.Float32BufferAttribute(
    new Float32Array(baked.getAttribute('position').count * 2), 2,
  ));
  anatomicalHand?.dispose();
  anatomicalHand = baked;
  handGeometryCache.forEach(geometry => geometry.dispose());
  handGeometryCache.clear();
}

function buildSeatedCrowdHands(applauding: boolean, fits?: CrowdHandFit[]) {
  if (!anatomicalHand) throw new Error('NPC anatomical hand asset was not prepared.');
  const parts: THREE.BufferGeometry[] = [];
  for (const [handIndex, side] of [1, -1].entries()) {
    const targets = getSeatedCrowdHandTargets(side, applauding);
    const fit = fits?.[handIndex];
    const wrist = fit?.center ?? targets.wrist;
    const { direction, width, normal } = getSeatedCrowdHandFrame(side, applauding);
    const hand = anatomicalHand.clone();
    if (fit) {
      const positions = hand.getAttribute('position');
      for (let i = 0; i < positions.count; i++) {
        const blend = 1 - THREE.MathUtils.smoothstep(positions.getZ(i), 0, 0.045);
        const targetX = (positions.getX(i) - wristShape.x) * fit.halfWidth / wristShape.halfWidth;
        const targetY = (positions.getY(i) - wristShape.y) * fit.halfThickness / wristShape.halfThickness;
        positions.setX(i, THREE.MathUtils.lerp(positions.getX(i), targetX, blend));
        positions.setY(i, THREE.MathUtils.lerp(positions.getY(i), targetY, blend));
      }
      hand.computeVertexNormals();
    }
    const matrix = new THREE.Matrix4().makeBasis(
      width, normal, direction,
    ).setPosition(wrist);
    hand.applyMatrix4(matrix);
    if (matrix.determinant() < 0 && hand.index) {
      for (let i = 0; i < hand.index.count; i += 3) {
        const b = hand.index.getX(i + 1);
        hand.index.setX(i + 1, hand.index.getX(i + 2));
        hand.index.setX(i + 2, b);
      }
      hand.computeVertexNormals();
    }
    parts.push(hand);

  }
  const geometry = mergeGeometries(parts, false);
  parts.forEach(part => part.dispose());
  if (!geometry) throw new Error('Could not combine anatomical NPC hands.');
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData = { anatomicalHands: true, palms: 2, fingers: 8, thumbs: 2, applauding };
  return geometry;
}

export function createSeatedCrowdHandsGeometry(applauding: boolean, fits?: CrowdHandFit[]) {
  const key = JSON.stringify([applauding, fits?.map(fit =>
    [...fit.center.toArray(), fit.halfWidth, fit.halfThickness].map(value => Number(value.toFixed(4))))]);
  let cached = handGeometryCache.get(key);
  if (!cached) {
    cached = buildSeatedCrowdHands(applauding, fits);
    handGeometryCache.set(key, cached);
  }
  return cached.clone();
}

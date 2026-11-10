import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CrowdRig } from './DmoLiveCourt3DScene';
import { getCrowdAppearance } from './DmoLiveCourt3DScene';
import { shouldUseHighDetailCrowdSeat } from '../lib/dmoCrowdLod';
import { poseSpectator } from './DmoSpectatorPose';
import { createSpectatorSkin } from './DmoSpectatorSkin';

export async function loadSpectatorModel(
  gender: 'male' | 'female', detail: 'far' | 'full', signal: AbortSignal, base = '/models/dmo-humans',
) {
  return loadSpectatorFile(`rocketbox-${gender}-${detail}`, gender, signal, base);
}

export async function loadDiverseSpectatorModel(
  id: string, gender: 'male' | 'female', signal: AbortSignal, base = '/models/dmo-humans',
) {
  return loadSpectatorFile(id, gender, signal, base);
}

async function loadSpectatorFile(
  id: string, gender: 'male' | 'female', signal: AbortSignal, base: string,
) {
  const response = await fetch(`${base}/${id}.glb`, { signal });
  if (!response.ok) throw new Error(`Spectator model request failed (${response.status}).`);
  const { scene } = await new GLTFLoader().parseAsync(await response.arrayBuffer(), '');
  if (signal.aborted) {
    scene.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose();
        material.dispose();
      }
      if (object instanceof THREE.SkinnedMesh) object.skeleton.dispose();
    });
    throw new DOMException('Spectator load cancelled.', 'AbortError');
  }
  scene.userData.spectatorGender = gender;
  scene.userData.spectatorIdentity = id;
  scene.traverse(object => {
    const detail = object.userData.spectatorDetail;
    if (detail) object.traverse(child => { child.userData.spectatorDetail = detail; });
  });
  return scene;
}

function spectatorMaterial(source: THREE.Material) {
  const material = source.clone();
  if (material instanceof THREE.MeshStandardMaterial) {
    material.roughness = Math.max(material.roughness, 0.65);
    material.metalness = 0;
    material.vertexColors = true;
  }
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
attribute float spectatorClothing;
attribute vec3 spectatorTint;
varying float vSpectatorClothing;
varying vec3 vSpectatorTint;`).replace('#include <begin_vertex>', `#include <begin_vertex>
vSpectatorClothing = spectatorClothing;
vSpectatorTint = spectatorTint;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
varying float vSpectatorClothing;
varying vec3 vSpectatorTint;`).replace('#include <color_fragment>', `#include <color_fragment>
diffuseColor.rgb *= mix(vec3(1.0), vSpectatorTint, clamp(vSpectatorClothing, 0.0, 1.0));`);
  };
  material.customProgramCacheKey = () => 'rocketbox-spectator-clothing';
  return material;
}

/** Bake the original whole body, including its authored hands and footwear. */
export function bakeSpectator(
  template: THREE.Group, applause: 'rest' | 'open' | 'closed', look = 0, detail: 'far' | 'full' = 'full',
) {
  const model = clone(template) as THREE.Group;
  poseSpectator(model, applause, look);
  const parts: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const groups: { start: number; count: number; materialIndex: number }[] = [];
  let offset = 0;
  model.traverse(object => {
    if (!(object instanceof THREE.SkinnedMesh)) return;
    if (object.userData.spectatorDetail && object.userData.spectatorDetail !== detail) return;
    object.skeleton.update();
    const geometry = object.geometry.clone();
    const positions = geometry.getAttribute('position');
    const normals = geometry.getAttribute('normal');
    const sourceColors = geometry.getAttribute('color');
    const skinIndex = geometry.getAttribute('skinIndex');
    const skinWeight = geometry.getAttribute('skinWeight');
    const clothing = new Float32Array(positions.count);
    const colors = new Float32Array(positions.count * 3);
    const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
    // Recolour only the approved Rocketbox garments. VALID's original casual
    // outfits include exposed arms and legs; retain all of their source colours.
    const isBody = !template.userData.spectatorIdentity?.startsWith('valid-')
      && sourceMaterials.every(material => /_body/.test(material.name));
    const volumeSkin = template.userData.spectatorIdentity?.startsWith('valid-')
      ? createSpectatorSkin(object) : undefined;
    const normalMatrices = object.skeleton.bones.map((joint, index) => new THREE.Matrix3().getNormalMatrix(
      object.matrixWorld.clone().multiply(object.bindMatrixInverse)
        .multiply(joint.matrixWorld).multiply(object.skeleton.boneInverses[index]).multiply(object.bindMatrix),
    ));
    const point = new THREE.Vector3(), sourceNormal = new THREE.Vector3();
    const normal = new THREE.Vector3(), contribution = new THREE.Vector3();
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i);
      sourceNormal.fromBufferAttribute(normals, i);
      if (volumeSkin) volumeSkin(i, point, sourceNormal);
      else object.applyBoneTransform(i, point).applyMatrix4(object.matrixWorld);
      positions.setXYZ(i, point.x, point.y, point.z);
      normal.set(0, 0, 0);
      let protectedWeight = 0;
      for (let c = 0; c < 4; c++) {
        const joint = skinIndex.getComponent(i, c), weight = skinWeight.getComponent(i, c);
        if (!weight) continue;
        if (!volumeSkin) {
          contribution.copy(sourceNormal).applyMatrix3(normalMatrices[joint]);
          normal.addScaledVector(contribution, weight);
        }
        if (/Hand|Foot|Toe|Head|Neck/.test(object.skeleton.bones[joint].name)) protectedWeight += weight;
      }
      if (volumeSkin) normal.copy(sourceNormal);
      else normal.normalize();
      normals.setXYZ(i, normal.x, normal.y, normal.z);
      clothing[i] = isBody ? 1 - THREE.MathUtils.smoothstep(protectedWeight, 0.01, 0.25) : 0;
      colors[i * 3] = sourceColors?.getX(i) ?? 1;
      colors[i * 3 + 1] = sourceColors?.getY(i) ?? 1;
      colors[i * 3 + 2] = sourceColors?.getZ(i) ?? 1;
    }
    for (const name of Object.keys(geometry.attributes)) {
      if (!['position', 'normal', 'uv'].includes(name)) geometry.deleteAttribute(name);
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('spectatorClothing', new THREE.Float32BufferAttribute(clothing, 1));
    const materialOffset = materials.length;
    materials.push(...sourceMaterials.map(spectatorMaterial));
    const localGroups = geometry.groups.length ? geometry.groups : [{
      start: 0, count: geometry.index!.count, materialIndex: 0,
    }];
    localGroups.forEach((group: { start: number; count: number; materialIndex?: number }) => groups.push({
      start: offset + group.start, count: group.count,
      materialIndex: materialOffset + (group.materialIndex ?? 0),
    }));
    offset += geometry.index!.count;
    parts.push(geometry);
    object.skeleton.dispose();
  });
  const geometry = mergeGeometries(parts, false);
  parts.forEach(part => part.dispose());
  if (!geometry) throw new Error('Spectator model could not be baked into continuous instanced geometry.');
  groups.forEach(group => geometry.addGroup(group.start, group.count, group.materialIndex));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData = { source: 'Microsoft Rocketbox', continuousHands: true, applause, look };
  return { geometry, materials };
}

type Batch = { mesh: THREE.InstancedMesh; tint: THREE.InstancedBufferAttribute; count: number };
const poses = ['rest', 'open', 'closed'] as const;
const looks = [-0.4, 0, 0.4];
const clothingTints = [
  [1, 1, 1], [0.74, 0.88, 1.20], [1.12, 0.78, 0.72], [0.78, 1.08, 0.84],
  [1.10, 1.03, 0.75], [0.90, 0.77, 1.10], [0.76, 1.03, 1.12], [0.88, 0.87, 0.85],
];

export function attachSpectatorCrowd(scene: THREE.Scene, crowd: CrowdRig, templates: THREE.Group[]) {
  const far: Batch[][] = [], full: Batch[][] = [];
  const choices = { male: [] as number[], female: [] as number[] };
  templates.forEach((template, index) => {
    const gender = template.userData.spectatorGender ?? (index === 1 ? 'female' : 'male');
    choices[gender as 'male' | 'female'].push(index);
  });
  if (!choices.male.length || !choices.female.length) throw new Error('Spectator roster requires both genders.');
  const seatModels = crowd.seats.map((seat, index) => {
    const source = seat.sourceIndex ?? index;
    const gender = getCrowdAppearance(source, seat.row).gender;
    const variants = choices[gender];
    let hash = source + seat.row * 131;
    hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d);
    hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b);
    hash = (hash ^ (hash >>> 16)) >>> 0;
    return variants[hash % variants.length];
  });
  const capacities = templates.map((_, index) => Math.max(1, seatModels.filter(value => value === index).length));
  const makeBatches = (template: THREE.Group, identity: number, detail: 'far' | 'full') => {
    const batches: Batch[] = [];
    const capacity = capacities[identity];
    for (const pose of poses) for (const look of looks) {
      const { geometry, materials } = bakeSpectator(template, pose, look, detail);
      const tint = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
      tint.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('spectatorTint', tint);
      const mesh = new THREE.InstancedMesh(geometry, materials, capacity);
      mesh.name = `wtsl-spectator-${detail}-${identity}-${pose}-${look}`;
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(mesh);
      batches.push({ mesh, tint, count: 0 });
    }
    return batches;
  };
  templates.forEach((template, gender) => far.push(makeBatches(template, gender, 'far')));
  const dummy = new THREE.Object3D();
  let force = true, lastUpdate = -Infinity, lastApplause = false;
  const update: CrowdRig['update'] = (time, applauding, ball) => {
    if (!force && time - lastUpdate < 0.10 && applauding === lastApplause) return;
    const all = [...far.flat(), ...full.flat()];
    all.forEach(batch => { batch.count = 0; });
    crowd.seats.forEach((seat, index) => {
      if (!seat.occupied) return;
      const source = seat.sourceIndex ?? index;
      const appearance = getCrowdAppearance(source, seat.row);
      const gender = appearance.gender === 'female' ? 1 : 0;
      const identity = seatModels[index];
      let delta = ball ? Math.atan2(ball.x - seat.x, ball.z - seat.z) - seat.facing : 0;
      delta = THREE.MathUtils.euclideanModulo(delta + Math.PI, Math.PI * 2) - Math.PI;
      const gaze = delta < -0.18 ? 0 : delta > 0.18 ? 2 : 1;
      // Hands remain raised throughout applause; they never jump back to the lap
      // between claps. Different spectators have independent open/closed phases.
      const pose = applauding ? (Math.sin(time * 9 + source * 1.7) > 0 ? 1 : 2) : 0;
      const high = crowd.highDetailEnabled && full[identity]
        && shouldUseHighDetailCrowdSeat(seat.row, source, gender);
      const batch = (high ? full[identity] : far[identity])[pose * 3 + gaze];
      const instance = batch.count++;
      dummy.position.set(seat.x, seat.y, seat.z);
      dummy.rotation.set(((source % 5) - 2) * 0.006, seat.facing, 0);
      dummy.scale.setScalar(appearance.stature);
      dummy.updateMatrix();
      batch.mesh.setMatrixAt(instance, dummy.matrix);
      const tint = clothingTints[appearance.wardrobe % clothingTints.length];
      batch.tint.setXYZ(instance, tint[0], tint[1], tint[2]);
    });
    all.forEach(batch => {
      batch.mesh.count = batch.count;
      batch.mesh.instanceMatrix.needsUpdate = true;
      batch.tint.needsUpdate = true;
    });
    force = false; lastUpdate = time; lastApplause = applauding;
  };
  crowd.setHighDetailModel = (template, identity) => {
    if (identity < 0 || identity >= templates.length || full[identity]) return;
    full[identity] = makeBatches(template, identity, 'full');
    force = true;
  };
  crowd.setHighDetailEnabled = enabled => { crowd.highDetailEnabled = enabled; force = true; };
  crowd.invalidateUpdate = () => { force = true; lastUpdate = -Infinity; };
  crowd.replacePeople(update);
  update(0, false);
  return far.flat().map(batch => batch.mesh);
}

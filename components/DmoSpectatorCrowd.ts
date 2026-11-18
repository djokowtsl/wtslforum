import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CrowdRig } from './DmoLiveCourt3DScene';
import { getCrowdAppearance } from './DmoLiveCourt3DScene';
import { shouldUseHighDetailCrowdSeat } from '../lib/dmoCrowdLod';
import { poseSpectator } from './DmoSpectatorPose';
import { createSpectatorSkin } from './DmoSpectatorSkin';
import {
  CROWD_SIGN_COLORS,
  CROWD_SIGN_MESSAGES,
  crowdCapColorFor,
  crowdDrinkIsCup,
  crowdPropFor,
  crowdSignMessageFor,
  type CrowdProp,
} from '../lib/dmoCrowdProps.mjs';

/** Where props go on a baked spectator, in its own (unscaled, seat-origin) space. */
export type SpectatorAnchors = {
  /** The head's turning point (for gaze), the top of the head and its half width. */
  head: { pivot: THREE.Vector3; top: THREE.Vector3; radius: number };
  /** The middle of each palm. */
  hands: { left: THREE.Vector3; right: THREE.Vector3 };
};

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

function spectatorMaterial(source: THREE.Material, headPivot: THREE.Vector3) {
  const material = source.clone();
  if (material instanceof THREE.MeshStandardMaterial) {
    material.roughness = Math.max(material.roughness, 0.65);
    material.metalness = 0;
    material.vertexColors = true;
  }
  material.onBeforeCompile = shader => {
    shader.uniforms.spectatorHeadPivot = { value: headPivot.clone() };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute float spectatorClothing;
attribute vec3 spectatorTint;
attribute vec2 spectatorGaze;
attribute float spectatorHeadMask;
uniform vec3 spectatorHeadPivot;
varying float vSpectatorClothing;
varying vec3 vSpectatorTint;`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
float spectatorHeadWeight = clamp(spectatorHeadMask, 0.0, 1.0);
float spectatorGazeCos = mix(1.0, spectatorGaze.x, spectatorHeadWeight);
float spectatorGazeSin = spectatorGaze.y * spectatorHeadWeight;
vec3 spectatorBaseNormal = objectNormal;
objectNormal.x = spectatorBaseNormal.x * spectatorGazeCos + spectatorBaseNormal.z * spectatorGazeSin;
objectNormal.z = -spectatorBaseNormal.x * spectatorGazeSin + spectatorBaseNormal.z * spectatorGazeCos;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vSpectatorClothing = spectatorClothing;
vSpectatorTint = spectatorTint;
vec3 spectatorHeadOffset = transformed - spectatorHeadPivot;
transformed.x = spectatorHeadPivot.x + spectatorHeadOffset.x * spectatorGazeCos + spectatorHeadOffset.z * spectatorGazeSin;
transformed.z = spectatorHeadPivot.z - spectatorHeadOffset.x * spectatorGazeSin + spectatorHeadOffset.z * spectatorGazeCos;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
varying float vSpectatorClothing;
varying vec3 vSpectatorTint;`).replace('#include <color_fragment>', `#include <color_fragment>
diffuseColor.rgb *= mix(vec3(1.0), vSpectatorTint, clamp(vSpectatorClothing, 0.0, 1.0));`);
  };
  material.customProgramCacheKey = () => 'rocketbox-spectator-clothing-head-gaze-v2';
  return material;
}

/** Bake the original whole body, including its authored hands and footwear. */
export function bakeSpectator(
  template: THREE.Group, applause: 'rest' | 'open' | 'closed' | 'sign', look = 0, detail: 'far' | 'full' = 'full',
) {
  const model = clone(template) as THREE.Group;
  poseSpectator(model, applause, look);
  const head = model.getObjectByName('Head');
  if (!head) throw new Error('Spectator model is missing its head pivot.');
  const headPivot = head.getWorldPosition(new THREE.Vector3());
  const palm = (prefix: 'Left' | 'Right') => (
    model.getObjectByName(`${prefix}HandMiddle1`) ?? model.getObjectByName(`${prefix}Hand`)
  )?.getWorldPosition(new THREE.Vector3()) ?? headPivot.clone();
  const hands = { left: palm('Left'), right: palm('Right') };
  // Head (and hair) vertices, for where a cap sits: on the actual head.
  const headPoints: number[] = [];
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
    const headMask = new Float32Array(positions.count);
    const colors = new Float32Array(positions.count * 3);
    const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
    // Recolour only the approved Rocketbox garments. VALID's original casual
    // outfits include exposed arms and legs; retain all of their source colours.
    const isBody = !template.userData.spectatorIdentity?.startsWith('valid-')
      && sourceMaterials.every(material => /_body/.test(material.name));
    const volumeSkin = template.userData.spectatorIdentity?.startsWith('valid-')
      ? createSpectatorSkin(object) : undefined;
    const headJoints = new Set<number>();
    object.skeleton.bones.forEach((joint, index) => {
      for (let parent: THREE.Object3D | null = joint; parent; parent = parent.parent) {
        if (parent.name === 'Head') {
          headJoints.add(index);
          break;
        }
      }
    });
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
      let headWeight = 0;
      for (let c = 0; c < 4; c++) {
        const joint = skinIndex.getComponent(i, c), weight = skinWeight.getComponent(i, c);
        if (!weight) continue;
        if (headJoints.has(joint)) headWeight += weight;
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
      headMask[i] = Math.min(1, headWeight);
      if (headWeight > 0.6) headPoints.push(point.x, point.y, point.z);
      colors[i * 3] = sourceColors?.getX(i) ?? 1;
      colors[i * 3 + 1] = sourceColors?.getY(i) ?? 1;
      colors[i * 3 + 2] = sourceColors?.getZ(i) ?? 1;
    }
    for (const name of Object.keys(geometry.attributes)) {
      if (!['position', 'normal', 'uv'].includes(name)) geometry.deleteAttribute(name);
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('spectatorClothing', new THREE.Float32BufferAttribute(clothing, 1));
    geometry.setAttribute('spectatorHeadMask', new THREE.Float32BufferAttribute(headMask, 1));
    const materialOffset = materials.length;
    materials.push(...sourceMaterials.map(source => spectatorMaterial(source, headPivot)));
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
  return { geometry, materials, anchors: spectatorAnchors(headPivot, headPoints, hands) };
}

/** The top of the head (hair included) and its width, from the baked head vertices. */
function spectatorAnchors(
  pivot: THREE.Vector3, points: number[], hands: SpectatorAnchors['hands'],
): SpectatorAnchors {
  let topY = -Infinity;
  for (let index = 1; index < points.length; index += 3) topY = Math.max(topY, points[index]);
  if (!Number.isFinite(topY)) {
    return { head: { pivot, top: pivot.clone().add(new THREE.Vector3(0, 0.2, 0)), radius: 0.1 }, hands };
  }
  const crown = new THREE.Vector3();
  let crownCount = 0;
  let minX = Infinity, maxX = -Infinity;
  for (let index = 0; index < points.length; index += 3) {
    const y = points[index + 1];
    if (y > topY - 0.035) {
      crown.x += points[index];
      crown.z += points[index + 2];
      crownCount += 1;
    }
    // Skull width a little below the crown.
    if (y > topY - 0.13 && y < topY - 0.05) {
      minX = Math.min(minX, points[index]);
      maxX = Math.max(maxX, points[index]);
    }
  }
  crown.x /= Math.max(1, crownCount);
  crown.z /= Math.max(1, crownCount);
  crown.y = topY;
  const radius = Number.isFinite(maxX - minX) ? THREE.MathUtils.clamp((maxX - minX) / 2, 0.075, 0.14) : 0.1;
  return { head: { pivot, top: crown, radius }, hands };
}

type Batch = {
  mesh: THREE.InstancedMesh;
  tint: THREE.InstancedBufferAttribute;
  gaze: THREE.InstancedBufferAttribute;
  count: number;
};
const poses = ['rest', 'open', 'closed', 'sign'] as const;
/** Index of the sign-holding pose (far detail only). */
const SIGN_POSE = 3;
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
  const allBatches: Batch[] = [];
  const anchors: { rest?: SpectatorAnchors; sign?: SpectatorAnchors }[] = templates.map(() => ({}));
  const makeBatches = (template: THREE.Group, identity: number, detail: 'far' | 'full') => {
    const batches: Batch[] = [];
    const capacity = capacities[identity];
    // Head direction is a per-instance shader input, not three copies of every
    // seated pose. Preserve separate applause poses without tripling geometry.
    // The sign pose is baked once, at far detail: sign holders are few.
    for (const pose of poses) {
      if (pose === 'sign' && detail !== 'far') continue;
      let baked: ReturnType<typeof bakeSpectator>;
      try {
        baked = bakeSpectator(template, pose, 0, detail);
      } catch (error) {
        if (pose === 'sign') continue; // this model can't hold a sign up; its fans keep it in their lap
        throw error;
      }
      const { geometry, materials } = baked;
      if (detail === 'far' && pose === 'rest') anchors[identity].rest = baked.anchors;
      if (pose === 'sign') anchors[identity].sign = baked.anchors;
      const tint = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
      tint.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('spectatorTint', tint);
      const gaze = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2);
      gaze.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('spectatorGaze', gaze);
      const mesh = new THREE.InstancedMesh(geometry, materials, capacity);
      mesh.name = `wtsl-spectator-${detail}-${identity}-${pose}`;
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(mesh);
      const batch = { mesh, tint, gaze, count: 0 };
      batches[poses.indexOf(pose)] = batch;
      allBatches.push(batch);
    }
    return batches;
  };
  templates.forEach((template, gender) => far.push(makeBatches(template, gender, 'far')));
  const props = createCrowdProps(scene, crowd);
  const dummy = new THREE.Object3D();
  const viewProjection = new THREE.Matrix4();
  const viewFrustum = new THREE.Frustum();
  // Include the whole seated body, raised hands and head turns at frame edges.
  const seatBounds = new THREE.Sphere(new THREE.Vector3(), 1.6);
  let lastCamera: THREE.Camera | undefined;
  let force = true, lastUpdate = -Infinity, lastApplause = false;
  const update: CrowdRig['update'] = (time, applauding, ball, camera) => {
    if (!force && camera === lastCamera && time - lastUpdate < 0.10 && applauding === lastApplause) return;
    if (camera) {
      camera.updateMatrixWorld();
      viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      viewFrustum.setFromProjectionMatrix(viewProjection, camera.coordinateSystem);
    }
    allBatches.forEach(batch => { batch.count = 0; });
    props.begin();
    crowd.seats.forEach((seat, index) => {
      if (!seat.occupied) return;
      // A batch spans the entire bowl, so mesh-level frustum culling cannot
      // reject its off-screen instances. Compact only visible people into it.
      if (camera) {
        seatBounds.center.set(seat.x, seat.y + 0.8, seat.z);
        if (!viewFrustum.intersectsSphere(seatBounds)) return;
      }
      const source = seat.sourceIndex ?? index;
      const appearance = getCrowdAppearance(source, seat.row);
      const gender = appearance.gender === 'female' ? 1 : 0;
      const identity = seatModels[index];
      let delta = ball ? Math.atan2(ball.x - seat.x, ball.z - seat.z) - seat.facing : 0;
      delta = THREE.MathUtils.euclideanModulo(delta + Math.PI, Math.PI * 2) - Math.PI;
      const gazeAngle = delta < -0.18 ? -0.4 : delta > 0.18 ? 0.4 : 0;
      // Hands remain raised throughout applause; they never jump back to the lap
      // between claps. Different spectators have independent open/closed phases.
      const prop = props.kinds[index];
      // Fans with food or a drink keep hold of it; sign holders hold theirs up
      // when the crowd applauds and rest it in their lap otherwise.
      const raisingSign = prop === 'sign' && applauding && Boolean(far[identity][SIGN_POSE]);
      const pose = raisingSign ? SIGN_POSE
        : applauding && prop !== 'drink' && prop !== 'snack' ? (Math.sin(time * 9 + source * 1.7) > 0 ? 1 : 2) : 0;
      const high = !raisingSign && crowd.highDetailEnabled && full[identity]
        && shouldUseHighDetailCrowdSeat(seat.row, source, gender);
      const batch = (high ? full[identity] : far[identity])[pose];
      const instance = batch.count++;
      dummy.position.set(seat.x, seat.y, seat.z);
      dummy.rotation.set(((source % 5) - 2) * 0.006, seat.facing, 0);
      dummy.scale.setScalar(appearance.stature);
      dummy.updateMatrix();
      batch.mesh.setMatrixAt(instance, dummy.matrix);
      const tint = clothingTints[appearance.wardrobe % clothingTints.length];
      batch.tint.setXYZ(instance, tint[0], tint[1], tint[2]);
      batch.gaze.setXY(instance, Math.cos(gazeAngle), Math.sin(gazeAngle));
      if (prop) {
        const anchor = (raisingSign ? anchors[identity].sign : undefined) ?? anchors[identity].rest;
        if (anchor) props.place(prop, source, dummy.matrix, anchor, gazeAngle, raisingSign);
      }
    });
    props.finish();
    allBatches.forEach(batch => {
      batch.mesh.count = batch.count;
      for (const attribute of [batch.mesh.instanceMatrix, batch.tint, batch.gaze]) {
        attribute.clearUpdateRanges();
        if (batch.count) {
          attribute.addUpdateRange(0, batch.count * attribute.itemSize);
          attribute.needsUpdate = true;
        }
      }
    });
    force = false; lastUpdate = time; lastApplause = applauding; lastCamera = camera;
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

/**
 * Caps, fans' signs, drinks and snacks, placed every crowd update from the
 * same seat transform as the person (so they follow the head and hands,
 * appear only on occupied, on-screen seats, and change with crowd density).
 */
function createCrowdProps(scene: THREE.Scene, crowd: CrowdRig) {
  const kinds: (CrowdProp | null)[] = crowd.seats.map((seat, index) => crowdPropFor(seat.sourceIndex ?? index, seat.row));
  const capacity = (kind: CrowdProp) => Math.max(1, kinds.filter(value => value === kind).length);
  const meshes: THREE.InstancedMesh[] = [];
  const make = (name: string, geometry: THREE.BufferGeometry, material: THREE.Material, size: number) => {
    const mesh = new THREE.InstancedMesh(geometry, material, size);
    mesh.name = name;
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(mesh);
    meshes.push(mesh);
    return mesh;
  };
  const standard = (color: number, roughness = 0.7) => new THREE.MeshStandardMaterial({ color, roughness });

  // Cap: a dome over the crown and a peak to the front (+Z is the face).
  const capDome = make('wtsl-crowd-cap-domes',
    new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), standard(0xffffff, 0.66), capacity('cap'));
  const capPeak = make('wtsl-crowd-cap-peaks',
    new THREE.CylinderGeometry(1, 1, 0.012, 14, 1, false, -Math.PI / 2, Math.PI), standard(0xffffff, 0.66), capacity('cap'));

  // Drinks: a paper cup or a bottle, in the right hand.
  const cupGeometry = new THREE.CylinderGeometry(0.036, 0.027, 0.12, 12);
  cupGeometry.translate(0, 0.06, 0);
  const cups = make('wtsl-crowd-cups', cupGeometry, standard(0xffffff, 0.6), capacity('drink'));
  const bottleGeometry = new THREE.CylinderGeometry(0.028, 0.031, 0.19, 10);
  bottleGeometry.translate(0, 0.095, 0);
  const bottles = make('wtsl-crowd-bottles', bottleGeometry, new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.25, transparent: true, opacity: 0.85,
  }), capacity('drink'));

  // Snacks: a striped-free popcorn tub held in the lap.
  const tubGeometry = new THREE.CylinderGeometry(0.075, 0.058, 0.13, 14);
  tubGeometry.translate(0, 0.065, 0);
  const tubs = make('wtsl-crowd-snack-tubs', tubGeometry, standard(0xc8372f, 0.7), capacity('snack'));
  const popcornGeometry = new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  popcornGeometry.scale(0.073, 0.035, 0.073);
  popcornGeometry.translate(0, 0.13, 0);
  const popcorn = make('wtsl-crowd-popcorn', popcornGeometry, standard(0xf3dc8c, 0.95), capacity('snack'));

  // Signs: one shared texture of all the messages, one mesh per message.
  const signTexture = crowdSignTexture();
  const signMaterial = new THREE.MeshStandardMaterial({
    color: signTexture ? 0xffffff : 0xf2efe6, map: signTexture ?? null, roughness: 0.85, side: THREE.DoubleSide,
  });
  const signs = CROWD_SIGN_MESSAGES.map((_, message) => make(
    `wtsl-crowd-sign-${message + 1}`, signGeometry(message), signMaterial, capacity('sign'),
  ));

  const local = new THREE.Matrix4();
  const part = new THREE.Matrix4();
  const out = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const color = new THREE.Color();
  const put = (mesh: THREE.InstancedMesh, seat: THREE.Matrix4, matrix: THREE.Matrix4, tint?: number) => {
    const instance = mesh.count++;
    mesh.setMatrixAt(instance, out.multiplyMatrices(seat, matrix));
    if (tint !== undefined) mesh.setColorAt(instance, color.set(tint));
  };
  const compose = (x: number, y: number, z: number, sx: number, sy: number, sz: number, rx = 0) => {
    position.set(x, y, z);
    quaternion.setFromEuler(euler.set(rx, 0, 0));
    scale.set(sx, sy, sz);
    return part.compose(position, quaternion, scale);
  };

  return {
    kinds,
    begin() {
      meshes.forEach(mesh => { mesh.count = 0; });
    },
    place(
      kind: CrowdProp, source: number, seat: THREE.Matrix4, anchors: SpectatorAnchors, gaze: number, raised: boolean,
    ) {
      const { head, hands } = anchors;
      if (kind === 'cap') {
        // Turn with the head (the shader turns head vertices about this pivot).
        local.makeTranslation(head.pivot.x, head.pivot.y, head.pivot.z)
          .multiply(part.makeRotationY(gaze))
          .multiply(new THREE.Matrix4().makeTranslation(-head.pivot.x, -head.pivot.y, -head.pivot.z));
        const r = head.radius;
        const domeY = head.top.y + 0.012 - r * 0.78;
        const tint = crowdCapColorFor(source);
        put(capDome, seat, local.clone().multiply(compose(head.top.x, domeY, head.top.z - 0.004, r * 1.06, r * 0.78, r * 1.1)), tint);
        put(capPeak, seat, local.clone().multiply(compose(head.top.x, domeY + 0.004, head.top.z + r * 0.12, r * 1.0, 1, r * 1.55)), tint);
        return;
      }
      if (kind === 'drink') {
        const hand = hands.right;
        if (crowdDrinkIsCup(source)) {
          put(cups, seat, compose(hand.x, hand.y - 0.045, hand.z + 0.01, 1, 1, 1), source % 3 ? 0xf4f1ea : 0xc8372f);
        } else {
          put(bottles, seat, compose(hand.x, hand.y - 0.07, hand.z + 0.01, 1, 1, 1), source % 2 ? 0x9fd3e6 : 0x86c58f);
        }
        return;
      }
      const middle = position.copy(hands.left).add(hands.right).multiplyScalar(0.5).clone();
      if (kind === 'snack') {
        put(tubs, seat, compose(middle.x, middle.y - 0.05, middle.z + 0.04, 1, 1, 1));
        put(popcorn, seat, compose(middle.x, middle.y - 0.05, middle.z + 0.04, 1, 1, 1));
        return;
      }
      // Sign: held up above the hands when raised, resting tilted in the lap otherwise.
      const mesh = signs[crowdSignMessageFor(source)];
      if (raised) {
        const width = Math.max(0.56, Math.abs(hands.left.x - hands.right.x) + 0.14);
        put(mesh, seat, compose(middle.x, middle.y + 0.15, middle.z + 0.03, width, 0.34, 1, -0.1));
      } else {
        put(mesh, seat, compose(middle.x, middle.y + 0.02, middle.z + 0.08, 0.46, 0.28, 1, -1.2));
      }
    },
    finish() {
      meshes.forEach(mesh => {
        mesh.instanceMatrix.clearUpdateRanges();
        if (mesh.count) {
          mesh.instanceMatrix.addUpdateRange(0, mesh.count * 16);
          mesh.instanceMatrix.needsUpdate = true;
        }
        if (mesh.instanceColor && mesh.count) mesh.instanceColor.needsUpdate = true;
      });
    },
  };
}

const SIGN_COLUMNS = 4;
const SIGN_ROWS = Math.ceil(CROWD_SIGN_MESSAGES.length / SIGN_COLUMNS);

/** A unit sign (1 × 1, facing +Z) showing one cell of the shared texture. */
function signGeometry(message: number) {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const column = message % SIGN_COLUMNS;
  const row = Math.floor(message / SIGN_COLUMNS);
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  for (let index = 0; index < uv.count; index++) {
    uv.setXY(
      index,
      (column + uv.getX(index)) / SIGN_COLUMNS,
      1 - (row + 1 - uv.getY(index)) / SIGN_ROWS,
    );
  }
  return geometry;
}

/** Every sign's message, drawn once (none in tests, which have no canvas). */
function crowdSignTexture() {
  if (typeof document === 'undefined') return undefined;
  const cellWidth = 320, cellHeight = 192;
  const canvas = document.createElement('canvas');
  canvas.width = cellWidth * SIGN_COLUMNS;
  canvas.height = cellHeight * SIGN_ROWS;
  const context = canvas.getContext('2d');
  if (!context) return undefined;
  CROWD_SIGN_MESSAGES.forEach((message, index) => {
    const x = (index % SIGN_COLUMNS) * cellWidth;
    const y = Math.floor(index / SIGN_COLUMNS) * cellHeight;
    const background = CROWD_SIGN_COLORS[index % CROWD_SIGN_COLORS.length];
    const light = background === '#f2efe6';
    context.fillStyle = background;
    context.fillRect(x, y, cellWidth, cellHeight);
    context.strokeStyle = light ? '#24344d' : '#f5f1e5';
    context.lineWidth = 10;
    context.strokeRect(x + 9, y + 9, cellWidth - 18, cellHeight - 18);
    context.fillStyle = light ? '#b5482f' : '#f5f1e5';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    let size = 86;
    context.font = `900 ${size}px Arial, sans-serif`;
    while (size > 30 && context.measureText(message).width > cellWidth - 44) {
      size -= 4;
      context.font = `900 ${size}px Arial, sans-serif`;
    }
    context.fillText(message, x + cellWidth / 2, y + cellHeight / 2 + 4);
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

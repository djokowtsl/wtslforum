import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { disposeHumanModel, HumanPose } from './DmoHumanModels';
import {
  createSeatedCrowdHandsGeometry, getSeatedCrowdHandTargets,
  getSeatedCrowdHandFrame, refineCrowdForearms, type CrowdHandFit,
} from './DmoNpcHands';
import {
  getChairUmpireLegTargets,
  getCrowdAppearance,
  CROWD_SKIN_TONES,
  getSeatedCoachLegTargets,
  getSeatedCrowdLegTargets,
  type CourtFixtureRig,
  type CrowdRig,
} from './DmoLiveCourt3DScene';
import { shouldUseHighDetailCrowdSeat } from '../lib/dmoCrowdLod';
import { makeCrowdClothingOpaque } from '../lib/dmoCrowdClothing';
import { getCrowdBannerBranding } from '../lib/dmoCrowdBranding';
import { createNpcShoeGeometry, dressNpc, stripBareFeet } from './DmoNpcWardrobe';
import {
  fitNativeFaceToTemplate,
  type NativeFaceFit,
  type NativeFaceSet,
  type NativeFaceVariant,
} from './DmoNativeFaces';

function tintedHuman(
  template: THREE.Group,
  tint: number,
  skinTone?: readonly [number, number, number],
  stripHead = false,
) {
  const model = clone(template) as THREE.Group;
  model.traverse((object) => {
    if (!(object instanceof THREE.SkinnedMesh)) return;
    object.geometry = object.geometry.clone();
    stripBareFeet(object.geometry);
    object.material = Array.isArray(object.material)
      ? object.material.map((item) => item.clone())
      : object.material.clone();
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      makeCrowdClothingOpaque(material);
    }
  });
  if (stripHead) stripSkinnedHumanHead(model);
  model.traverse((object) => {
    if (object instanceof THREE.SkinnedMesh) dressNpc(object, tint, skinTone);
  });
  return model;
}

function stripRigidCrowdHands(geometry: THREE.BufferGeometry, skeleton: THREE.Skeleton) {
  const index = geometry.index;
  const skinIndex = geometry.getAttribute('skinIndex');
  const skinWeight = geometry.getAttribute('skinWeight');
  if (!index || !skinIndex || !skinWeight) return;
  const handBones = new Set(skeleton.bones
    .map((bone, index) => /^(Left|Right)Hand$/.test(bone.name) ? index : -1)
    .filter(index => index >= 0));
  if (!handBones.size) return;

  const handWeight = (vertex: number) => {
    let weight = 0;
    for (let component = 0; component < 4; component++) {
      if (handBones.has(skinIndex.getComponent(vertex, component))) {
        weight += skinWeight.getComponent(vertex, component);
      }
    }
    return weight;
  };
  const sourceGroups = geometry.groups.length
    ? geometry.groups.map(group => ({ ...group }))
    : [{ start: 0, count: index.count, materialIndex: 0 }];
  const keptIndices: number[] = [];
  const keptVertices = new Set<number>();
  const removedVertices = new Set<number>();
  const keptGroups: { start: number; count: number; materialIndex: number }[] = [];
  for (const group of sourceGroups) {
    const start = keptIndices.length;
    const end = Math.min(index.count, group.start + group.count);
    for (let offset = group.start; offset + 2 < end; offset += 3) {
      const a = index.getX(offset);
      const b = index.getX(offset + 1);
      const c = index.getX(offset + 2);
      const averageHandWeight = (handWeight(a) + handWeight(b) + handWeight(c)) / 3;
      if (averageHandWeight >= 0.42) {
        [a, b, c].forEach(vertex => removedVertices.add(vertex));
        continue;
      }
      keptIndices.push(a, b, c);
      [a, b, c].forEach(vertex => keptVertices.add(vertex));
    }
    const count = keptIndices.length - start;
    if (count) keptGroups.push({ start, count, materialIndex: group.materialIndex ?? 0 });
  }
  geometry.setIndex(keptIndices);
  geometry.clearGroups();
  keptGroups.forEach(group => geometry.addGroup(group.start, group.count, group.materialIndex));
  const positions = geometry.getAttribute('position');
  return [1, -1].map(side => [...removedVertices].filter(vertex =>
    keptVertices.has(vertex) && Math.sign(positions.getX(vertex)) === side));
}

function stripSkinnedHumanHead(model: THREE.Group) {
  model.traverse((object) => {
    if (!(object instanceof THREE.SkinnedMesh)) return;
    const geometry = object.geometry;
    const headIndex = object.skeleton.bones.findIndex((bone) => bone.name.toLowerCase() === 'head');
    const skinIndex = geometry.getAttribute('skinIndex');
    const skinWeight = geometry.getAttribute('skinWeight');
    const source = geometry.index;
    if (headIndex < 0 || !skinIndex || !skinWeight || !source) return;
    const weightOf = (vertex: number) => {
      let total = 0;
      for (let component = 0; component < 4; component++) {
        if (skinIndex.getComponent(vertex, component) === headIndex) {
          total += skinWeight.getComponent(vertex, component);
        }
      }
      return total;
    };
    const kept: number[] = [];
    for (let offset = 0; offset < source.count; offset += 3) {
      const a = source.getX(offset), b = source.getX(offset + 1), c = source.getX(offset + 2);
      const headWeight = (weightOf(a) + weightOf(b) + weightOf(c)) / 3;
      if (headWeight < 0.3) kept.push(a, b, c);
    }
    geometry.setIndex(kept);
    geometry.clearGroups();
    geometry.addGroup(0, kept.length, 0);
    geometry.computeVertexNormals();
  });
}

export function addCrowdAccessories(scene: THREE.Scene, crowd: CrowdRig) {
  const capSeats = crowd.seats.filter((seat, index) =>
    seat.occupied && ((seat.sourceIndex ?? index) % 17) === 7);
  if (capSeats.length) {
    const dome = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.66 }),
      capSeats.length,
    );
    const brim = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.24, 0.025, 0.16),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.66 }),
      capSeats.length,
    );
    const colors = [0x184d66, 0x9d3037, 0xd1ae42, 0xf0eee5, 0x29363d, 0x467357, 0x71466d];
    const transform = new THREE.Object3D();
    capSeats.forEach((seat, index) => {
      transform.position.set(seat.x, seat.y + 1.34, seat.z);
      transform.rotation.set(0, seat.facing, 0);
      transform.scale.set(0.135, 0.095, 0.135);
      transform.updateMatrix();
      dome.setMatrixAt(index, transform.matrix);
      const color = new THREE.Color(colors[(seat.sourceIndex ?? index) % colors.length]);
      dome.setColorAt(index, color);

      const forwardX = Math.sin(seat.facing);
      const forwardZ = Math.cos(seat.facing);
      transform.position.set(seat.x + forwardX * 0.08, seat.y + 1.32, seat.z + forwardZ * 0.08);
      transform.scale.set(1, 1, 1);
      transform.updateMatrix();
      brim.setMatrixAt(index, transform.matrix);
      brim.setColorAt(index, color);
    });
    dome.name = 'wtsl-crowd-caps';
    brim.name = 'wtsl-crowd-cap-brims';
    dome.instanceMatrix.needsUpdate = true;
    brim.instanceMatrix.needsUpdate = true;
    if (dome.instanceColor) dome.instanceColor.needsUpdate = true;
    if (brim.instanceColor) brim.instanceColor.needsUpdate = true;
    dome.castShadow = false;
    brim.castShadow = false;
    scene.add(dome, brim);
  }

  const bannerSeats = crowd.seats.filter((seat, index) =>
    seat.occupied && seat.row >= 6 && ((seat.sourceIndex ?? index) % 283) === 37);
  bannerSeats.slice(0, 36).forEach((seat, index) => {
    const branding = getCrowdBannerBranding(index);
    const banner = new THREE.Group();
    banner.name = `wtsl-fan-banner-${index + 1}`;
    banner.position.set(seat.x, seat.y, seat.z);
    banner.rotation.y = seat.facing;
    const palette = [0x174e5d, 0x913841, 0x335b43, 0x765276, 0xa17a2e];
    const color = palette[index % palette.length];
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.016, 0.78, 7),
      new THREE.MeshStandardMaterial({ color: 0xc3c1b7, roughness: 0.72 }),
    );
    pole.name = 'wtsl-fan-banner-pole';
    pole.position.set(-0.34, 1.42, 0);
    pole.castShadow = false;
    banner.add(pole);
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(0.68, 0.38),
      new THREE.MeshStandardMaterial({ color, roughness: 0.8, side: THREE.DoubleSide }),
    );
    panel.name = 'wtsl-fan-banner-panel';
    panel.position.set(0, 1.65, 0.01);
    panel.castShadow = false;
    banner.add(panel);
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 288;
      const context = canvas.getContext('2d');
      if (context) {
        context.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = '#f5f1e5';
        context.fillRect(0, 0, canvas.width, 16);
        context.fillRect(0, canvas.height - 16, canvas.width, 16);
        context.font = '800 104px Arial, sans-serif';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        if (branding.mascot === 'rally-fox') {
          // A small, custom line-art fox with a tennis-ball pennant: a fan-made
          // motif rather than a sponsor mark or a second character model.
          context.save();
          context.translate(canvas.width / 2, 74);
          context.fillStyle = '#f5f1e5';
          context.beginPath();
          context.moveTo(-52, -32);
          context.lineTo(-43, -70);
          context.lineTo(-12, -52);
          context.quadraticCurveTo(0, -58, 12, -52);
          context.lineTo(43, -70);
          context.lineTo(52, -32);
          context.quadraticCurveTo(48, 3, 0, 18);
          context.quadraticCurveTo(-48, 3, -52, -32);
          context.fill();
          context.fillStyle = '#26343a';
          context.beginPath();
          context.arc(-18, -26, 4.5, 0, Math.PI * 2);
          context.arc(18, -26, 4.5, 0, Math.PI * 2);
          context.fill();
          context.beginPath();
          context.moveTo(-5, -12);
          context.lineTo(0, -7);
          context.lineTo(5, -12);
          context.closePath();
          context.fill();
          context.strokeStyle = '#d9bd62';
          context.lineWidth = 5;
          context.beginPath();
          context.arc(59, -50, 13, -1.1, 1.1);
          context.stroke();
          context.restore();
        }
        context.fillText(branding.label, canvas.width / 2, branding.mascot ? 204 : canvas.height / 2 + 4);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        const material = panel.material as THREE.MeshStandardMaterial;
        material.color.set(0xffffff);
        material.map = texture;
        material.needsUpdate = true;
      }
    }
    if (branding.mascot) banner.userData.mascot = branding.mascot;
    scene.add(banner);
  });
}

function poseSeatedStaff(model: THREE.Group, space: THREE.Group, hipsY: number, chairUmpire = false) {
  const pose = new HumanPose(model, space);
  const v = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);
  const neck = v(0, hipsY + 0.5);
  const head = v(0, hipsY + 0.57);
  pose.begin();
  pose.place('Hips', v(0, hipsY));
  for (const [name, y] of [['Spine02', 0.13], ['Spine01', 0.26], ['Spine', 0.39]] as const) {
    pose.place(name, v(0, hipsY + y), neck);
  }
  pose.place('neck', neck, head);
  pose.place('Head', head);
  for (const [side, sign] of [['Left', 1], ['Right', -1]] as const) {
    const shoulder = v(sign * 0.2, hipsY + 0.41);
    const elbow = v(sign * 0.24, hipsY + 0.19, 0.12);
    const wrist = v(sign * 0.15, hipsY + 0.06, 0.25);
    pose.place(`${side}Shoulder`, v(sign * 0.04, hipsY + 0.39), shoulder);
    pose.place(`${side}Arm`, shoulder, elbow);
    pose.place(`${side}ForeArm`, elbow, wrist);
    pose.place(`${side}Hand`, wrist, wrist.clone().add(v(-sign * 0.05, 0, 0.08)));
    const legTargets = chairUmpire
      ? getChairUmpireLegTargets(sign, hipsY)
      : getSeatedCoachLegTargets(sign, hipsY);
    const point = (coordinates: readonly [number, number, number]) =>
      v(coordinates[0], coordinates[1], coordinates[2]);
    const hip = point(legTargets.hip);
    const knee = point(legTargets.knee);
    const ankle = point(legTargets.ankle);
    const toe = point(legTargets.toe);
    pose.place(`${side}UpLeg`, hip, knee);
    pose.place(`${side}Leg`, knee, ankle);
    pose.place(`${side}Foot`, ankle, toe);
    pose.place(`${side}ToeBase`, toe);
  }
  pose.finish();
  return { pose, head };
}

function attachStaffModel(
  space: THREE.Group,
  template: THREE.Group,
  name: string,
  tint: number,
  hipsY: number,
  chairUmpire = false,
  nativeFace?: NativeFaceVariant,
  skinToneIndex = 0,
) {
  const skinTone = CROWD_SKIN_TONES[skinToneIndex % CROWD_SKIN_TONES.length];
  const model = tintedHuman(template, tint, skinTone, Boolean(nativeFace));
  if (nativeFace) {
    const head = model.getObjectByName('Head');
    if (!(head instanceof THREE.Bone)) throw new Error('Court staff model has no head joint.');
    const fit = fitNativeFaceToTemplate(nativeFace, template);
    const skinTone = CROWD_SKIN_TONES[skinToneIndex % CROWD_SKIN_TONES.length];
    const face = new THREE.Mesh(
      nativeFace.skin.clone(),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color().setRGB(skinTone[0], skinTone[1], skinTone[2], THREE.SRGBColorSpace),
        roughness: 0.76,
      }),
    );
    face.name = 'wtsl-native-player-face';
    face.position.copy(fit.position);
    face.scale.copy(fit.scale);
    face.castShadow = true;
    face.receiveShadow = true;
    const hair = new THREE.Mesh(
      nativeFace.hair.clone(),
      new THREE.MeshStandardMaterial({ color: nativeFace.hairColor, roughness: 0.86 }),
    );
    hair.name = 'wtsl-native-player-hair';
    hair.position.copy(fit.position);
    hair.scale.copy(fit.scale);
    hair.castShadow = true;
    hair.receiveShadow = true;
    head.add(face, hair);
  }
  model.name = name;
  space.add(model);
  const posed = poseSeatedStaff(model, space, hipsY, chairUmpire);
  for (const [side, sign] of [['left', 1], ['right', -1]] as const) {
    const targets = chairUmpire
      ? getChairUmpireLegTargets(sign, hipsY)
      : getSeatedCoachLegTargets(sign, hipsY);
    space.add(makeStaffShoe(
      `${chairUmpire ? 'wtsl-umpire' : name}-shoe-${side}`,
      new THREE.Vector3(...targets.ankle),
      new THREE.Vector3(...targets.toe),
    ));
  }
  return { model, ...posed };
}

function makeStaffShoe(name: string, ankle: THREE.Vector3, toe: THREE.Vector3) {
  const shoe = new THREE.Mesh(
    createNpcShoeGeometry(),
    new THREE.MeshStandardMaterial({ color: 0x30353a, roughness: 0.82 }),
  );
  shoe.position.copy(ankle).add(toe).multiplyScalar(0.5);
  shoe.position.y -= 0.02;
  shoe.name = name;
  shoe.castShadow = true;
  shoe.receiveShadow = true;
  return shoe;
}

function seatedGeometry(
  template: THREE.Group,
  look: number,
  applause: boolean,
  handMaterialIndex: number,
) {
  const space = new THREE.Group();
  const model = clone(template) as THREE.Group;
  space.add(model);
  const pose = new HumanPose(model, space);
  poseSeatedCrowd(pose, space, look, applause);
  let result: THREE.BufferGeometry | undefined;
  let handFits: CrowdHandFit[] | undefined;
  model.traverse((object) => {
    if (!(object instanceof THREE.SkinnedMesh)) return;
    const geometry = object.geometry.clone();
    const wristBoundaries = stripRigidCrowdHands(geometry, object.skeleton);
    const positions = geometry.getAttribute('position');
    const vertex = new THREE.Vector3();
    for (let i = 0; i < positions.count; i++) {
      vertex.fromBufferAttribute(positions, i);
      object.applyBoneTransform(i, vertex).applyMatrix4(object.matrixWorld);
      positions.setXYZ(i, vertex.x, vertex.y, vertex.z);
    }
    if (!wristBoundaries?.every(boundary => boundary.length >= 3)) {
      throw new Error('Could not locate the source crowd wrist seams.');
    }
    handFits = wristBoundaries.map((boundary, handIndex) => {
      const center = new THREE.Vector3();
      boundary.forEach(index => center.add(new THREE.Vector3().fromBufferAttribute(positions, index)));
      center.multiplyScalar(1 / boundary.length);
      const { width, normal } = getSeatedCrowdHandFrame(handIndex === 0 ? 1 : -1, applause);
      let halfWidth = 0, halfThickness = 0;
      boundary.forEach(index => {
        const delta = new THREE.Vector3().fromBufferAttribute(positions, index).sub(center);
        halfWidth = Math.max(halfWidth, Math.abs(delta.dot(width)));
        halfThickness = Math.max(halfThickness, Math.abs(delta.dot(normal)));
      });
      return { center, halfWidth, halfThickness };
    });
    refineCrowdForearms(geometry, object.skeleton, handFits, applause);
    geometry.deleteAttribute('skinIndex'); geometry.deleteAttribute('skinWeight');
    geometry.deleteAttribute('normal');
    const smoothGeometry = mergeVertices(geometry, 1e-5);
    geometry.dispose();
    smoothGeometry.computeVertexNormals();
    smoothGeometry.computeBoundingBox(); smoothGeometry.computeBoundingSphere();
    object.skeleton.dispose();
    result = smoothGeometry;
  });
  if (!result) throw new Error('Crowd asset has no skinned human mesh.');
  const hands = createSeatedCrowdHandsGeometry(applause, handFits);
  hands.addGroup(0, hands.index?.count ?? hands.getAttribute('position').count, handMaterialIndex);
  const combined = mergeGeometries([result, hands], false);
  if (combined) {
    const bodyIndexCount = result.index?.count ?? result.getAttribute('position').count;
    result.groups.forEach(group => combined.addGroup(group.start, group.count, group.materialIndex));
    combined.addGroup(bodyIndexCount, hands.index?.count ?? hands.getAttribute('position').count, handMaterialIndex);
  }
  result.dispose();
  hands.dispose();
  if (!combined) throw new Error('Could not combine NPC body and hand geometry.');
  combined.computeBoundingBox();
  combined.computeBoundingSphere();
  return combined;
}

function poseSeatedCrowd(
  pose: HumanPose,
  space: THREE.Group,
  look: number,
  applauding: boolean,
) {
  const v = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);
  pose.begin();
  const hips = v(0, 0.48), neck = v(0, 1.13), head = v(0, 1.2);
  pose.place('Hips', hips);
  for (const [name, y] of [['Spine02', 0.76], ['Spine01', 0.89], ['Spine', 1.02]] as const) {
    pose.place(name, v(0, y), neck);
  }
  pose.place('neck', neck, head);
  pose.place('Head', head, undefined, new THREE.Quaternion().setFromAxisAngle(v(0, 1), look));
  for (const [side, sign] of [['Left', 1], ['Right', -1]] as const) {
    const shoulder = v(sign * 0.2, 1.04);
    const elbow = applauding ? v(sign * 0.2, 0.98, 0.22) : v(sign * 0.23, 0.76, 0.08);
    const { wrist, tip } = getSeatedCrowdHandTargets(sign, applauding);
    pose.place(`${side}Shoulder`, v(sign * 0.04, 1.02), shoulder);
    pose.place(`${side}Arm`, shoulder, elbow);
    pose.place(`${side}ForeArm`, elbow, wrist);
    pose.place(`${side}Hand`, wrist, tip);
    const legTargets = getSeatedCrowdLegTargets(sign);
    const hip = v(...legTargets.hip);
    const knee = v(...legTargets.knee);
    const ankle = v(...legTargets.ankle);
    const toe = v(...legTargets.toe);
    pose.place(`${side}UpLeg`, hip, knee);
    pose.place(`${side}Leg`, knee, ankle);
    pose.place(`${side}Foot`, ankle, toe);
    pose.place(`${side}ToeBase`, toe);
  }
  pose.finish();
}

function seatedNativeFaceGeometry(
  template: THREE.Group,
  source: THREE.BufferGeometry,
  fit: NativeFaceFit,
  look: number,
) {
  const space = new THREE.Group();
  const model = clone(template) as THREE.Group;
  space.add(model);
  const pose = new HumanPose(model, space);
  poseSeatedCrowd(pose, space, look, false);
  const head = model.getObjectByName('Head');
  if (!(head instanceof THREE.Bone)) throw new Error('Crowd model has no head joint for the native face.');
  head.updateWorldMatrix(true, false);
  const fitMatrix = new THREE.Matrix4().compose(
    fit.position,
    new THREE.Quaternion(),
    fit.scale,
  );
  fitMatrix.premultiply(head.matrixWorld);
  const geometry = source.clone();
  geometry.applyMatrix4(fitMatrix);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  model.traverse((object) => {
    if (object instanceof THREE.SkinnedMesh) object.skeleton.dispose();
  });
  return geometry;
}

/** Textured seated humans use instancing; full-detail meshes are added progressively. */
export function attachHumanCrowd(
  scene: THREE.Scene,
  crowd: CrowdRig,
  templates: THREE.Group[],
  nativeFaces?: NativeFaceSet,
) {
  const batches: THREE.InstancedMesh[] = [];
  const highDetailBatches: THREE.InstancedMesh[] = [];
  const highFaceBatches: THREE.InstancedMesh[] = [];
  const maxSeatCount = crowd.seats.length;
  // Most seats are spread across 48 gender/look/pose batches; leave headroom
  // without allocating a full crowd-sized matrix/color buffer for each one.
  const batchCapacity = Math.max(16, Math.ceil(maxSeatCount / 4));
  let highFaceCounts = new Uint16Array(0);
  const highFaceGenderOffsets = new Map<number, number>();
  const highFaceVariantsByGender = new Map<number, [NativeFaceVariant, NativeFaceVariant]>();
  const wardrobeTints = [
    [0x315a74, 0x9b4840, 0x40755e, 0x70638c, 0xb78b45, 0x3a6c78, 0x775145, 0x617257],
    [0x4d6c8b, 0xb24e55, 0x448069, 0x826392, 0xb99052, 0x397287, 0x8c624c, 0x5c7658],
  ];
  const makeBatches = (
    template: THREE.Group,
    target: THREE.InstancedMesh[],
    label: string,
    clothingTint: number,
    skinToneIndex: number,
    replaceHead = false,
  ) => {
    const skinTone = CROWD_SKIN_TONES[skinToneIndex];
    const variant = tintedHuman(template, clothingTint, skinTone, replaceHead);
    let sourceMaterials: THREE.Material[] | undefined;
    variant.traverse((object) => {
      if (object instanceof THREE.SkinnedMesh) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach(makeCrowdClothingOpaque);
        sourceMaterials = materials;
      }
    });
    if (!sourceMaterials) throw new Error('Crowd material missing.');
    const skinColor = new THREE.Color().setRGB(
      skinTone[0], skinTone[1], skinTone[2], THREE.SRGBColorSpace,
    );
    const handMaterialIndex = sourceMaterials.length;
    sourceMaterials.push(new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.82 }));
    for (const applauding of [false, true]) for (const look of [-0.5, 0, 0.5]) {
      const crowdMaterials = sourceMaterials.map(material => makeCrowdClothingOpaque(material.clone()));
      const mesh = new THREE.InstancedMesh(
        seatedGeometry(variant, look, applauding, handMaterialIndex), crowdMaterials, batchCapacity,
      );
      mesh.name = `wtsl-${label}-spectators-${target.length}`;
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(mesh);
      target.push(mesh);
    }
    if (variant !== template) disposeHumanModel(variant, false);
  };
  templates.forEach((template, gender) => {
    wardrobeTints[gender % wardrobeTints.length].forEach((tint, wardrobe) => {
      makeBatches(template, batches, `textured-${gender}-look-${wardrobe}`, tint, wardrobe);
    });
  });

  const shoeMesh = new THREE.InstancedMesh(
    createNpcShoeGeometry(),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.78 }),
    maxSeatCount * 2,
  );
  shoeMesh.name = 'wtsl-detailed-crowd-shoes';
  shoeMesh.count = 0;
  shoeMesh.frustumCulled = false;
  shoeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  shoeMesh.castShadow = false;
  shoeMesh.receiveShadow = false;
  scene.add(shoeMesh);

  const dummy = new THREE.Object3D();
  const instanceColor = new THREE.Color();
  let highDetailEnabled = crowd.highDetailEnabled;
  let highDetailCounts = new Uint16Array(0);
  let highDetailSeats = new Set<number>();
  const highDetailGenderOffsets = new Map<number, number>();
  let lastUpdate = -Infinity, previousApplause = false, forceUpdate = true;
  const counts = new Uint16Array(batches.length);
  const shoeColors = [0xe7e4db, 0x344153, 0x675044, 0x1f2935, 0xc7c0ad];
  const update: CrowdRig['update'] = (time, applauding, ball) => {
    if (!forceUpdate && time - lastUpdate < 0.16 && applauding === previousApplause) return;
    counts.fill(0);
    highDetailCounts.fill(0);
    highFaceCounts.fill(0);
    let shoeInstance = 0;
    crowd.seats.forEach((seat, index) => {
      if (!seat.occupied) return;
      const sourceIndex = seat.sourceIndex ?? index;
      let delta = ball ? Math.atan2(ball.x - seat.x, ball.z - seat.z) - seat.facing : 0;
      delta = THREE.MathUtils.euclideanModulo(delta + Math.PI, Math.PI * 2) - Math.PI;
      const gaze = delta < -0.18 ? 0 : delta > 0.18 ? 2 : 1;
      const appearance = getCrowdAppearance(sourceIndex, seat.row);
       const gender = appearance.gender === 'female' ? 1 : 0;
      // Alternate hands-apart and hands-together poses during applause.
      const clap = applauding && sourceIndex % 5 !== 0 && Math.sin(time * 9 + sourceIndex) > -0.15;
      const highDetailOffset = highDetailGenderOffsets.get(gender);
      const useHighDetail = highDetailEnabled
        && highDetailOffset !== undefined
        && highDetailSeats.has(index);
      const bucket = (clap ? 3 : 0) + gaze;
      const batchIndex = gender * 48 + appearance.wardrobe * 6 + bucket;
      const highDetailBatchIndex = (highDetailOffset ?? 0) + appearance.wardrobe * 6 + bucket;
      const mesh = useHighDetail
        ? highDetailBatches[highDetailBatchIndex]
        : batches[batchIndex];
      const instance = useHighDetail
        ? highDetailCounts[highDetailBatchIndex]++
        : counts[batchIndex]++;
      const lean = ((sourceIndex % 5) - 2) * 0.009;
      const turn = ((sourceIndex * 3 % 5) - 2) * 0.012;
      dummy.position.set(seat.x, seat.y, seat.z);
      dummy.rotation.set(lean, seat.facing + turn, 0);
       const bodyScale = {
         x: (0.88 + appearance.torsoWidth * 0.035) * (gender === 1 ? 0.94 : 1),
         y: appearance.stature * (gender === 1 ? 0.97 : 1),
         z: (0.92 + appearance.torsoWidth * 0.04) * (gender === 1 ? 1.02 : 1),
       };
       dummy.scale.set(bodyScale.x, bodyScale.y, bodyScale.z);
      dummy.updateMatrix();
      mesh.setMatrixAt(instance, dummy.matrix);
      // Instance color multiplies the entire baked human mesh. Keep it neutral
      // so rear torso and hip fabric cannot inherit the spectator's skin tone.
      instanceColor.setRGB(1, 1, 1);
      mesh.setColorAt(instance, instanceColor);
      const highFaceOffset = highFaceGenderOffsets.get(gender);
      const faceVariants = highFaceVariantsByGender.get(gender);
      if (useHighDetail && highFaceOffset !== undefined && faceVariants) {
        const style = Math.floor(sourceIndex / 2) % faceVariants.length;
        const faceBatchOffset = highFaceOffset + (style * 3 + gaze) * 2;
        const skinInstance = highFaceCounts[faceBatchOffset]++;
        const hairInstance = highFaceCounts[faceBatchOffset + 1]++;
        const skinMesh = highFaceBatches[faceBatchOffset];
        const hairMesh = highFaceBatches[faceBatchOffset + 1];
        skinMesh.setMatrixAt(skinInstance, dummy.matrix);
        hairMesh.setMatrixAt(hairInstance, dummy.matrix);
        const skinTone = CROWD_SKIN_TONES[appearance.skinToneIndex];
        skinMesh.setColorAt(
          skinInstance,
          new THREE.Color().setRGB(skinTone[0], skinTone[1], skinTone[2], THREE.SRGBColorSpace),
        );
        hairMesh.setColorAt(hairInstance, new THREE.Color(faceVariants[style].hairColor));
      }
       for (const side of [-1, 1]) {
        const leg = getSeatedCrowdLegTargets(side);
         const localX = leg.ankle[0] * bodyScale.x;
         const localY = ((leg.ankle[1] + leg.toe[1]) / 2 - 0.02) * bodyScale.y;
         const localZ = (leg.ankle[2] + leg.toe[2]) / 2 * bodyScale.z;
        const sinFacing = Math.sin(seat.facing);
        const cosFacing = Math.cos(seat.facing);
        dummy.position.set(
          seat.x + cosFacing * localX + sinFacing * localZ,
          seat.y + localY,
          seat.z - sinFacing * localX + cosFacing * localZ,
        );
        dummy.rotation.set(0, seat.facing, 0);
         dummy.scale.set(bodyScale.x, bodyScale.y, bodyScale.z);
        dummy.updateMatrix();
        shoeMesh.setMatrixAt(shoeInstance, dummy.matrix);
        shoeMesh.setColorAt(
          shoeInstance,
           new THREE.Color(shoeColors[sourceIndex % shoeColors.length]),
        );
        shoeInstance += 1;
      }
    });
    batches.forEach((mesh, index) => {
      mesh.count = counts[index]; mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
    highDetailBatches.forEach((mesh, index) => {
      mesh.count = highDetailCounts[index]; mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
    highFaceBatches.forEach((mesh, index) => {
      mesh.count = highFaceCounts[index]; mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
    shoeMesh.count = shoeInstance;
    shoeMesh.instanceMatrix.needsUpdate = true;
    if (shoeMesh.instanceColor) shoeMesh.instanceColor.needsUpdate = true;
    previousApplause = applauding; lastUpdate = time;
    forceUpdate = false;
  };
  crowd.setHighDetailEnabled = (enabled) => {
    crowd.highDetailEnabled = enabled;
    highDetailEnabled = enabled;
    highDetailBatches.forEach((mesh) => { mesh.visible = enabled; });
    highFaceBatches.forEach((mesh) => { mesh.visible = enabled; });
    forceUpdate = true;
  };
  crowd.setHighDetailModel = (template, genderIndex) => {
    if (!Number.isInteger(genderIndex)
      || genderIndex < 0
      || genderIndex >= templates.length
      || highDetailGenderOffsets.has(genderIndex)) return;
    let faceVariants: [NativeFaceVariant, NativeFaceVariant] | undefined;
    const faceBatchSpecs: { geometry: THREE.BufferGeometry; style: number; gaze: number; part: number }[] = [];
    if (nativeFaces) {
      faceVariants = nativeFaces[genderIndex === 0 ? 'male' : 'female'];
      const fit = fitNativeFaceToTemplate(faceVariants[0], template);
      for (let style = 0; style < faceVariants.length; style++) {
        for (const [gaze, look] of [-0.5, 0, 0.5].entries()) {
          faceBatchSpecs.push({
            geometry: seatedNativeFaceGeometry(template, faceVariants[style].skin, fit, look),
            style,
            gaze,
            part: 0,
          });
          faceBatchSpecs.push({
            geometry: seatedNativeFaceGeometry(template, faceVariants[style].hair, fit, look),
            style,
            gaze,
            part: 1,
          });
        }
      }
    }
    const batchOffset = highDetailBatches.length;
    wardrobeTints[genderIndex % wardrobeTints.length].forEach((tint, wardrobe) => {
      makeBatches(
        template,
        highDetailBatches,
        `high-detail-${genderIndex}-${wardrobe}`,
        tint,
        wardrobe,
        Boolean(faceVariants),
      );
    });
    if (faceVariants) {
      highFaceGenderOffsets.set(genderIndex, highFaceBatches.length);
      highFaceVariantsByGender.set(genderIndex, faceVariants);
      faceBatchSpecs.forEach(({ geometry, style, gaze, part }) => {
        const mesh = new THREE.InstancedMesh(
          geometry,
          new THREE.MeshStandardMaterial({
            color: 0xffffff,
            roughness: part === 0 ? 0.76 : 0.86,
            side: THREE.DoubleSide,
          }),
          batchCapacity,
        );
        mesh.name = `wtsl-native-${part === 0 ? 'face' : 'hair'}-${genderIndex}-${style}-${gaze}`;
        mesh.count = 0;
        mesh.frustumCulled = false;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        scene.add(mesh);
        highFaceBatches.push(mesh);
      });
    }
    highDetailGenderOffsets.set(genderIndex, batchOffset);
    crowd.seats.forEach((seat, index) => {
      if (shouldUseHighDetailCrowdSeat(seat.row, seat.sourceIndex ?? index, genderIndex)) {
        highDetailSeats.add(index);
      }
    });
    highDetailCounts = new Uint16Array(highDetailBatches.length);
    highDetailBatches.forEach((mesh) => { mesh.visible = highDetailEnabled; });
    highFaceCounts = new Uint16Array(highFaceBatches.length);
    highFaceBatches.forEach((mesh) => { mesh.visible = highDetailEnabled; });
    forceUpdate = true;
  };
  crowd.invalidateUpdate = () => {
    forceUpdate = true;
    lastUpdate = -Infinity;
  };
  crowd.replacePeople(update);
  addCrowdAccessories(scene, crowd);
  update(0, false);
  return batches;
}

/** Adds two seated player coaches and a textured, gaze-tracking chair umpire. */
export function attachHumanCourtStaff(
  scene: THREE.Scene,
  fixtures: CourtFixtureRig,
  templates: [THREE.Group, THREE.Group],
  crowd: CrowdRig,
  detailedUmpireTemplate: THREE.Group = templates[0],
  nativeFaces?: NativeFaceSet,
) {
  const coachTints = [0x314a5a, 0x6e493b];
  crowd.staffSeats.forEach((seat, index) => {
    const space = new THREE.Group();
    space.name = `wtsl-coach-space-${index + 1}`;
    space.position.set(seat.x, seat.y, seat.z);
    space.rotation.y = seat.facing;
    space.userData.seatRow = seat.row;
    space.userData.offCourt = true;
    scene.add(space);
    attachStaffModel(
      space,
      templates[index % templates.length],
      `wtsl-court-coach-${index + 1}`,
      coachTints[index % coachTints.length],
      0.4,
      false,
      nativeFaces?.[index % 2 === 0 ? 'male' : 'female'][index % 2],
      index + 2,
    );
  });

  const chair = scene.getObjectByName('wtsl-umpire-chair');
  const placeholder = scene.getObjectByName('wtsl-umpire-placeholder');
  if (!(chair instanceof THREE.Group) || !(placeholder instanceof THREE.Group)) {
    throw new Error('Court fixtures are missing the umpire chair or placeholder.');
  }
  const umpire = attachStaffModel(
    chair,
    detailedUmpireTemplate,
    'wtsl-detailed-umpire',
    0x38536a,
    1.34,
    true,
    nativeFaces?.male[1],
    4,
  );
  umpire.model.userData.role = 'chair-umpire';
  const badge = new THREE.Group();
  badge.name = 'wtsl-umpire-badge';
  badge.userData.role = 'chair-umpire-identification';
  badge.position.set(-0.115, 1.7, 0.2);
  const badgeFrame = new THREE.Mesh(
    new THREE.BoxGeometry(0.075, 0.09, 0.018),
    new THREE.MeshStandardMaterial({ color: 0xb89b61, roughness: 0.68 }),
  );
  const badgeFace = new THREE.Mesh(
    new THREE.BoxGeometry(0.055, 0.068, 0.012),
    new THREE.MeshStandardMaterial({ color: 0xe0ddd2, roughness: 0.78 }),
  );
  badgeFace.position.z = 0.014;
  const badgeStripe = new THREE.Mesh(
    new THREE.BoxGeometry(0.037, 0.012, 0.004),
    new THREE.MeshStandardMaterial({ color: 0x38536a, roughness: 0.72 }),
  );
  badgeStripe.position.set(0, 0.018, 0.022);
  badge.add(badgeFrame, badgeFace, badgeStripe);
  chair.add(badge);
  const headTurn = new THREE.Quaternion();
  placeholder.visible = false;
  fixtures.setDetailedUmpireUpdater((ballPosition) => {
    if (!ballPosition) return;
    chair.updateWorldMatrix(true, false);
    const localBall = chair.worldToLocal(ballPosition.clone());
    const horizontalDistance = Math.max(0.01, Math.hypot(localBall.x, localBall.z));
    const yaw = THREE.MathUtils.clamp(Math.atan2(localBall.x, localBall.z), -0.8, 0.8);
    const pitch = THREE.MathUtils.clamp(
      -Math.atan2(localBall.y - umpire.head.y, horizontalDistance),
      -0.28,
      0.28,
    );
    headTurn.slerp(new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ')), 0.18);
    umpire.pose.begin();
    umpire.pose.place('Head', umpire.head, undefined, headTurn);
    umpire.pose.finish();
  });
}

import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { BROADCAST_PLAYER_KITS, dressNativePlayer } from './DmoNativeKit';

export type NativeFaceVariant = {
  skin: THREE.BufferGeometry;
  hair: THREE.BufferGeometry;
  hairColor: number;
};

export type NativeFaceSet = {
  male: [NativeFaceVariant, NativeFaceVariant];
  female: [NativeFaceVariant, NativeFaceVariant];
};

export type NativeFaceFit = {
  position: THREE.Vector3;
  scale: THREE.Vector3;
};

function vertexWeight(mesh: THREE.SkinnedMesh, vertex: number, boneIndex: number) {
  const indices = mesh.geometry.getAttribute('skinIndex');
  const weights = mesh.geometry.getAttribute('skinWeight');
  if (!indices || !weights) return 0;
  let total = 0;
  for (let component = 0; component < 4; component++) {
    if (indices.getComponent(vertex, component) === boneIndex) {
      total += weights.getComponent(vertex, component);
    }
  }
  return total;
}

function extractBoneSurface(
  mesh: THREE.SkinnedMesh,
  bone: THREE.Bone,
  minimumTriangleWeight = 0.35,
) {
  const geometry = mesh.geometry;
  const positions = geometry.getAttribute('position');
  const sourceIndices = geometry.index;
  const boneIndex = mesh.skeleton.bones.indexOf(bone);
  if (!positions || !sourceIndices || boneIndex < 0) {
    throw new Error(`Native face surface is missing indexed skin data for ${bone.name}.`);
  }
  const meshToBone = new THREE.Matrix4()
    .copy(bone.matrixWorld)
    .invert();
  const result = new THREE.BufferGeometry();
  const points: number[] = [];
  const sourceToResult = new Map<number, number>();
  const indices: number[] = [];
  const vertex = new THREE.Vector3();

  mesh.updateWorldMatrix(true, false);
  bone.updateWorldMatrix(true, false);
  mesh.skeleton.update();
  meshToBone.multiply(mesh.matrixWorld);

  for (let offset = 0; offset < sourceIndices.count; offset += 3) {
    const sourceTriangle = [
      sourceIndices.getX(offset),
      sourceIndices.getX(offset + 1),
      sourceIndices.getX(offset + 2),
    ];
    const triangleWeight = sourceTriangle.reduce(
      (sum, index) => sum + vertexWeight(mesh, index, boneIndex),
      0,
    ) / 3;
    if (triangleWeight < minimumTriangleWeight) continue;

    for (const sourceIndex of sourceTriangle) {
      let resultIndex = sourceToResult.get(sourceIndex);
      if (resultIndex === undefined) {
        vertex.fromBufferAttribute(positions, sourceIndex);
        mesh.applyBoneTransform(sourceIndex, vertex);
        vertex.applyMatrix4(meshToBone);
        resultIndex = points.length / 3;
        points.push(vertex.x, vertex.y, vertex.z);
        sourceToResult.set(sourceIndex, resultIndex);
      }
      indices.push(resultIndex);
    }
  }

  if (indices.length === 0) throw new Error(`Native face mesh has no ${bone.name}-weighted surface.`);
  result.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  result.setIndex(indices);
  result.computeVertexNormals();
  result.computeBoundingBox();
  result.computeBoundingSphere();
  return result;
}

function bakeMeshToBoneLocal(mesh: THREE.Mesh, bone: THREE.Bone) {
  const geometry = mesh.geometry.clone();
  mesh.updateWorldMatrix(true, false);
  bone.updateWorldMatrix(true, false);
  const meshToBone = new THREE.Matrix4().copy(bone.matrixWorld).invert().multiply(mesh.matrixWorld);
  geometry.applyMatrix4(meshToBone);
  geometry.deleteAttribute('skinIndex');
  geometry.deleteAttribute('skinWeight');
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function mergePositionGeometries(parts: THREE.BufferGeometry[]) {
  const output = new THREE.BufferGeometry();
  const positions: number[] = [];
  const indices: number[] = [];
  for (const part of parts) {
    const attribute = part.getAttribute('position');
    const base = positions.length / 3;
    for (let index = 0; index < attribute.count; index++) {
      positions.push(attribute.getX(index), attribute.getY(index), attribute.getZ(index));
    }
    const partIndex = part.index;
    if (partIndex) {
      for (let index = 0; index < partIndex.count; index++) indices.push(base + partIndex.getX(index));
    } else {
      for (let index = 0; index < attribute.count; index++) indices.push(base + index);
    }
    part.dispose();
  }
  output.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  output.setIndex(indices);
  output.computeVertexNormals();
  output.computeBoundingBox();
  output.computeBoundingSphere();
  return output;
}

function makeFaceVariant(template: THREE.Group, female: boolean, kitIndex: 0 | 1): NativeFaceVariant {
  const model = clone(template) as THREE.Group;
  const kit = BROADCAST_PLAYER_KITS[kitIndex];
  dressNativePlayer(model, 0xcda080, female, kit, kitIndex);
  model.updateMatrixWorld(true);

  const head = model.getObjectByName('head');
  if (!(head instanceof THREE.Bone)) {
    throw new Error('Native player model is missing its head joint.');
  }
  let body: THREE.SkinnedMesh | undefined;
  model.traverse((object) => {
    if (!body && object instanceof THREE.SkinnedMesh && object.name !== 'native-cropped-hair') body = object;
  });
  if (!body) throw new Error('Native player model is missing its skinned face surface.');
  const skin = extractBoneSurface(body, head);
  const hairParts: THREE.BufferGeometry[] = [];
  const hairCap = model.getObjectByName('native-cropped-hair');
  if (hairCap instanceof THREE.SkinnedMesh) {
    hairParts.push(extractBoneSurface(hairCap, head, 0.2));
  }
  const accessoryPattern = /native-player-(?:swept-hair|ponytail|hair-|headband|visor|neat-beard|stubble)/;
  for (const child of head.children) {
    if (child instanceof THREE.Bone || !accessoryPattern.test(child.name)) continue;
    child.traverse((object) => {
      if (object instanceof THREE.Mesh && !(object instanceof THREE.SkinnedMesh)) {
        hairParts.push(bakeMeshToBoneLocal(object, head));
      }
    });
  }
  if (!hairParts.length) throw new Error('Native player face has no hairstyle geometry.');

  const hair = mergePositionGeometries(hairParts);
  return { skin, hair, hairColor: kit.hairColor };
}

export function createNativeFaceSet(template: THREE.Group): NativeFaceSet {
  return {
    male: [makeFaceVariant(template, false, 0), makeFaceVariant(template, false, 1)],
    female: [makeFaceVariant(template, true, 0), makeFaceVariant(template, true, 1)],
  };
}

export function fitNativeFaceToTemplate(face: NativeFaceVariant, template: THREE.Group): NativeFaceFit {
  const head = template.getObjectByName('Head');
  const body = template.getObjectByName('body');
  const skinnedBody = body instanceof THREE.SkinnedMesh
    ? body
    : (() => {
      let result: THREE.SkinnedMesh | undefined;
      template.traverse((object) => {
        if (!result && object instanceof THREE.SkinnedMesh) result = object;
      });
      return result;
    })();
  if (!(head instanceof THREE.Bone) || !skinnedBody) {
    throw new Error('Target human model is missing its head joint or skinned mesh.');
  }

  const target = extractBoneSurface(skinnedBody, head, 0.35);
  if (!face.skin.boundingBox) face.skin.computeBoundingBox();
  if (!target.boundingBox) target.computeBoundingBox();
  const sourceBox = face.skin.boundingBox!;
  const targetBox = target.boundingBox!;
  const sourceSize = sourceBox.getSize(new THREE.Vector3());
  const targetSize = targetBox.getSize(new THREE.Vector3());
  if (sourceSize.x <= 0 || sourceSize.y <= 0 || sourceSize.z <= 0
    || targetSize.x <= 0 || targetSize.y <= 0 || targetSize.z <= 0) {
    target.dispose();
    throw new Error('Native face fit could not measure the source or target head.');
  }
  const scale = targetSize.divide(sourceSize);
  const sourceCenter = sourceBox.getCenter(new THREE.Vector3()).multiply(scale);
  const position = targetBox.getCenter(new THREE.Vector3()).sub(sourceCenter);
  target.dispose();
  return { position, scale };
}

export function disposeNativeFaceSet(faceSet: NativeFaceSet) {
  for (const variant of [...faceSet.male, ...faceSet.female]) {
    variant.skin.dispose();
    variant.hair.dispose();
  }
}

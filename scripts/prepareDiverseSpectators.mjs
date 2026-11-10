// Build lightweight, licensed VALID crowd models from reviewed FBX->GLB imports.
// Each file shares textures/rig between full and far meshes. Hands are locked.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshoptSimplifier } from 'three/examples/jsm/libs/meshopt_simplifier.module.js';
import sharp from 'sharp';

const sourceDir = process.argv[2];
if (!sourceDir) throw new Error('Provide the directory containing reviewed, converted VALID GLBs.');
const names = [
  'AIAN_F_1_Casual', 'AIAN_M_1_Casual', 'Asian_F_1_Casual', 'Asian_M_1_Casual',
  'Black_F_1_Casual', 'Black_M_1_Casual', 'Hispanic_F_1_Casual', 'Hispanic_M_1_Casual',
  'MENA_F_1_Casual', 'MENA_M_1_Casual', 'NHPI_M_1_Casual', 'NHPI_M_2_Casual',
  'White_F_1_Casual', 'White_M_1_Casual',
];
const revision = 'c76d2547b5b464415283169d18dffb16bb584eee';
const destination = new URL('../public/models/dmo-humans/', import.meta.url);
const semantics = {
  POSITION: 'position', NORMAL: 'normal', TEXCOORD_0: 'uv',
  JOINTS_0: 'skinIndex', WEIGHTS_0: 'skinWeight',
};
const component = {
  5120: [Int8Array, 1, 'getInt8'], 5121: [Uint8Array, 1, 'getUint8'],
  5122: [Int16Array, 2, 'getInt16'], 5123: [Uint16Array, 2, 'getUint16'],
  5125: [Uint32Array, 4, 'getUint32'], 5126: [Float32Array, 4, 'getFloat32'],
};
const typeSize = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
await MeshoptSimplifier.ready;
const provenance = [];
for (const name of names) {
  const bytes = await readFile(`${sourceDir}/${name}.glb`);
  const jsonLength = bytes.readUInt32LE(12);
  const source = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  const binary = bytes.subarray(28 + jsonLength);
  if (!source.skins?.every(s => s.joints.length >= 50 && s.joints.every(Number.isInteger))
    || source.nodes.filter(n => n.name === 'Hips').length !== 1) {
    throw new Error(`${name} does not contain one coherent attached skeleton.`);
  }
  const out = structuredClone(source);
  out.accessors = []; out.bufferViews = []; out.meshes = [];
  delete out.animations;
  const chunks = [];
  let byteOffset = 0;
  function view(data, target) {
    const id = out.bufferViews.length;
    out.bufferViews.push({ buffer: 0, byteOffset, byteLength: data.length, ...(target ? { target } : {}) });
    const padding = Buffer.alloc((4 - data.length % 4) % 4);
    chunks.push(data, padding); byteOffset += data.length + padding.length;
    return id;
  }
  function values(id) {
    const a = source.accessors[id], b = source.bufferViews[a.bufferView];
    const count = typeSize[a.type], [ArrayType, width, getter] = component[a.componentType];
    const result = new ArrayType(a.count * count);
    const data = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
    for (let i = 0; i < a.count; i++) for (let c = 0; c < count; c++) {
      result[i * count + c] = data[getter]((b.byteOffset ?? 0) + (a.byteOffset ?? 0)
        + i * (b.byteStride ?? width * count) + c * width, true);
    }
    return new THREE.BufferAttribute(result, count, Boolean(a.normalized));
  }
  function accessor(attribute, target, semantic) {
    const id = out.accessors.length, array = attribute.array;
    const componentType = Object.entries(component).find(([, [ArrayType]]) => array instanceof ArrayType)[0];
    const item = {
      bufferView: view(Buffer.from(array.buffer, array.byteOffset, array.byteLength), target),
      componentType: Number(componentType), count: attribute.count,
      type: Object.keys(typeSize).find(key => typeSize[key] === attribute.itemSize),
      ...(attribute.normalized ? { normalized: true } : {}),
    };
    if (semantic === 'POSITION') {
      item.min = [Infinity, Infinity, Infinity]; item.max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < attribute.count; i++) for (let c = 0; c < 3; c++) {
        item.min[c] = Math.min(item.min[c], attribute.getComponent(i, c));
        item.max[c] = Math.max(item.max[c], attribute.getComponent(i, c));
      }
    }
    out.accessors.push(item);
    return id;
  }
  for (const [i, skin] of out.skins.entries()) {
    skin.inverseBindMatrices = accessor(values(source.skins[i].inverseBindMatrices));
  }
  for (const image of out.images) {
    const original = source.bufferViews[image.bufferView];
    const data = binary.subarray(original.byteOffset ?? 0, (original.byteOffset ?? 0) + original.byteLength);
    const webp = await sharp(data).resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 88, alphaQuality: 100 }).toBuffer();
    image.bufferView = view(webp);
    image.mimeType = 'image/webp';
  }
  for (const texture of out.textures) {
    texture.extensions = { ...texture.extensions, EXT_texture_webp: { source: texture.source } };
    delete texture.source;
  }
  out.extensionsUsed = [...new Set([...(out.extensionsUsed ?? []), 'EXT_texture_webp', 'KHR_mesh_quantization'])];
  out.extensionsRequired = [...new Set([...(out.extensionsRequired ?? []), 'EXT_texture_webp', 'KHR_mesh_quantization'])];
  const meshPairs = [];
  let fullTriangles = 0, farTriangles = 0;
  for (const [meshIndex, mesh] of source.meshes.entries()) {
    const skinIndex = source.nodes.find(n => n.mesh === meshIndex)?.skin;
    if (skinIndex === undefined) throw new Error(`${name}: unskinned crowd mesh.`);
    const skin = source.skins[skinIndex];
    const pair = {};
    for (const detail of ['full', 'far']) {
      const primitives = [];
      for (const primitive of mesh.primitives) {
        const raw = new THREE.BufferGeometry();
        for (const [semantic, attributeName] of Object.entries(semantics)) {
          if (primitive.attributes[semantic] !== undefined) raw.setAttribute(attributeName, values(primitive.attributes[semantic]));
        }
        if (primitive.indices !== undefined) raw.setIndex(values(primitive.indices));
        const geometry = mergeVertices(raw, 0.000001);
        raw.dispose();
        const position = geometry.attributes.position, uv = geometry.attributes.uv;
        const joints = geometry.attributes.skinIndex, weights = geometry.attributes.skinWeight;
        const lock = new Uint8Array(position.count);
        for (let i = 0; i < lock.length; i++) for (let c = 0; c < 4; c++) {
          if (weights.getComponent(i, c) > 0.01
            && /Hand|Finger/.test(source.nodes[skin.joints[joints.getComponent(i, c)]].name)) lock[i] = 1;
        }
        const budget = geometry.index.count / 3 > 15000 ? (detail === 'full' ? 12000 : 3500)
          : geometry.index.count / 3 > 2000 ? (detail === 'full' ? 2000 : 600)
          : (detail === 'full' ? 400 : 120);
        const target = Math.min(geometry.index.count, budget * 3);
        const [indices] = MeshoptSimplifier.simplifyWithAttributes(
          geometry.index.array, position.array, 3, uv.array, 2, [0.1, 0.1],
          lock, target, detail === 'full' ? 0.003 : 0.012, ['LockBorder'],
        );
        const used = [...new Set(indices)];
        const remap = new Map(used.map((old, index) => [old, index]));
        const attributes = {};
        for (const [semantic, attributeName] of Object.entries(semantics)) {
          const original = geometry.attributes[attributeName];
          if (!original) continue;
          const ArrayType = semantic === 'NORMAL' ? Int8Array : semantic === 'TEXCOORD_0' ? Uint16Array
            : semantic === 'JOINTS_0' ? Uint8Array : Float32Array;
          const normalized = semantic === 'NORMAL' || semantic === 'TEXCOORD_0';
          const compact = new THREE.BufferAttribute(new ArrayType(used.length * original.itemSize), original.itemSize, normalized);
          used.forEach((old, index) => {
            for (let c = 0; c < original.itemSize; c++) compact.setComponent(index, c, original.getComponent(old, c));
          });
          attributes[semantic] = accessor(compact, 34962, semantic);
        }
        const IndexType = used.length > 65535 ? Uint32Array : Uint16Array;
        const compactIndices = new THREE.BufferAttribute(new IndexType(Array.from(indices, old => remap.get(old))), 1);
        primitives.push({ attributes, indices: accessor(compactIndices, 34963), material: primitive.material });
        if (detail === 'full') fullTriangles += indices.length / 3;
        else farTriangles += indices.length / 3;
        geometry.dispose();
      }
      pair[detail] = out.meshes.length;
      out.meshes.push({ primitives });
    }
    meshPairs.push(pair);
  }
  const originalNodeCount = source.nodes.length;
  for (let i = 0; i < originalNodeCount; i++) {
    const original = source.nodes[i];
    if (original.mesh === undefined) continue;
    out.nodes[i].mesh = meshPairs[original.mesh].full;
    out.nodes[i].extras = { ...original.extras, spectatorDetail: 'full' };
    const far = { ...structuredClone(original), name: `${original.name ?? 'spectator'}_far`,
      mesh: meshPairs[original.mesh].far, extras: { ...original.extras, spectatorDetail: 'far' } };
    delete far.children;
    const farId = out.nodes.length;
    out.nodes.push(far);
    const parent = out.nodes.find(n => n.children?.includes(i));
    if (parent) parent.children.push(farId);
    else for (const scene of out.scenes) if (scene.nodes.includes(i)) scene.nodes.push(farId);
  }
  out.buffers = [{ byteLength: byteOffset }];
  const binaryOut = Buffer.concat(chunks);
  let json = Buffer.from(JSON.stringify(out));
  json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)]);
  const header = Buffer.alloc(20), binaryHeader = Buffer.alloc(8);
  header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + json.length + binaryOut.length, 8);
  header.writeUInt32LE(json.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  binaryHeader.writeUInt32LE(binaryOut.length); binaryHeader.writeUInt32LE(0x004e4942, 4);
  const output = Buffer.concat([header, json, binaryHeader, binaryOut]);
  const id = name.toLowerCase().replaceAll('_', '-');
  const filename = `valid-${id}.glb`;
  await writeFile(new URL(filename, destination), output);
  const group = name.split('_')[0];
  provenance.push({
    id: `valid-${id}`, filename, gender: name.includes('_F_') ? 'female' : 'male',
    source: `https://github.com/google/valid-avatar-library/blob/${revision}/Avatars/${group}/${name}.fbx`,
    convertedSha256: createHash('sha256').update(bytes).digest('hex'), license: 'MIT',
    bytes: output.length, fullTriangles, farTriangles,
    modifications: 'Original identity and outfit preserved; shared attached rig; unused facial morphs and mouth interiors removed; hand-locked full/far LODs share WebP textures; normals/UVs packed without changing positions or skin weights.',
  });
  console.log(filename, output.length, fullTriangles, farTriangles);
}
await writeFile(new URL('valid-spectator-provenance.json', destination), JSON.stringify(provenance, null, 2) + '\n');

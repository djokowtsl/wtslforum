// Reproducible spectator assets. Original connected geometry, UVs and rig are
// retained; unused facial morphs are omitted. Far LOD locks every hand vertex.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { MeshoptSimplifier } from 'three/examples/jsm/libs/meshopt_simplifier.module.js';
import sharp from 'sharp';

const revision = 'fc1398c2f8ba600c3676a5277684ed4f3e2731d7';
const root = new URL('../public/models/dmo-humans/', import.meta.url);
const sourceDir = process.argv[2];
await mkdir(root, { recursive: true });
await MeshoptSimplifier.ready;
const provenance = [];
for (const [gender, original] of [['male', 'aarav'], ['female', 'ananya']]) {
  const source = `https://raw.githubusercontent.com/927tanmay/react-ai-voice-avatar/${revision}/assets/avatars/${original}.glb`;
  const bytes = sourceDir ? await readFile(`${sourceDir}/${gender}.glb`) : Buffer.from(await (await fetch(source)).arrayBuffer());
  const jsonLength = bytes.readUInt32LE(12);
  const originalJson = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  const binary = bytes.subarray(28 + jsonLength);
  for (const detail of ['full', 'far']) {
    const gltf = structuredClone(originalJson);
    delete gltf.animations;
    for (const node of gltf.nodes) delete node.weights;
    const extraViews = new Map();
    for (const image of gltf.images) {
      const view = gltf.bufferViews[image.bufferView];
      const source = binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
      const data = await sharp(source).webp({ quality: 90, alphaQuality: 100 }).toBuffer();
      extraViews.set(image.bufferView, data);
      view.byteLength = data.length;
      image.mimeType = 'image/webp';
    }
    for (const texture of gltf.textures) {
      texture.extensions = { ...texture.extensions, EXT_texture_webp: { source: texture.source } };
      delete texture.source;
    }
    gltf.extensionsUsed = [...new Set([...(gltf.extensionsUsed ?? []), 'EXT_texture_webp'])];
    gltf.extensionsRequired = [...new Set([...(gltf.extensionsRequired ?? []), 'EXT_texture_webp'])];
    function accessorValues(id) {
      const a = gltf.accessors[id], view = gltf.bufferViews[a.bufferView];
      const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type];
      const [width, method] = { 5121: [1, 'getUint8'], 5123: [2, 'getUint16'], 5125: [4, 'getUint32'], 5126: [4, 'getFloat32'] }[a.componentType];
      const data = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
      const result = new Float32Array(a.count * components);
      for (let i = 0; i < a.count; i++) for (let c = 0; c < components; c++) {
        const offset = (view.byteOffset ?? 0) + (a.byteOffset ?? 0) + i * (view.byteStride ?? components * width) + c * width;
        result[i * components + c] = data[method](offset, true);
      }
      return result;
    }
    for (const mesh of gltf.meshes) {
      delete mesh.weights;
      delete mesh.extras;
      for (const [part, primitive] of mesh.primitives.entries()) {
        delete primitive.targets;
        if (detail !== 'far') continue;
        const positions = accessorValues(primitive.attributes.POSITION);
        const uv = accessorValues(primitive.attributes.TEXCOORD_0);
        const joints = accessorValues(primitive.attributes.JOINTS_0);
        const weights = accessorValues(primitive.attributes.WEIGHTS_0);
        const skin = gltf.skins[0];
        const lock = new Uint8Array(positions.length / 3);
        for (let i = 0; i < lock.length; i++) for (let c = 0; c < 4; c++) {
          const name = gltf.nodes[skin.joints[joints[i * 4 + c]]].name;
          if (/Hand/.test(name) && weights[i * 4 + c] > 0.01) lock[i] = 1;
        }
        const indices = new Uint32Array(accessorValues(primitive.indices));
        const target = Math.min(indices.length, [1900, 1000, 250][part] * 3);
        const [simplified] = MeshoptSimplifier.simplifyWithAttributes(
          indices, positions, 3, uv, 2, [0.1, 0.1], lock, target, 0.012, ['LockBorder'],
        );
        const viewId = gltf.bufferViews.length;
        const data = Buffer.from(simplified.buffer, simplified.byteOffset, simplified.byteLength);
        gltf.bufferViews.push({ buffer: 0, byteLength: data.length, target: 34963 });
        extraViews.set(viewId, data);
        primitive.indices = gltf.accessors.length;
        gltf.accessors.push({ bufferView: viewId, componentType: 5125, count: simplified.length, type: 'SCALAR' });
      }
    }
    const used = new Set();
    for (const mesh of gltf.meshes) for (const p of mesh.primitives) {
      Object.values(p.attributes).forEach(id => used.add(id));
      used.add(p.indices);
    }
    gltf.skins.forEach(s => used.add(s.inverseBindMatrices));
    const accessorIds = [...used].sort((a, b) => a - b);
    const remap = new Map(accessorIds.map((id, index) => [id, index]));
    const accessors = accessorIds.map(id => gltf.accessors[id]);
    for (const mesh of gltf.meshes) for (const p of mesh.primitives) {
      for (const key of Object.keys(p.attributes)) p.attributes[key] = remap.get(p.attributes[key]);
      p.indices = remap.get(p.indices);
    }
    gltf.skins.forEach(s => { s.inverseBindMatrices = remap.get(s.inverseBindMatrices); });
    const views = [...new Set([...accessors.map(a => a.bufferView), ...gltf.images.map(i => i.bufferView)])];
    const viewMap = new Map(views.map((id, index) => [id, index]));
    const chunks = [];
    let offset = 0;
    gltf.bufferViews = views.map(id => {
      const view = gltf.bufferViews[id];
      const data = extraViews.get(id) ?? binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
      const result = { ...view, byteOffset: offset };
      const padding = Buffer.alloc((4 - data.length % 4) % 4);
      chunks.push(data, padding);
      offset += data.length + padding.length;
      return result;
    });
    accessors.forEach(a => { a.bufferView = viewMap.get(a.bufferView); });
    gltf.images.forEach(i => { i.bufferView = viewMap.get(i.bufferView); });
    gltf.accessors = accessors;
    gltf.buffers = [{ byteLength: offset }];
    const data = Buffer.concat(chunks);
    let json = Buffer.from(JSON.stringify(gltf));
    json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)]);
    const header = Buffer.alloc(20), binHeader = Buffer.alloc(8);
    header.write('glTF'); header.writeUInt32LE(2, 4);
    header.writeUInt32LE(28 + json.length + data.length, 8);
    header.writeUInt32LE(json.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
    binHeader.writeUInt32LE(data.length); binHeader.writeUInt32LE(0x004e4942, 4);
    const output = Buffer.concat([header, json, binHeader, data]);
    const filename = `rocketbox-${gender}-${detail}.glb`;
    await writeFile(new URL(filename, root), output);
    provenance.push({ filename, bytes: output.length, triangles: gltf.meshes.flatMap(m => m.primitives).reduce((sum, p) => sum + gltf.accessors[p.indices].count / 3, 0),
      source, sourceSha256: createHash('sha256').update(bytes).digest('hex'), license: 'MIT',
      modifications: detail === 'full' ? 'Unused facial morph buffers removed; textures converted to quality-90 WebP; original mesh and rig retained.' : 'Hand vertices locked during UV-aware far-LOD simplification; textures converted to quality-90 WebP; original vertex positions and rig retained.' });
  }
}
await writeFile(new URL('rocketbox-provenance.json', root), JSON.stringify(provenance, null, 2) + '\n');
console.log(provenance.map(p => ({ filename: p.filename, bytes: p.bytes, triangles: p.triangles })));

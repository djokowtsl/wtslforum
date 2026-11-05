/**
 * Prepare small, self-contained CC0 web assets. Originals are never committed.
 * Usage: node tools/prepareDmoHumanModels.mjs /tmp/wtsl-human-models
 * Requires the development toolchain's meshoptimizer and sharp packages.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { MeshoptSimplifier } from 'meshoptimizer';

await MeshoptSimplifier.ready;
const sourceDir = process.argv[2];
if (!sourceDir) throw new Error('Pass the directory containing male.glb and female.glb.');
const outDir = path.resolve('public/models/dmo-humans');
await fs.mkdir(outDir, { recursive: true });
const sizes = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const types = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const methods = { 5121: 'getUint8', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' };
const provenance = [];

for (const gender of ['male', 'female']) {
  const raw = await fs.readFile(path.join(sourceDir, `${gender}.glb`));
  if (raw.toString('ascii', 0, 4) !== 'glTF') throw new Error('Expected GLB.');
  const jsonLength = raw.readUInt32LE(12);
  const original = JSON.parse(raw.toString('utf8', 20, 20 + jsonLength));
  const bin = raw.subarray(28 + jsonLength);
  const read = (index) => {
    const a = original.accessors[index], v = original.bufferViews[a.bufferView];
    const Typed = types[a.componentType], width = sizes[a.type];
    if (!Typed || !width || a.sparse) throw new Error('Unsupported source accessor.');
    const output = new Typed(a.count * width);
    const data = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
    const stride = v.byteStride ?? width * Typed.BYTES_PER_ELEMENT;
    for (let i = 0; i < a.count; i++) for (let c = 0; c < width; c++) {
      output[i * width + c] = data[methods[a.componentType]](
        (v.byteOffset ?? 0) + (a.byteOffset ?? 0) + i * stride + c * Typed.BYTES_PER_ELEMENT, true);
    }
    return output;
  };
  const primitive = original.meshes[0].primitives[0];
  const attributes = Object.fromEntries(Object.entries(primitive.attributes).map(([key, id]) => [key, read(id)]));
  const indices = new Uint32Array(read(primitive.indices));
  const count = attributes.POSITION.length / 3;
  const errorAttributes = new Float32Array(count * 9);
  for (let i = 0; i < count; i++) {
    errorAttributes.set(attributes.NORMAL.subarray(i * 3, i * 3 + 3), i * 9);
    errorAttributes.set(attributes.TEXCOORD_0.subarray(i * 2, i * 2 + 2), i * 9 + 3);
    errorAttributes.set(attributes.WEIGHTS_0.subarray(i * 4, i * 4 + 4), i * 9 + 5);
  }

  for (const [detail, triangles, textureSize] of [['player', 14000, 1024], ['crowd', 1800, 256]]) {
    const [reduced, error] = MeshoptSimplifier.simplifyWithAttributes(
      indices, attributes.POSITION, 3, errorAttributes, 9,
      [0.1, 0.1, 0.1, 8, 8, 2, 2, 2, 2], null, triangles * 3, 0.08, ['Permissive']);
    const selected = [...new Set(reduced)];
    const remap = new Map(selected.map((old, i) => [old, i]));
    const g = {
      asset: { version: '2.0', generator: 'WTSL CC0 human asset preparation' },
      scene: original.scene ?? 0, scenes: original.scenes, nodes: original.nodes,
      meshes: [{ ...original.meshes[0], primitives: [{ ...primitive, attributes: {} }] }],
      skins: structuredClone(original.skins), materials: original.materials,
      textures: original.textures, samplers: original.samplers, images: [],
      accessors: [], bufferViews: [], buffers: [],
    };
    const chunks = [];
    let offset = 0;
    const addView = (data, target) => {
      const aligned = (offset + 3) & ~3;
      if (aligned > offset) chunks.push(Buffer.alloc(aligned - offset));
      const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
      const index = g.bufferViews.length;
      g.bufferViews.push({ buffer: 0, byteOffset: aligned, byteLength: bytes.length, ...(target ? { target } : {}) });
      chunks.push(bytes); offset = aligned + bytes.length;
      return index;
    };
    const addAccessor = (data, template, target) => {
      const accessor = { ...template, bufferView: addView(data, target), byteOffset: 0, count: data.length / sizes[template.type] };
      delete accessor.min; delete accessor.max;
      if (template.type === 'VEC3' && target === 34962 && template === original.accessors[primitive.attributes.POSITION]) {
        accessor.min = [Infinity, Infinity, Infinity]; accessor.max = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < data.length; i++) {
          const c = i % 3; accessor.min[c] = Math.min(accessor.min[c], data[i]); accessor.max[c] = Math.max(accessor.max[c], data[i]);
        }
      }
      g.accessors.push(accessor); return g.accessors.length - 1;
    };
    for (const [key, id] of Object.entries(primitive.attributes)) {
      const a = original.accessors[id], source = attributes[key], width = sizes[a.type];
      let packed = new source.constructor(selected.length * width);
      selected.forEach((old, i) => packed.set(source.subarray(old * width, old * width + width), i * width));
      let template = a;
      if (key === 'WEIGHTS_0') {
        const quantized = new Uint8Array(packed.length);
        for (let i = 0; i < selected.length; i++) {
          let sum = 0, largest = 0;
          for (let c = 0; c < 4; c++) {
            quantized[i * 4 + c] = Math.round(packed[i * 4 + c] * 255);
            sum += quantized[i * 4 + c];
            if (packed[i * 4 + c] > packed[i * 4 + largest]) largest = c;
          }
          quantized[i * 4 + largest] += 255 - sum;
        }
        packed = quantized;
        template = { ...a, componentType: 5121, normalized: true };
      }
      g.meshes[0].primitives[0].attributes[key] = addAccessor(packed, template, 34962);
    }
    const packedIndices = selected.length < 65536 ? new Uint16Array(reduced.length) : new Uint32Array(reduced.length);
    reduced.forEach((old, i) => { packedIndices[i] = remap.get(old); });
    g.meshes[0].primitives[0].indices = addAccessor(packedIndices, {
      ...original.accessors[primitive.indices], componentType: packedIndices instanceof Uint16Array ? 5123 : 5125,
    }, 34963);
    for (let i = 0; i < g.skins.length; i++) {
      const id = original.skins[i].inverseBindMatrices;
      g.skins[i].inverseBindMatrices = addAccessor(read(id), original.accessors[id]);
    }
    for (const image of original.images) {
      const view = original.bufferViews[image.bufferView];
      const bytes = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
      const resized = await sharp(bytes).resize(textureSize, textureSize, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: detail === 'player' ? 88 : 78 }).toBuffer();
      g.images.push({ name: image.name, mimeType: 'image/jpeg', bufferView: addView(resized) });
    }
    const binary = Buffer.concat(chunks);
    const paddedBin = Buffer.concat([binary, Buffer.alloc((4 - binary.length % 4) % 4)]);
    g.buffers = [{ byteLength: paddedBin.length }];
    const json = Buffer.from(JSON.stringify(g));
    const paddedJson = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
    const header = Buffer.alloc(20); header.write('glTF'); header.writeUInt32LE(2, 4);
    header.writeUInt32LE(28 + paddedJson.length + paddedBin.length, 8);
    header.writeUInt32LE(paddedJson.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
    const binaryHeader = Buffer.alloc(8); binaryHeader.writeUInt32LE(paddedBin.length); binaryHeader.writeUInt32LE(0x004e4942, 4);
    const result = Buffer.concat([header, paddedJson, binaryHeader, paddedBin]);
    if (result.length > 1_000_000) throw new Error(`Web asset budget exceeded: ${result.length}`);
    const filename = `${gender}-${detail}.glb`;
    await fs.writeFile(path.join(outDir, filename), result);
    provenance.push({ filename, bytes: result.length, triangles: reduced.length / 3, simplificationError: error,
      source: `https://grab3d.com/dl/${gender === 'male' ? 'man' : 'woman'}-base-character-rigged/${gender === 'male' ? 'man' : 'woman'}-base-character-rigged.glb`,
      sourceSha256: crypto.createHash('sha256').update(raw).digest('hex'), license: 'CC0-1.0' });
    console.log(filename, result.length, 'bytes', reduced.length / 3, 'triangles');
  }
}
await fs.writeFile(path.join(outDir, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n');

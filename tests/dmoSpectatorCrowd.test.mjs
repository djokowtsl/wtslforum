import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');
async function loadTs(path, overrides = {}) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const { code } = transformSync(source, {
    jsc: { parser: { syntax: 'typescript' }, target: 'es2022' }, module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', code)(module, module.exports, name => overrides[name] ?? require(name));
  return module.exports;
}
const poseApi = await loadTs('../components/DmoSpectatorPose.ts');
const skinApi = await loadTs('../components/DmoSpectatorSkin.ts');
const lod = await loadTs('../lib/dmoCrowdLod.ts');
const api = await loadTs('../components/DmoSpectatorCrowd.ts', {
  './DmoSpectatorPose': poseApi,
  './DmoSpectatorSkin': skinApi,
  '../lib/dmoCrowdLod': lod,
  './DmoLiveCourt3DScene': { getCrowdAppearance: i => ({ gender: i % 2 ? 'female' : 'male', stature: 1, wardrobe: i % 8 }) },
});
async function model(gender, detail, filename = `rocketbox-${gender}-${detail}.glb`) {
  const bytes = await readFile(new URL(`../public/models/dmo-humans/${filename}`, import.meta.url));
  const length = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + length));
  // No DOM image decoder in Node; geometry/rig are unchanged. Textures and the
  // clothing shader are verified in the actual browser/stadium rendering.
  gltf.images = []; gltf.textures = []; gltf.materials = [];
  delete gltf.extensionsUsed; delete gltf.extensionsRequired;
  gltf.meshes.forEach(m => m.primitives.forEach(p => { delete p.material; }));
  let json = Buffer.from(JSON.stringify(gltf));
  json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)]);
  const header = Buffer.from(bytes.subarray(0, 20));
  const result = Buffer.concat([header, json, bytes.subarray(20 + length)]);
  result.writeUInt32LE(result.length, 8); result.writeUInt32LE(json.length, 12);
  const parsed = await new GLTFLoader().parseAsync(result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength), '');
  parsed.scene.traverse(object => {
    if (object instanceof THREE.SkinnedMesh) object.material.name = '_body';
    const detail = object.userData.spectatorDetail;
    if (detail) object.traverse(child => { child.userData.spectatorDetail = detail; });
  });
  parsed.scene.userData.spectatorGender = gender;
  parsed.scene.userData.spectatorIdentity = filename;
  return parsed.scene;
}
const templates = {};
for (const gender of ['male', 'female']) for (const detail of ['far', 'full']) templates[`${gender}-${detail}`] = await model(gender, detail);
function p(model, name) { return model.getObjectByName(name).getWorldPosition(new THREE.Vector3()); }

for (const gender of ['male', 'female']) for (const detail of ['far', 'full']) {
  test(`${gender} ${detail}: native finger rig, fixed limb lengths and inward resting hands`, () => {
    const template = templates[`${gender}-${detail}`];
    const original = [];
    template.traverse(object => { if (object instanceof THREE.SkinnedMesh) original.push(Array.from(object.geometry.attributes.position.array)); });
    for (const applause of ['rest', 'open', 'closed']) {
      const posed = clone(template);
      posed.updateMatrixWorld(true);
      const segments = ['Left', 'Right'].flatMap(side => [
        [`${side}Arm`, `${side}ForeArm`], [`${side}ForeArm`, `${side}Hand`],
        [`${side}UpLeg`, `${side}Leg`], [`${side}Leg`, `${side}Foot`],
      ]).map(([a, b]) => [a, b, p(posed, a).distanceTo(p(posed, b))]);
      const scales = new Map();
      posed.traverse(object => { if (object instanceof THREE.Bone) scales.set(object.name, object.scale.toArray()); });
      poseApi.poseSpectator(posed, applause);
      for (const [a, b, length] of segments) {
        const actual = p(posed, a).distanceTo(p(posed, b));
        // Float32 imported transforms can accumulate micrometre-scale error.
        assert.ok(Math.abs(actual - length) < 0.0001, `${a} is not stretched: ${length} -> ${actual}`);
      }
      posed.traverse(object => {
        if (object instanceof THREE.Bone) assert.deepEqual(object.scale.toArray(), scales.get(object.name));
      });
      for (const [prefix, side] of [['Left', 1], ['Right', -1]]) {
        const wrist = p(posed, `${prefix}Hand`);
        const direction = p(posed, `${prefix}HandMiddle1`).sub(wrist).normalize();
        const radial = p(posed, `${prefix}HandIndex1`).sub(p(posed, `${prefix}HandPinky1`)).normalize();
        const palm = direction.clone().cross(radial).multiplyScalar(side).normalize();
        if (applause === 'rest') {
          assert.ok(direction.z > 0.98, 'resting fingertips point towards the camera');
          assert.ok(Math.abs(direction.x) < 0.02, 'resting fingers do not point sideways across the lap');
          assert.ok(palm.y < -0.9, 'resting palm points down');
          assert.ok(p(posed, `${prefix}HandThumb3`).y > p(posed, `${prefix}HandThumb1`).y - 0.025,
            'resting thumb does not hang sharply down through the lap');
          const thumbBase = p(posed, `${prefix}HandThumb1`);
          const thumbNext = p(posed, `${prefix}HandThumb2`);
          const thumbTip = p(posed, `${prefix}HandThumb3`);
          const palmCenter = p(posed, `${prefix}HandIndex1`).add(p(posed, `${prefix}HandMiddle1`))
            .add(p(posed, `${prefix}HandPinky1`)).multiplyScalar(1 / 3);
          assert.ok((thumbNext.x - thumbBase.x) * side < 0,
            'thumb base preserves a small amount of outward web space');
          assert.ok(thumbTip.clone().sub(thumbNext).normalize().z > 0.98,
            'thumb points forward in the same plane as the fingers');
          assert.ok((p(posed, `${prefix}HandIndex1`).x - thumbTip.x) * side > 0.008,
            'thumb retains a visible gap beside the index finger');
          assert.ok(thumbTip.distanceTo(palmCenter) < thumbBase.distanceTo(palmCenter),
            'resting thumb tucks closer to the other fingers');
          for (const finger of ['Index', 'Middle', 'Ring', 'Pinky']) for (const joint of [1, 2]) {
            const segment = p(posed, `${prefix}Hand${finger}${joint + 1}`)
              .sub(p(posed, `${prefix}Hand${finger}${joint}`)).normalize();
            assert.ok(segment.z > 0.98 && Math.abs(segment.y) < 0.08,
              'each resting finger joint is relaxed forward, not left in the source gripping curl');
          }
        } else {
          assert.ok(direction.y > 0.9);
          assert.ok(palm.x * side < -0.9, 'clapping palm faces the opposite hand');
        }
        for (const finger of ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky']) {
          for (const joint of [1, 2, 3]) assert.ok(posed.getObjectByName(`${prefix}Hand${finger}${joint}`));
        }
      }
      const baked = api.bakeSpectator(template, applause);
      assert.ok(Array.from(baked.geometry.attributes.position.array).every(Number.isFinite));
      assert.equal(baked.geometry.groups.reduce((sum, g) => sum + g.count, 0), baked.geometry.index.count);
      assert.equal(baked.geometry.userData.continuousHands, true);
      baked.geometry.dispose(); baked.materials.forEach(m => m.dispose());
    }
    const after = [];
    template.traverse(object => { if (object instanceof THREE.SkinnedMesh) after.push(Array.from(object.geometry.attributes.position.array)); });
    assert.deepEqual(after, original, 'posing never rewrites the authored hand/body geometry');
  });
}

test('far LOD keeps every all-hand triangle from the approved complete model', () => {
  for (const gender of ['male', 'female']) {
    const meshes = detail => {
      const result = [];
      templates[`${gender}-${detail}`].traverse(o => { if (o instanceof THREE.SkinnedMesh) result.push(o); });
      return result;
    };
    const full = meshes('full'), far = meshes('far');
    let protectedTriangles = 0, farTriangles = 0;
    for (const [part, object] of full.entries()) {
      const source = object.geometry, target = far[part].geometry;
      assert.deepEqual(target.attributes.position.array, source.attributes.position.array);
      const key = (index, i) => [index.getX(i), index.getX(i + 1), index.getX(i + 2)].sort((a, b) => a - b).join(',');
      const retained = new Set();
      for (let i = 0; i < target.index.count; i += 3) retained.add(key(target.index, i));
      const isHand = vertex => {
        for (let c = 0; c < 4; c++) if (source.attributes.skinWeight.getComponent(vertex, c) > 0.01
          && /Hand/.test(object.skeleton.bones[source.attributes.skinIndex.getComponent(vertex, c)].name)) return true;
        return false;
      };
      for (let i = 0; i < source.index.count; i += 3) {
        if ([0, 1, 2].every(c => isHand(source.index.getX(i + c)))) {
          protectedTriangles++;
          assert.ok(retained.has(key(source.index, i)), 'hand surface triangle survives far LOD');
        }
      }
      farTriangles += target.index.count / 3;
    }
    assert.ok(protectedTriangles > 200);
    assert.ok(farTriangles < 4200);
  }
});

test('spectator gaze uses an instanced head-only shader instead of duplicate look meshes', () => {
  const baked = api.bakeSpectator(templates['male-far'], 'rest');
  const headMask = baked.geometry.getAttribute('spectatorHeadMask');
  assert.ok(headMask);
  assert.ok(Array.from(headMask.array).some(weight => weight > 0.5));
  const shader = {
    uniforms: {},
    vertexShader: '#include <common>\n#include <beginnormal_vertex>\n#include <begin_vertex>',
    fragmentShader: '#include <common>\n#include <color_fragment>',
  };
  baked.materials[0].onBeforeCompile(shader, {});
  assert.match(shader.vertexShader, /attribute vec2 spectatorGaze/);
  assert.match(shader.vertexShader, /spectatorHeadPivot/);
  assert.match(shader.vertexShader, /vSpectatorClothing = spectatorClothing/);
  assert.match(shader.vertexShader, /vSpectatorTint = spectatorTint/);
  assert.ok(shader.uniforms.spectatorHeadPivot.value.isVector3);
  baked.geometry.dispose();
  baked.materials.forEach(material => material.dispose());
});

test('gaze updates turn heads in both directions without rotating seated bodies', () => {
  const scene = new THREE.Scene();
  const crowd = {
    highDetailEnabled: false,
    seats: [{ x: 0, y: 0, z: 0, facing: 0, row: 5, sourceIndex: 0, occupied: true }],
    replacePeople(update) { this.update = update; },
  };
  api.attachSpectatorCrowd(scene, crowd, [templates['male-far'], templates['female-far']]);
  const mesh = scene.getObjectByName('wtsl-spectator-far-0-rest');
  const gaze = mesh.geometry.getAttribute('spectatorGaze');
  crowd.update(1, false, new THREE.Vector3(8, 1, 0));
  assert.ok(Math.abs(gaze.getX(0) - Math.cos(0.4)) < 0.00001);
  assert.ok(Math.abs(gaze.getY(0) - Math.sin(0.4)) < 0.00001);
  const body = mesh.instanceMatrix.array.slice(0, 16);
  crowd.update(2, false, new THREE.Vector3(-8, 1, 0));
  assert.ok(Math.abs(gaze.getY(0) + Math.sin(0.4)) < 0.00001);
  assert.deepEqual(mesh.instanceMatrix.array.slice(0, 16), body);
  crowd.update(3, false, new THREE.Vector3(0, 1, 8));
  assert.equal(gaze.getX(0), 1);
  assert.equal(gaze.getY(0), 0);
  scene.children.forEach(mesh => {
    mesh.geometry.dispose();
    mesh.material.forEach(material => material.dispose());
  });
});

test('camera culling compacts visible spectators without changing occupancy or clipping edge bodies', () => {
  const scene = new THREE.Scene();
  const seats = [[0, 0], [100, 0], [0, 20], [5.3, 0]].map(([x, z], i) => ({
    x, y: 0, z, row: 5, facing: 0, sourceIndex: i, occupied: true,
  }));
  const crowd = {
    highDetailEnabled: false, seats,
    replacePeople(update) { this.update = update; },
  };
  api.attachSpectatorCrowd(scene, crowd, [templates['male-far'], templates['female-far']]);
  const total = () => scene.children.reduce((sum, mesh) => sum + mesh.count, 0);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(0, 1, 8);
  camera.lookAt(0, 1, 0);
  crowd.update(1, false, undefined, camera);
  assert.equal(total(), 2, 'off-screen/behind-camera people are not submitted, but an edge body remains');
  assert.ok(seats.every(seat => seat.occupied), 'camera culling never changes selected crowd density');
  for (const mesh of scene.children.filter(mesh => mesh.count)) {
    assert.deepEqual(mesh.instanceMatrix.updateRanges, [{ start: 0, count: mesh.count * 16 }]);
    assert.deepEqual(mesh.geometry.attributes.spectatorGaze.updateRanges, [{ start: 0, count: mesh.count * 2 }]);
  }
  camera.lookAt(0, 1, 25);
  crowd.update(1.2, true, undefined, camera);
  assert.equal(total(), 1, 'turning the camera restores previously hidden people');
  assert.ok(scene.children.filter(mesh => mesh.count).every(mesh => /-(open|closed)$/.test(mesh.name)));
  crowd.update(1.21, false);
  assert.equal(total(), 4, 'callers without a camera retain complete crowd coverage');
  scene.children.forEach(mesh => {
    mesh.geometry.dispose();
    mesh.material.forEach(material => material.dispose());
  });
});

test('instanced crowd handles applause, both genders, detail toggle and changing occupancy without duplicate shoes', () => {
  const scene = new THREE.Scene();
  const crowd = {
    highDetailEnabled: true,
    seats: Array.from({ length: 8 }, (_, i) => ({ x: i, y: 0, z: 0, facing: 0, row: i < 4 ? 0 : 5, sourceIndex: i, occupied: true })),
    replacePeople(update) { this.update = update; },
  };
  api.attachSpectatorCrowd(scene, crowd, [templates['male-far'], templates['female-far']]);
  crowd.setHighDetailModel(templates['male-full'], 0);
  crowd.setHighDetailModel(templates['female-full'], 1);
  const total = () => scene.children.reduce((sum, o) => sum + (o instanceof THREE.InstancedMesh ? o.count : 0), 0);
  const active = () => scene.children.filter(o => o instanceof THREE.InstancedMesh && o.count);
  crowd.update(1, false, new THREE.Vector3(0, 1, 8));
  assert.equal(total(), 8);
  assert.ok(active().some(o => o.name.includes('-full-')));
  assert.ok(active().every(o => o.name.endsWith('-rest')));
  assert.ok(active().every(o => o.geometry.getAttribute('spectatorGaze').isInstancedBufferAttribute));
  assert.ok(!scene.getObjectByName('wtsl-detailed-crowd-shoes'));
  crowd.update(2, true);
  assert.equal(total(), 8);
  assert.ok(active().every(o => /-(open|closed)$/.test(o.name)));
  crowd.setHighDetailEnabled(false); crowd.update(2, true);
  assert.equal(total(), 8); assert.ok(active().every(o => o.name.includes('-far-')));
  crowd.seats[0].occupied = false; crowd.invalidateUpdate(); crowd.update(2, false);
  assert.equal(total(), 7);
});

test('production court uses approved whole-body spectators rather than grafted hands', async () => {
  const source = await readFile(new URL('../components/DmoLiveCourt3D.tsx', import.meta.url), 'utf8');
  assert.match(source, /attachSpectatorCrowd\(scene, crowdRig/);
  assert.match(source, /crowdRig\.update\(now \/ 1000, now < crowdApplauseUntil, gazeTarget, camera\)/);
  assert.doesNotMatch(source, /prepareCrowdHandGeometry|loadArticulatedHand/);
  const metadata = JSON.parse(await readFile(new URL('../public/models/dmo-humans/rocketbox-provenance.json', import.meta.url)));
  assert.equal(metadata.length, 4);
  assert.ok(metadata.every(m => m.license === 'MIT' && m.bytes < 800000));
});

const diverseMetadata = JSON.parse(await readFile(new URL('../public/models/dmo-humans/valid-spectator-provenance.json', import.meta.url)));
const diverseTemplates = await Promise.all(diverseMetadata.map(m => model(m.gender, 'full', m.filename)));

test('additional roster uses fourteen distinct licensed original faces and outfits', () => {
  assert.equal(diverseMetadata.length, 14);
  assert.equal(new Set(diverseMetadata.map(m => m.source)).size, 14);
  assert.equal(new Set(diverseMetadata.map(m => m.convertedSha256)).size, 14);
  assert.ok(diverseMetadata.every(m => m.license === 'MIT' && m.bytes < 1_000_000));
  assert.equal(new Set(diverseMetadata.map(m => m.source.split('/Avatars/')[1].split('/')[0])).size, 7);
});

for (const [index, template] of diverseTemplates.entries()) {
  test(`${diverseMetadata[index].id}: whole person poses coherently at both detail levels`, () => {
    const hips = [];
    template.traverse(object => { if (object.name === 'Hips') hips.push(object); });
    assert.equal(hips.length, 1, 'one attached armature, not independent face/eye/body poses');
    for (const applause of ['rest', 'open', 'closed']) {
      const posed = clone(template);
      poseApi.poseSpectator(posed, applause);
      for (const prefix of ['Left', 'Right']) {
        const direction = p(posed, `${prefix}HandMiddle1`).sub(p(posed, `${prefix}Hand`)).normalize();
        if (applause === 'rest') {
          assert.ok(direction.z > 0.98);
          assert.ok(p(posed, `${prefix}HandThumb3`).y > p(posed, `${prefix}HandThumb1`).y - 0.025);
        } else assert.ok(direction.y > 0.9);
      }
      for (const detail of ['far', 'full']) {
        const baked = api.bakeSpectator(template, applause, 0, detail);
        assert.ok(Array.from(baked.geometry.attributes.position.array).every(Number.isFinite));
        assert.equal(baked.geometry.index.count / 3, diverseMetadata[index][`${detail}Triangles`]);
        assert.ok(Array.from(baked.geometry.attributes.spectatorClothing.array).every(value => value === 0),
          'native casual outfits and exposed skin retain their original colours');
        baked.geometry.dispose(); baked.materials.forEach(material => material.dispose());
      }
    }
  });
}

test('crowd distributes all sixteen identities without multiplying instance capacity by roster size', () => {
  const scene = new THREE.Scene();
  const seats = Array.from({ length: 160 }, (_, i) => ({
    x: i, y: 0, z: 0, row: i % 8, facing: 0, sourceIndex: i, occupied: true,
  }));
  const crowd = {
    highDetailEnabled: false, seats,
    replacePeople(update) { this.update = update; },
  };
  const roster = [templates['male-far'], templates['female-far'], ...diverseTemplates];
  api.attachSpectatorCrowd(scene, crowd, roster);
  crowd.update(1, false);
  const meshes = scene.children.filter(object => object instanceof THREE.InstancedMesh);
  assert.equal(meshes.length, 16 * 3, 'each identity has only one batch per applause pose');
  assert.equal(meshes.reduce((sum, mesh) => sum + mesh.count, 0), seats.length);
  assert.equal(new Set(meshes.filter(mesh => mesh.count).map(mesh => mesh.name.split('-')[3])).size, 16);
  assert.equal(meshes.reduce((sum, mesh) => sum + mesh.instanceMatrix.count, 0), seats.length * 3);
  meshes.forEach(mesh => {
    mesh.geometry.dispose();
    for (const material of mesh.material) material.dispose();
  });
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');
async function loadTs(file, overrides = {}) {
  const source = await readFile(new URL(file, import.meta.url), 'utf8');
  const { code } = transformSync(source, {
    jsc: { parser: { syntax: 'typescript' }, target: 'es2022' }, module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', code)(module, module.exports, (name) => overrides[name] ?? require(name));
  return module.exports;
}
const sceneApi = await loadTs('../components/DmoLiveCourt3DScene.ts');
const racketPose = await loadTs('../components/DmoRacketOrientation.ts');
const articulated = await loadTs('../components/DmoArticulatedHands.ts');
const humans = await loadTs('../components/DmoHumanModels.ts', { './DmoRacketOrientation': racketPose, './DmoArticulatedHands': articulated });
const crowds = await loadTs('../components/DmoHumanCrowd.ts', { './DmoHumanModels': humans });

// Parse the real rig and geometry in Node, omitting image decoding (verified in browser).
async function asset(gender, detail = 'player') {
  const source = await readFile(new URL(`../public/models/dmo-humans/${gender}-${detail}.glb`, import.meta.url));
  const n = source.readUInt32LE(12);
  const g = JSON.parse(source.toString('utf8', 20, 20 + n));
  assert.equal(g.skins.length, 1);
  assert.ok(g.skins[0].joints.length >= 24);
  assert.ok(source.length < 1_000_000);
  g.images = []; g.textures = []; g.materials = [];
  delete g.meshes[0].primitives[0].material;
  let json = Buffer.from(JSON.stringify(g));
  json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)]);
  const header = Buffer.alloc(20);
  header.write('glTF'); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + json.length + source.length - 20 - n, 8);
  header.writeUInt32LE(json.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  const buffer = Buffer.concat([header, json, source.subarray(20 + n)]);
  const gltf = await new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '');
  return gltf.scene;
}
const close = (actual, expected) => assert.ok(actual.distanceTo(expected) < 0.00001,
  `${actual.toArray()} differs from ${expected.toArray()}`);

for (const gender of ['male', 'female']) {
  test(`${gender} model is a bounded, textured CC0 skeletal asset`, async () => {
    const model = await asset(gender);
    const box = new THREE.Box3().setFromObject(model);
    assert.ok(box.max.y > 1.5 && box.max.y < 1.9);
    let mesh;
    model.traverse((object) => { if (object instanceof THREE.SkinnedMesh) mesh = object; });
    assert.ok(mesh);
    assert.ok(mesh.geometry.index.count / 3 <= 14000);
    const weights = mesh.geometry.getAttribute('skinWeight');
    for (let i = 0; i < weights.count; i += 37) {
      assert.ok(Math.abs(weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i) - 1) < 0.001);
    }
    const manifest = JSON.parse(await readFile(new URL('../public/models/dmo-humans/provenance.json', import.meta.url)));
    assert.equal(manifest.find((entry) => entry.filename === `${gender}-player.glb`).license, 'CC0-1.0');
  });

  test(`${gender} skeleton follows DMO joints after court rotation and translation`, async () => {
    const rig = sceneApi.makePlayer(0xffffff, 0x000000, gender === 'female');
    rig.root.position.set(-11.8, 0, 2.1);
    rig.root.rotation.y = Math.PI / 2;
    const template = await asset(gender);
    let sourceHandMesh;
    template.traverse((object) => {
      if (object instanceof THREE.SkinnedMesh) sourceHandMesh = object.geometry.getAttribute('position').array.slice();
    });
    const attached = humans.attachHumanPlayer(template, rig, 0x5979a0);
    attached.model.traverse((object) => {
      if (!(object instanceof THREE.SkinnedMesh)) return;
      assert.deepEqual(object.geometry.getAttribute('position').array, sourceHandMesh,
        'unarticulated fingers must retain their original surface');
    });
    for (const handY of [0.9, 1.45, 2.1, 0.6]) {
      sceneApi.poseLimb(rig.leftArm, new THREE.Vector3(0.21, 1.4, 0), new THREE.Vector3(0.31, 1.15, 0.1));
      sceneApi.poseLimb(rig.leftForearm, new THREE.Vector3(0.31, 1.15, 0.1), new THREE.Vector3(0.4, 1.0, 0.25));
      sceneApi.poseLimb(rig.rightArm, new THREE.Vector3(-0.21, 1.4, 0), new THREE.Vector3(-0.32, 1.25, 0.15));
      sceneApi.poseLimb(rig.rightForearm, new THREE.Vector3(-0.32, 1.25, 0.15), new THREE.Vector3(-0.4, handY, 0.3));
      for (const [side, sign] of [['left', -1], ['right', 1]]) {
        sceneApi.poseLimb(rig[`${side}Leg`], new THREE.Vector3(sign * 0.13, 0.9, 0), new THREE.Vector3(sign * 0.2, 0.45, 0.08));
        sceneApi.poseLimb(rig[`${side}Calf`], new THREE.Vector3(sign * 0.2, 0.45, 0.08), new THREE.Vector3(sign * 0.25, 0.1, 0.02));
      }
      rig.racket.position.set(-0.4, handY, 0.3);
      attached.update();
      const hand = attached.model.getObjectByName('RightHand');
      close(rig.root.worldToLocal(hand.getWorldPosition(new THREE.Vector3())), new THREE.Vector3(-0.4, handY, 0.3));
      attached.model.traverse((object) => {
        if (object instanceof THREE.Bone) assert.ok(object.matrixWorld.elements.every(Number.isFinite));
      });
    }
    rig.root.userData.dominantHandedness = 'left';
    attached.update();
    const leftHand = attached.model.getObjectByName('LeftHand');
    assert.ok(leftHand.matrixWorld.elements.every(Number.isFinite));
    assert.equal(rig.body.visible, false);
    assert.equal(rig.racket.visible, true);
    assert.equal(rig.leftShoe.visible, true);
    assert.ok(rig.leftShoe.getObjectByName('tennis-sock'));
    attached.model.traverse((object) => {
      if (!(object instanceof THREE.SkinnedMesh)) return;
      const indices = object.geometry.index, positions = object.geometry.getAttribute('position');
      for (let i = 0; i < indices.count; i += 3) {
        assert.ok(Math.max(...[0, 1, 2].map((j) => positions.getY(indices.getX(i + j)))) >= 0.115);
      }
    });
    assert.equal(attached.model.visible, true);
    humans.disposeHumanModel(attached.model);
  });
}

test('finger-jointed hands close through rigid joints, not folded surface vertices', async () => {
    const bytes = await readFile(new URL('../public/models/dmo-humans/articulated-hand.glb', import.meta.url));
    const template = (await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')).scene;
    for (const left of [false, true]) {
      const hand = articulated.makeArticulatedHand(template, left);
      assert.equal(hand.joints.size, 25);
      const tip = hand.joints.get('middle-finger-tip'), before = tip.bone.position.clone();
      let vertices;
      hand.model.traverse(o => { if (o instanceof THREE.SkinnedMesh) vertices = o.geometry.getAttribute('position').array.slice(); });
      hand.setGrip(true);
      assert.ok(tip.bone.position.distanceTo(before) > 0.04);
      hand.joints.forEach(j => assert.ok([...j.bone.position.toArray(), ...j.bone.quaternion.toArray()].every(Number.isFinite)));
      hand.model.traverse(o => { if (o instanceof THREE.SkinnedMesh) assert.deepEqual(o.geometry.getAttribute('position').array, vertices); });
      hand.setGrip(false);
      close(tip.bone.position, before);
    }
});

test('racket face follows ball flight while retaining the contact shaft axis', () => {
  for (const sign of [-1, 1]) {
    const shaft = new THREE.Vector3(sign * 0.9, 0.35, 0).normalize();
    const flight = new THREE.Vector3(0, 0.08, 1).normalize();
    const rotation = racketPose.racketContactOrientation(shaft, flight);
    close(new THREE.Vector3(0, 1, 0).applyQuaternion(rotation), shaft);
    const expectedNormal = flight.clone().addScaledVector(shaft, -flight.dot(shaft)).normalize();
    close(new THREE.Vector3(0, 0, 1).applyQuaternion(rotation), expectedNormal);
  }
  for (const flight of [new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]) {
    const rotation = racketPose.racketContactOrientation(new THREE.Vector3(0, 1, 0), flight);
    assert.ok(rotation.toArray().every(Number.isFinite));
  }
});

test('crowd uses seated textured instancing and retains gaze/applause updates', async () => {
  const scene = new THREE.Scene();
  const oldCrowd = sceneApi.buildCrowd(scene);
  const batches = crowds.attachHumanCrowd(scene, oldCrowd, [await asset('male', 'crowd'), await asset('female', 'crowd')]);
  assert.equal(batches.length, 12);
  assert.equal(batches.reduce((sum, mesh) => sum + mesh.count, 0), oldCrowd.seats.length);
  assert.equal(scene.getObjectByName('wtsl-spectator-heads').visible, false);
  oldCrowd.update(2, true, new THREE.Vector3(11, 0.5, 5));
  assert.ok(batches.some((mesh, index) => index % 6 >= 3 && mesh.count > 0));
  assert.equal(batches.reduce((sum, mesh) => sum + mesh.count, 0), oldCrowd.seats.length);
  for (const mesh of batches) {
    assert.ok(mesh.geometry.boundingBox.max.y > 1.2);
    assert.ok(mesh.geometry.boundingBox.max.y < 1.7);
    assert.equal(mesh.castShadow, false);
  }
});

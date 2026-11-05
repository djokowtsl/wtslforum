// Structural tests, not visual approval of the clothed skinned surface.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');
async function load(name, overrides = {}) {
  const source = await readFile(new URL(`../components/${name}.ts`, import.meta.url), 'utf8');
  const { code } = transformSync(source, {
    jsc: { parser: { syntax: 'typescript' }, target: 'es2022' }, module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', code)(module, module.exports, n => overrides[n] ?? require(n));
  return module.exports;
}
const scene = await load('DmoLiveCourt3DScene'), racket = await load('DmoRacketOrientation');
const capture = await load('DmoCapturedGroundstroke'), grip = await load('DmoNativeGrip'), kit = await load('DmoNativeKit');
const twist = await load('DmoNativeTwist');
const strokes = await load('DmoGroundstrokeRig', { './DmoRacketOrientation': racket });
const native = await load('DmoNativePlayer', {
  './DmoRacketOrientation': racket, './DmoNativeGrip': grip, './DmoNativeKit': kit,
  './DmoNativeTwist': twist,
  './DmoCapturedGroundstroke': capture, './DmoGroundstrokeRig': strokes,
});
const bytes = await readFile(new URL('../public/models/dmo-humans/native-player.glb', import.meta.url));
const template = (await new GLTFLoader().parseAsync(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '',
)).scene;
const sources = Object.fromEntries(await Promise.all(['forehand', 'backhand', 'serve'].map(async name =>
  [name, await readFile(new URL(`../public/models/dmo-humans/tennis-${name}.bvh`, import.meta.url), 'utf8')])));
function player(handedness = 'right') {
  const rig = scene.makePlayer(0x81b6b4, 0x202020);
  rig.root.userData.dominantHandedness = handedness;
  return { rig, ...native.attachNativePlayer(template, rig, 0x81b6b4, sources) };
}
function head(rig) {
  return new THREE.Vector3(0, 0.36, 0).applyQuaternion(rig.racket.quaternion).add(rig.racket.position);
}
function angle(a, b) {
  return a.clone().normalize().angleTo(b.clone().normalize());
}

test('full-weight captured primary arm is independent of procedural racket targets', () => {
  for (const handedness of ['right', 'left']) {
    const p = player(handedness), side = handedness === 'right' ? 'r' : 'l';
    for (const stroke of ['forehand', 'backhand']) for (const deltaSeconds of [-0.3, 0, 0.3]) {
      const playback = { stroke, handedness, deltaSeconds, weight: 1, rootOffset: false, hands: 'one' };
      const names = [`upperarm_${side}`, `lowerarm_${side}`, `hand_${side}`];
      let expected;
      p.rig.root.userData.groundstrokePlayback = playback;
      for (const targetAngle of [-2.5, 2.5]) {
        p.rig.racket.position.set(targetAngle, 1.7, -1);
        p.rig.racket.rotation.set(targetAngle, -targetAngle, targetAngle);
        p.update();
        const actual = names.map(name => p.pose.bones.get(name).quaternion.clone());
        if (!expected) expected = actual;
        names.forEach((name, i) => assert.ok(angle(p.pose.bones.get(name).quaternion, expected[i]) < 1e-6,
          `${stroke}/${handedness}/${deltaSeconds}: ${name} depends on procedural racket target`));
        const rotation = p.rig.root.getWorldQuaternion(new THREE.Quaternion()).invert()
          .multiply(p.pose.bones.get(`hand_${side}`).getWorldQuaternion(new THREE.Quaternion()));
        const centre = p.pose.point(`hand_${side}`)
          .add(p.grips[side].centre.clone().multiplyScalar(1.075).applyQuaternion(rotation));
        const gripError = p.rig.racket.position.distanceTo(centre);
        assert.ok(gripError < 1e-6, `racket must follow the actual grasp (error ${gripError})`);
      }
    }
  }
});

test('reachable contact alignment rotates the upper chain without changing foot orientation or height', () => {
  for (const handedness of ['right', 'left']) for (const stroke of ['forehand', 'backhand']) {
    const p = player(handedness);
    const playback = { stroke, handedness, deltaSeconds: 0, weight: 1, rootOffset: false, hands: 'one' };
    p.rig.root.userData.groundstrokePlayback = playback;
    p.update();
    const pivot = p.pose.point('spine_01');
    const radial = head(p.rig).sub(pivot).normalize();
    const tangent = new THREE.Vector3(0, 0, 1).addScaledVector(radial, -radial.z).normalize().multiplyScalar(0.03);
    const target = head(p.rig).add(tangent);
    const before = ['foot_l', 'foot_r'].map(name => ({
      name, y: p.pose.point(name).y, rotation: p.pose.bones.get(name).getWorldQuaternion(new THREE.Quaternion()),
    }));
    playback.contactTarget = target.toArray();
    p.update();
    assert.equal(p.rig.root.userData.nativeGroundstrokeContact.limited, false);
    assert.ok(head(p.rig).distanceTo(target) < 1e-6, `${stroke}/${handedness}: reachable ball contact`);
    for (const foot of before) {
      assert.ok(Math.abs(p.pose.point(foot.name).y - foot.y) < 1e-8, 'contact correction must not lift feet');
      assert.ok(angle(p.pose.bones.get(foot.name).getWorldQuaternion(new THREE.Quaternion()), foot.rotation) < 1e-6);
    }
  }
});

test('between-shot upper-body ready pose brings the free hand forward and preserves the legs', () => {
  for (const handedness of ['right', 'left']) {
    const side = handedness === 'right' ? 'r' : 'l';
    const support = side === 'r' ? 'l' : 'r';
    const resting = player(handedness);
    resting.update();
    const restingSupport = resting.pose.point(`hand_${support}`);
    const feetBefore = ['foot_l', 'foot_r'].map(name => ({
      name,
      point: resting.pose.point(name),
      rotation: resting.pose.bones.get(name).getWorldQuaternion(new THREE.Quaternion()),
    }));

    const ready = player(handedness);
    ready.rig.root.userData.groundstrokePlayback = capture.readyPosePlayback(handedness, 'upper');
    ready.update();
    const readySupport = ready.pose.point(`hand_${support}`);
    assert.ok(readySupport.z > restingSupport.z + 0.12,
      `${handedness}: the free hand should move into the forward ready position`);

    const primaryRotation = ready.rig.root.getWorldQuaternion(new THREE.Quaternion()).invert()
      .multiply(ready.pose.bones.get(`hand_${side}`).getWorldQuaternion(new THREE.Quaternion()));
    const grasp = ready.pose.point(`hand_${side}`)
      .add(ready.grips[side].centre.clone().multiplyScalar(1.075).applyQuaternion(primaryRotation));
    const gripError = ready.rig.racket.position.distanceTo(grasp);
    assert.ok(gripError < 1e-6,
      `${handedness}: the racket must remain attached to the dominant hand (${gripError})`);
    for (const foot of feetBefore) {
      assert.ok(ready.pose.point(foot.name).distanceTo(foot.point) < 1e-8,
        'the ready pose must not change the accepted foot placement');
      assert.ok(angle(ready.pose.bones.get(foot.name).getWorldQuaternion(new THREE.Quaternion()), foot.rotation) < 1e-6,
        'the ready pose must not change the accepted foot orientation');
    }
  }
});

test('one-handed backhand selection keeps the secondary fingers open despite an old two-hand flag', () => {
  for (const handedness of ['right', 'left']) {
    const p = player(handedness), secondary = handedness === 'right' ? 'l' : 'r';
    p.rig.root.userData.twoHandedGrip = true;
    p.rig.root.userData.groundstrokePlayback = {
      stroke: 'backhand', handedness, deltaSeconds: 0, weight: 1, rootOffset: false, hands: 'one',
    };
    p.update();
    for (const name of p.pose.bones.keys()) {
      if (/^(index|middle|ring|pinky|thumb)_/.test(name) && name.endsWith(`_${secondary}`)) {
        assert.ok(angle(p.pose.bones.get(name).quaternion, p.pose.rest.get(name).local) < 1e-6, `${name} must not grasp`);
      }
    }
  }
});

test('two-handed stroke keeps the supporting anatomical grip on the handle for either hand', () => {
  for (const handedness of ['right', 'left']) {
    const p = player(handedness);
    p.rig.root.userData.twoHandedGrip = true;
    p.rig.root.userData.groundstrokePlayback = {
      stroke: 'backhand', handedness, deltaSeconds: 0, weight: 1, rootOffset: false, hands: 'two',
    };
    p.update();
    assert.ok(p.rig.root.userData.nativeGroundstrokeContact.supportError < 0.035,
      `${handedness}: support-hand grip misses the reachable handle by ${p.rig.root.userData.nativeGroundstrokeContact.supportError}`);
  }
});

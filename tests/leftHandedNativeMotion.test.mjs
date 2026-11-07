// Structural symmetry checks of the actual production player, not visual approval.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');
async function load(path, overrides = {}) {
  const source = await readFile(new URL(`../${path}.ts`, import.meta.url), 'utf8');
  const { code } = transformSync(source, {
    jsc: { parser: { syntax: 'typescript' }, target: 'es2022' }, module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', code)(module, module.exports, n => overrides[n] ?? require(n));
  return module.exports;
}
const scene = await load('components/DmoLiveCourt3DScene', {
  './DmoStadiumArchitecture': await load('components/DmoStadiumArchitecture'),
  '../lib/dmoVenue': await load('lib/dmoVenue'),
  '@/lib/te4DmoSurface': await load('lib/te4DmoSurface'),
  '@/lib/dmoCrowdDensity': await load('lib/dmoCrowdDensity'),
});
const racket = await load('components/DmoRacketOrientation');
const capture = await load('components/DmoCapturedGroundstroke');
const active = await load('components/DmoNativePlayerClaude', {
  './DmoRacketOrientation': racket,
  './DmoNativeGrip': await load('components/DmoNativeGrip'),
  './DmoNativeKit': await load('components/DmoNativeKit'),
  './DmoNativeTwist': await load('components/DmoNativeTwist'),
  './DmoCapturedGroundstroke': capture,
  './DmoCapturedLocomotion': await load('components/DmoCapturedLocomotion'),
});
const bytes = await readFile(new URL('../public/models/dmo-humans/native-player.glb', import.meta.url));
const template = (await new GLTFLoader().parseAsync(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '',
)).scene;
const sources = Object.fromEntries(await Promise.all([
  'forehand', 'backhand', 'serve', 'smash', 'volley-forehand', 'volley-backhand',
].map(async name => [name, await readFile(
  new URL(`../public/models/dmo-humans/tennis-${name}.bvh`, import.meta.url), 'utf8',
)])));
function player(handedness) {
  const rig = scene.makePlayer(0x81b6b4, 0x202020);
  rig.root.userData.dominantHandedness = handedness;
  return { rig, ...active.attachNativePlayer(template, rig, 0x81b6b4, sources) };
}
function mirrorError(right, left, bone) {
  const target = bone.replace(/_r$/, '_l');
  const point = right.pose.point(bone);
  point.x *= -1;
  return point.distanceTo(left.pose.point(target));
}
test('the production left-handed forehand retains the mirrored captured body and arm', () => {
  for (const deltaSeconds of [-0.3, 0, 0.25]) {
    const right = player('right'), left = player('left');
    for (const p of [right, left]) {
      p.rig.root.userData.groundstrokePlayback = {
        stroke: 'forehand', handedness: p.rig.root.userData.dominantHandedness,
        deltaSeconds, weight: 1, rootOffset: false, hands: 'one',
      };
      p.update();
    }
    for (const bone of ['upperarm_r', 'lowerarm_r', 'hand_r']) {
      const error = mirrorError(right, left, bone);
      assert.ok(error < 0.035, `${bone} at ${deltaSeconds}: mirror error ${error.toFixed(4)}m`);
    }
  }
});

test('the left-handed waiting grip preserves the mirrored palm, not a half-turn wrist roll', () => {
    const right = player('right'), left = player('left');
    for (const p of [right, left]) {
      const isLeft = p.rig.root.userData.dominantHandedness === 'left';
      const dominantX = isLeft ? 0.39 : -0.39;
      const shaft = new THREE.Vector3(-Math.sign(dominantX) * 0.04, 0.32, 0.95).normalize();
      p.rig.racket.position.set(dominantX * 0.22, 1, 0.32);
      p.rig.racket.quaternion.copy(racket.racketCarryOrientation(
        shaft, isLeft ? 'left' : 'right',
      ));
      p.rig.root.userData.readyArms = 1;
      p.rig.root.userData.supportHoldWeight = 1;
      p.rig.root.userData.supportGripOffset = 0.11;
      p.update();
    }
    for (const bone of ['upperarm_r', 'lowerarm_r', 'hand_r']) {
      assert.ok(mirrorError(right, left, bone) < 0.001, `${bone} mirrors the waiting pose`);
    }
    const rightPalm = right.grips.r.palm.clone().applyQuaternion(right.pose.rotation('hand_r'));
    rightPalm.x *= -1;
    const leftPalm = left.grips.l.palm.clone().applyQuaternion(left.pose.rotation('hand_l'));
    assert.ok(rightPalm.angleTo(leftPalm) < 0.025, 'left palm is the reflected right palm');
});

test('standing and return carry frames reflect both the shaft and its face', () => {
  for (const lift of [0.32, 0.42, -0.3]) {
    const rightShaft = new THREE.Vector3(0.04, lift, 0.95).normalize();
    const leftShaft = rightShaft.clone(); leftShaft.x *= -1;
    const right = racket.racketCarryOrientation(rightShaft, 'right');
    const left = racket.racketCarryOrientation(leftShaft, 'left');
    const reflected = new THREE.Quaternion(right.x, -right.y, -right.z, right.w);
    assert.ok(reflected.angleTo(left) < 1e-6);
  }
});

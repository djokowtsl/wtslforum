import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';
import {
  DmoCapturedLocomotion, LOCOMOTION_CLIP_SPEED, locomotionClipWeights,
} from '../components/DmoCapturedLocomotion.ts';

const read = name => fs.readFileSync(
  new URL(`../public/models/dmo-humans/locomotion-${name}.bvh`, import.meta.url), 'utf8',
);

test('walk, jog and run blend by speed and weights always sum to one', () => {
  assert.deepEqual(locomotionClipWeights(0.5), { walk: 1, jog: 0, run: 0 });
  assert.deepEqual(locomotionClipWeights(10), { walk: 0, jog: 0, run: 1 });
  for (let speed = 0; speed <= 6; speed += 0.1) {
    const weights = locomotionClipWeights(speed);
    assert.ok(Math.abs(weights.walk + weights.jog + weights.run - 1) < 1e-9);
  }
  const middle = locomotionClipWeights((LOCOMOTION_CLIP_SPEED.walk + LOCOMOTION_CLIP_SPEED.jog) / 2);
  assert.ok(middle.walk > 0.4 && middle.jog > 0.4);
});

test('each human locomotion clip loops without a large arm jump', async () => {
  const { BVHLoader } = await import('three/examples/jsm/loaders/BVHLoader.js');
  for (const name of ['walk', 'jog', 'run']) {
    const data = new BVHLoader().parse(read(name));
    assert.ok(data.clip.duration > 0.6 && data.clip.duration < 1.3, `${name}: ${data.clip.duration}s`);
    const bones = new Map(data.skeleton.bones.map(bone => [bone.name, bone]));
    const root = data.skeleton.bones[0];
    const mixer = new THREE.AnimationMixer(root);
    mixer.clipAction(data.clip).play();
    const armDirection = time => {
      mixer.setTime(time);
      root.updateMatrixWorld(true);
      return bones.get('LeftForeArm').getWorldPosition(new THREE.Vector3())
        .sub(bones.get('LeftArm').getWorldPosition(new THREE.Vector3())).normalize();
    };
    const start = armDirection(0);
    const end = armDirection(data.clip.duration - 1e-4);
    assert.ok(start.angleTo(end) < 0.2, `${name}: loop seam is ${start.angleTo(end).toFixed(2)} rad`);
  }
});

test('recorded motion retargets relative to the player chest and respects zero weight', () => {
  const names = [
    'spine_03', 'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l',
    'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r',
  ];
  const rest = new Map(names.map(name => [
    name, { rotation: new THREE.Quaternion(), direction: new THREE.Vector3(0, -1, 0) },
  ]));
  const locomotion = new DmoCapturedLocomotion(rest, {
    walk: read('walk'), jog: read('jog'), run: read('run'),
  });
  const orientations = new Map(names.map(name => [name, new THREE.Quaternion()]));
  const pose = {
    rotation: name => orientations.get(name).clone(),
    orient: (name, quaternion) => orientations.set(name, quaternion.clone()),
  };
  for (let phase = 0; phase < 1; phase += 0.125) {
    locomotion.apply(pose, { phase, speed: 1.2, weight: 1 });
    assert.ok(Number.isFinite(orientations.get('upperarm_l').y));
  }
  for (const speed of [1.2, 2.8, 4]) {
    locomotion.apply(pose, { phase: 0, speed, weight: 1 });
    const start = orientations.get('lowerarm_l').clone();
    locomotion.apply(pose, { phase: 0.99999, speed, weight: 1 });
    const end = orientations.get('lowerarm_l').clone();
    assert.ok(start.angleTo(end) < 0.02, `@${speed}: loop seam is ${start.angleTo(end).toFixed(3)} rad`);
  }
  const before = orientations.get('hand_r').clone();
  locomotion.apply(pose, { phase: 0.3, speed: 1.2, weight: 0 });
  assert.ok(orientations.get('hand_r').angleTo(before) < 1e-9);
});

test('recorded legs: the right foot lands in front at phase 0 and swings high mid-cycle', () => {
  const names = ['spine_03', 'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l', 'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r'];
  const rest = new Map(names.map(n => [n, { rotation: new THREE.Quaternion(), direction: new THREE.Vector3(0, -1, 0) }]));
  const locomotion = new DmoCapturedLocomotion(rest, { walk: read('walk'), jog: read('jog'), run: read('run') });
  for (const speed of [1.3, 2.6, 3.8]) {
    const landing = locomotion.legs(0, speed);
    assert.ok(landing.r.ankle.z > 0.1, `${speed} m/s: right foot lands in front of the hip`);
    assert.ok(landing.r.ankle.y < landing.l.ankle.y + 0.05, `${speed} m/s: the landing foot is down (as low as the other)`);
    // Right leg's swing (second half of the cycle): its ankle is higher than the left's.
    const swing = locomotion.legs(0.65, speed);
    assert.ok(swing.r.ankle.y > swing.l.ankle.y, `${speed} m/s: right leg swings mid-cycle`);
    // Leg-length units: ankle within one leg length of the hip, knee in front of the hip-ankle line.
    for (const side of ['l', 'r']) for (const p of [0, 0.25, 0.5, 0.75]) {
      const leg = locomotion.legs(p, speed)[side];
      assert.ok(leg.ankle.length() <= 1.001 && leg.ankle.length() > 0.4); // (a running heel kick folds it to ~half)
      assert.ok(leg.knee.length() < 0.6 && leg.knee.y < 0);
    }
  }
  assert.equal(new DmoCapturedLocomotion(rest, {}).legs(0.3, 4), null);
});

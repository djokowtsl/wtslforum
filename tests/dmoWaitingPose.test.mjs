// Production pose calculation with synthetic idle/movement data, not real replay approval.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { productionPlayer, syntheticSamples } from './helpers/dmoProductionPlayer.mjs';

test('production waiting frames keep both arms forward, ankles apart, and one foot grounded', async () => {
  for (const handedness of ['right', 'left']) {
    const p = await productionPlayer({ handedness });
    for (const moving of [false, true]) for (const frame of [40, 47, 54, 61, 68, 75, 82]) {
      p.updateFrame(frame, {
        samples: syntheticSamples(moving),
        footwork: moving ? [{ frame: 54, kind: 'slide', player: 1 }] : [],
      });
      assert.equal(p.rig.root.userData.waitingPose, true);
      assert.equal(p.rig.root.userData.groundstrokePlayback, undefined,
        'waiting must not partially retarget an unrelated serve clip');
      for (const side of ['l', 'r']) {
        const sign = side === 'l' ? 1 : -1;
        assert.ok(p.pose.point(`hand_${side}`).z > 0.2, `${handedness}/${moving}/${frame}: hand forward`);
        assert.ok(p.pose.point(`lowerarm_${side}`).x * sign > 0.18,
          `${handedness}/${moving}/${frame}: elbow outside torso`);
        assert.ok(p.pose.point(`foot_${side}`).x * sign > 0.1,
          `${handedness}/${moving}/${frame}: ankle must not cross the body centre`);
      }
      assert.ok(Math.abs(Math.min(p.pose.point('foot_l').y, p.pose.point('foot_r').y) - 0.1) < 1e-6,
        'at least one foot must remain at court height');
      const side = handedness === 'right' ? 'r' : 'l';
      const rotation = p.rig.root.getWorldQuaternion(new THREE.Quaternion()).invert()
        .multiply(p.pose.bones.get(`hand_${side}`).getWorldQuaternion(new THREE.Quaternion()));
      const grasp = p.pose.point(`hand_${side}`)
        .add(p.grips[side].centre.clone().multiplyScalar(1.075).applyQuaternion(rotation));
      assert.ok(p.rig.racket.position.distanceTo(grasp) < 1e-6, 'grounding must keep the racket in the hand');
    }
  }
});

test('zero-influence lookup-buffer frames also select waiting instead of the old fallback', async () => {
  const p = await productionPlayer();
  const events = [{ frame: 100, kind: 'shot', player: 1, shotType: 'rally' }];
  for (const frame of [76, 124]) {
    p.updateFrame(frame, { events });
    assert.equal(p.rig.root.userData.waitingPose, true, `${frame}: nearby events are not active motion`);
    assert.ok(p.pose.point('hand_l').z > 0.2);
  }
});

test('between-point repositioning walks with grounded steps instead of sliding', async () => {
  const p = await productionPlayer();
  const samples = syntheticSamples().map(sample => ({
    ...sample,
    values: [...sample.values],
  }));
  for (const sample of samples) sample.values[4] = Math.max(0, sample.frame - 50) * 50;
  const events = [
    { frame: 10, kind: 'point-end' },
    { frame: 100, kind: 'shot', player: 1, shotType: 'serve' },
  ];
  p.updateFrame(50, { samples, events });
  let maximumStep = 0;
  for (let frame = 51; frame <= 60; frame++) {
    const before = p.rig.root.position.clone();
    p.updateFrame(frame, { samples, events });
    maximumStep = Math.max(maximumStep, before.distanceTo(p.rig.root.position));
  }
  assert.ok(maximumStep <= 1.8 * 0.01667 + 1e-4,
    `between-point movement exceeded walking pace: ${maximumStep.toFixed(4)} m/frame`);
  assert.ok(p.rig.root.userData.locomotionSpeed > 1.7,
    'the feet receive the actual repositioning speed');
  assert.ok(p.rig.root.userData.gait.amount > 0.7,
    'the stepping gait engages while the root walks');
});

test('leaving a waiting pose restores the complete forehand, backhand, and serve capture', async () => {
  for (const handedness of ['right', 'left']) {
    const before = await productionPlayer({ handedness });
    const after = await productionPlayer({ handedness });
    after.updateFrame(40);
    for (const shotType of ['rally', 'serve']) for (const ballZ of [-90, 90]) {
      const samples = syntheticSamples().map(s => ({ ...s, values: [...s.values] }));
      samples.forEach(s => { s.values[1] = ballZ; s.values[2] = 140; });
      const events = [{ frame: 100, kind: 'shot', player: 1, shotType }];
      before.updateFrame(100, { samples, events });
      after.updateFrame(100, { samples, events });
      assert.equal(after.rig.root.userData.waitingPose, false);
      assert.equal(after.rig.root.userData.groundstrokePlayback.weight, 1);
      for (const name of ['pelvis', 'spine_03', 'upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r',
        'hand_l', 'hand_r', 'thigh_l', 'thigh_r', 'foot_l', 'foot_r']) {
        assert.ok(after.pose.point(name).distanceTo(before.pose.point(name)) < 1e-6,
          `${handedness}/${shotType}/${ballZ}: ${name} position changed`);
        assert.ok(after.pose.bones.get(name).quaternion.clone().normalize()
          .angleTo(before.pose.bones.get(name).quaternion.clone().normalize()) < 1e-6,
          `${handedness}/${shotType}/${ballZ}: ${name} rotation changed`);
      }
    }
  }
});

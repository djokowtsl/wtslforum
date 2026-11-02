import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultPlayerStrokeStyles,
  clampPointToReach,
  dominantHandX,
  groundstrokeForBallSide,
  racketContact,
  racketContactWithinReach,
  MAX_PLAYER_ARM_REACH,
  RACKET_HEAD_OFFSET,
  RIGHT_HAND_X,
  secondHandGripPosition,
  serveLift,
  crossedFrame,
  trailAllowed,
  TWO_HANDED_GRIP_SEPARATION,
} from '../lib/liveCourtPerformance.ts';
import { interpolateLiveCourtFrame, liveCourtTrajectoryCue } from '../lib/liveCourtMotion.ts';
import * as THREE from 'three';
import { makePlayer } from '../components/DmoLiveCourt3DScene.ts';

test('right-handed rig has its dominant hand on anatomical right when facing +Z', () => {
  assert.ok(RIGHT_HAND_X < 0);
  assert.ok(dominantHandX('right') < 0);
  assert.ok(dominantHandX('left') > 0);
});
test('stroke side follows the selected dominant hand and defaults to a one-handed forehand', () => {
  assert.equal(groundstrokeForBallSide(-1, 'right'), 'forehand');
  assert.equal(groundstrokeForBallSide(1, 'right'), 'backhand');
  assert.equal(groundstrokeForBallSide(1, 'left'), 'forehand');
  assert.equal(groundstrokeForBallSide(-1, 'left'), 'backhand');
  assert.deepEqual(defaultPlayerStrokeStyles(), [
    { forehand: 'one', backhand: 'two' },
    { forehand: 'one', backhand: 'two' },
  ]);
});
test('two-handed strokes position the second hand farther up the racket handle', () => {
  assert.deepEqual(
    secondHandGripPosition([1, 2, 3], [0, 1, 0]),
    [1, 2 + TWO_HANDED_GRIP_SEPARATION, 3],
  );
});
test('racket string-bed centre reaches ball on overhead and both rally sides', () => {
  for (const ball of [[-.3, 3.1, .2], [-1, 1.2, .6], [.8, 1.3, .5]]) {
    const pose = racketContact(ball, [RIGHT_HAND_X, 1.4, 0]);
    ball.forEach((v, i) => assert.ok(Math.abs(pose.grip[i] + pose.axis[i] * RACKET_HEAD_OFFSET - v) < 1e-10));
  }
});
test('racket contact never pulls the hitting hand beyond a realistic arm reach', () => {
  const shoulder = [RIGHT_HAND_X * 0.59, 1.4, 0];
  const ball = [4, 2, 0];
  const preferredGrip = [RIGHT_HAND_X, 1.1, 0];
  const unconstrained = racketContact(ball, preferredGrip);
  const pose = racketContactWithinReach(ball, preferredGrip, shoulder);
  const reach = Math.hypot(...pose.grip.map((value, index) => value - shoulder[index]));
  const axisLength = Math.hypot(...pose.axis);

  assert.ok(reach <= MAX_PLAYER_ARM_REACH + 1e-10);
  assert.ok(reach < Math.hypot(...unconstrained.grip.map((value, index) => value - shoulder[index])));
  assert.ok(Math.abs(axisLength - 1) < 1e-10);
  assert.deepEqual(clampPointToReach(preferredGrip, shoulder), preferredGrip);
});
test('serve jumps at contact and lands after follow-through', () => {
  assert.equal(serveLift(0), .45);
  assert.equal(serveLift(-24), 0);
  assert.equal(serveLift(24), 0);
});
test('actual racket mesh centre meets the target after player rotation and scale', () => {
  for (const heading of [-Math.PI / 2, Math.PI / 2]) {
    const rig = makePlayer(0xff0000, 0x333333);
    rig.root.rotation.y = heading;
    rig.root.position.set(12, 0, .4);
    const target = new THREE.Vector3(-.1, 3.2, .2);
    const pose = racketContact(target.toArray(), [RIGHT_HAND_X, 1.9, 0]);
    rig.racket.position.set(...pose.grip);
    rig.racket.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...pose.axis));
    rig.root.updateMatrixWorld(true);
    const centre = rig.root.getObjectByName('racket-head').getWorldPosition(new THREE.Vector3());
    assert.ok(centre.distanceTo(rig.root.localToWorld(target)) < 1e-10);
    rig.root.traverse(o => {
      o.geometry?.dispose();
      if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
      else o.material?.dispose();
    });
  }
});
test('WTA court rigs use a skirt and ponytail while standard rigs keep shorts', () => {
  const standard = makePlayer(0xff0000, 0x333333);
  const wta = makePlayer(0xff0000, 0x333333, true);

  assert.equal(standard.hip.geometry.type, 'CapsuleGeometry');
  assert.equal(wta.hip.geometry.type, 'CylinderGeometry');
  assert.ok(wta.head.children.some((part) => part.geometry?.type === 'CapsuleGeometry'));

  for (const rig of [standard, wta]) {
    rig.root.traverse((object) => {
      object.geometry?.dispose();
      if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
      else object.material?.dispose();
    });
  }
});
test('cues never play before contact and are not repeated on a stalled playhead', () => {
  assert.equal(crossedFrame(100, 90, 99), false);
  assert.equal(crossedFrame(100, 99, 100), true);
  assert.equal(crossedFrame(100, 100, 100), false);
  assert.equal(crossedFrame(100, 110, 90), false);
});
test('grunt preference gates rally grunts without muting point cheers or serving sounds', () => {
  const rally = { kind: 'shot', shotType: 'rally' };
  const serve = { kind: 'shot', shotType: 'serve' };
  const pointEnd = { kind: 'point-end' };

  assert.equal(liveCourtTrajectoryCue(rally, true), 'grunt');
  assert.equal(liveCourtTrajectoryCue(rally, false), null);
  assert.equal(liveCourtTrajectoryCue(serve, true), null);
  assert.equal(liveCourtTrajectoryCue(pointEnd, false), 'cheer');
});
test('trails stay hidden throughout point breaks until the next hit', () => {
  const events = [{frame:10,kind:'shot'},{frame:20,kind:'point-end'},{frame:100,kind:'shot'}];
  assert.equal(trailAllowed(events, 19), true);
  assert.equal(trailAllowed(events, 20), false);
  assert.equal(trailAllowed(events, 99), false);
  assert.equal(trailAllowed(events, 100), true);
});
test('changeovers never interpolate a walk through the net', () => {
  const a = [0,0,0,-1200,100,1200,-100];
  const b = [0,0,0,1200,-100,-1200,100];
  const result = interpolateLiveCourtFrame([{frame:0,values:a},{frame:60,values:b}],30,60);
  assert.deepEqual(result,b);
});

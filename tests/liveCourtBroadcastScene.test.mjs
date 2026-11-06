import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as THREE from 'three';
import { courtSurfaceSoundProfile, isIndoorDmoVenue } from '../lib/te4DmoSurface.ts';
import { deriveLiveCourtFootworkEvents, deriveLiveCourtSkidMarks } from '../lib/liveCourtMotion.ts';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');
async function loadTs(path, overrides = {}) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const { code } = transformSync(source, {
    jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
    module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', code)(module, module.exports,
    name => overrides[name] ?? require(name));
  return module.exports;
}
const stadiumArchitectureApi = await loadTs('../components/DmoStadiumArchitecture.ts');
const sceneApi = await loadTs('../components/DmoLiveCourt3DScene.ts', {
  './DmoStadiumArchitecture': stadiumArchitectureApi,
});
const crowdLodApi = await loadTs('../lib/dmoCrowdLod.ts');
const {
  deriveLiveCourtSoundEvents,
  loadCourtEffectSamples,
  playLiveCourtEffect,
} = await loadTs('../lib/liveCourtAudio.ts', {
  './te4DmoSurface': { courtSurfaceSoundProfile },
});

test('stadium fills three open tiers with crowd, concourses, score displays and four tunnels', () => {
  for (const indoor of [false, true]) {
    const scene = new THREE.Scene();
    sceneApi.buildStadiumEnvironment(scene, indoor);
    const stadium = scene.getObjectByName('wtsl-stadium-architecture');
    const superstructure = stadium?.getObjectByName('wtsl-stadium-superstructure');
    assert.ok(superstructure, 'the interior stands and court-side details remain');

    const named = (root, name) => {
      const matches = [];
      root.traverse((object) => { if (object.name === name) matches.push(object); });
      return matches;
    };
    const bowl = named(superstructure, 'wtsl-continuous-seating-bowl')[0];
    assert.ok(bowl?.isMesh, 'one continuous mesh carries the full seating rake');
    assert.equal(bowl.geometry.userData.continuousPerimeter, true);
    assert.equal(bowl.geometry.userData.inwardFacing, true);
    assert.equal(bowl.geometry.userData.rows, 18, 'the bowl continues well above the sparse detailed crowd');
    assert.equal(bowl.geometry.userData.tiers, 3);
    bowl.geometry.computeBoundingBox();
    assert.ok(bowl.geometry.boundingBox.max.x > 55, 'stands reach beyond the court in every direction');
    assert.ok(bowl.geometry.boundingBox.max.y > 19, 'upper seating fills the scene height');
    const seats = named(superstructure, 'wtsl-continuous-bowl-seats')[0];
    const seatBacks = named(superstructure, 'wtsl-continuous-bowl-seat-backs')[0];
    assert.ok(seats?.isInstancedMesh && seatBacks?.isInstancedMesh);
    assert.equal(seats.count, seatBacks.count);
    assert.ok(seats.count > 4_000, 'empty upper rows still read as stands across the full bowl');
    assert.equal(seats.userData.rows, 18);
    assert.equal(seats.userData.inwardFacing, true);
    assert.equal(named(superstructure, 'wtsl-continuous-bowl-spectator-bodies').length, 0,
      'the upper bowl does not keep a separate static crowd treatment');
    assert.equal(named(superstructure, 'wtsl-continuous-bowl-spectator-heads').length, 0);
    assert.equal(named(superstructure, 'wtsl-baseline-upper-deck-0').length, 0);
    assert.equal(named(superstructure, 'wtsl-sideline-upper-deck-2').length, 0);
    assert.equal(named(superstructure, 'wtsl-baseline-riser-0').length, 0);
    assert.equal(named(superstructure, 'wtsl-sideline-riser-0').length, 0);
    const blockingArchitecture = [];
    superstructure.traverse((object) => {
      if (/retaining|riser|seat-cap|stadium-rib/i.test(object.name)) blockingArchitecture.push(object.name);
    });
    assert.deepEqual(blockingArchitecture, [], 'no retaining walls, caps, or ribs interrupt the court view');
    assert.equal(named(superstructure, 'wtsl-advertising-board-baseline').length, 4);
    assert.equal(named(superstructure, 'wtsl-advertising-board-sideline').length, 4);
    assert.equal(named(superstructure, 'wtsl-scoreboard-screen').length, 2);
    const concourses = named(superstructure, 'wtsl-stadium-concourse');
    assert.equal(concourses.length, 2);
    assert.ok(concourses.every((walkway) => walkway.userData.amenities.includes('concessions')
      && walkway.userData.amenities.includes('restrooms')));
    assert.equal(named(superstructure, 'wtsl-court-tunnel-opening').length, 4);
    assert.equal(superstructure.userData.tunnelOpeningCount, 4);
    assert.equal(superstructure.userData.concourseCount, 2);
    assert.equal(typeof superstructure.userData.updateScoreboard, 'function');
    const scoreboard = {
      players: ['Taylor Fritz', 'Alex de Minaur'],
      score: { sets: [[6, 4]], games: [3, 2], pointText: ['30', '15'], tiebreak: false, server: 1 },
      live: true,
    };
    superstructure.userData.updateScoreboard(scoreboard);
    assert.deepEqual(superstructure.userData.scoreboardData, scoreboard);
    assert.equal(named(superstructure, 'wtsl-stadium-concourse-windows').length, 0);
    assert.equal(named(superstructure, 'wtsl-stadium-support-columns').length, 0);
    assert.equal(named(superstructure, 'wtsl-open-air-canopy').length, 0);
    assert.equal(named(superstructure, 'wtsl-indoor-roof-wing').length, 0);
    assert.equal(Boolean(scene.getObjectByName('wtsl-open-sky')), false);
    assert.equal(Boolean(scene.getObjectByName('wtsl-indoor-ceiling')), false);
    assert.equal(stadium.children.some(child => /roof|shell|facade|exterior/i.test(child.name)), false);
  }
});

test('full-detail crowd seats remain sparse, near-court and gender-balanced across the unified bowl', () => {
  for (const genderIndex of [0, 1]) {
    const selected = Array.from({ length: 2 * 10_000 }, (_, index) => index)
      .filter((index) => crowdLodApi.shouldUseHighDetailCrowdSeat(Math.floor(index / 10_000), index, genderIndex));
    assert.equal(selected.length, 2_500);
    assert.ok(selected.every((index) => index % 2 === genderIndex));
    assert.ok(selected.every((index) => Math.floor(index / 10_000) < crowdLodApi.HIGH_DETAIL_CROWD_ROW_LIMIT));
    assert.equal(crowdLodApi.shouldUseHighDetailCrowdSeat(2, 20_000, genderIndex), false,
      'high-detail meshes stay limited to the nearest two crowd rows');
  }
});

test('one animated crowd ring fills the near apron and upper bowl with four centered passageways', () => {
  const scene = new THREE.Scene();
  sceneApi.buildStadiumEnvironment(scene);
  const crowd = sceneApi.buildCrowd(scene);
  assert.ok(crowd.seats.length > 5_000, 'detailed crowd seats continue through every stadium tier');
  assert.equal(new Set(crowd.seats.map((seat) => seat.row)).size, 22,
    'four lower rows connect directly to all eighteen upper-bowl rows');
  assert.ok(crowd.seats.some((seat) => seat.row === 0 && Math.abs(seat.z) >= 12));
  assert.ok(crowd.seats.some((seat) => seat.row >= 4 && Math.abs(seat.z) > 18));
  for (let row = 4; row < 22; row += 1) {
    const upperRow = crowd.seats.filter((seat) => seat.row === row);
    assert.ok(upperRow.length > 100, `upper-bowl row ${row} remains populated`);
    assert.ok(upperRow.every((seat) => Math.abs(seat.x) >= 2.5 && Math.abs(seat.z) >= 2.5),
      'upper tiers keep the four centered passageways clear');
  }
  const nearSeats = crowd.seats.filter((seat) => seat.row < 4);
  const nearPlatforms = scene.getObjectByName('wtsl-near-court-seating-platforms');
  const nearRisers = scene.getObjectByName('wtsl-near-court-seating-risers');
  assert.ok(nearPlatforms?.isInstancedMesh);
  assert.equal(nearPlatforms.count, 32, 'each lower row has platforms beneath its four seating sides');
  assert.equal(nearPlatforms.userData.accessPassages, 4, 'the seating platform leaves the four walk-through gaps open');
  assert.ok(nearRisers?.isInstancedMesh);
  assert.equal(nearRisers.count, 24, 'raised crowd rows have visible risers instead of appearing suspended');
  const sidelineSeats = nearSeats.filter((seat) => Math.abs(seat.z) >= 12 && Math.abs(seat.x) < 22);
  const baselineSeats = nearSeats.filter((seat) => Math.abs(seat.x) >= 22 && Math.abs(seat.z) < 12);
  assert.ok(sidelineSeats.every((seat) => Math.abs(seat.x) >= 2.5),
    'the two sideline passageways remain open through the lower crowd');
  assert.ok(baselineSeats.every((seat) => Math.abs(seat.z) >= 2.5),
    'the two baseline passageways remain open through the lower crowd');
  assert.ok(nearSeats.every((seat) => Math.abs(seat.x) >= 21.9 || Math.abs(seat.z) >= 11.7),
    'all lower spectators remain beyond the clear runoff');
  const detachedStands = [];
  scene.traverse((object) => {
    if (/wtsl-(baseline|sideline)-(upper-deck|riser)|wtsl-courtside-stand/i.test(object.name)) {
      detachedStands.push(object.name);
    }
  });
  assert.deepEqual(detachedStands, [], 'no detached near-court stand group is built');
  const heads = scene.getObjectByName('wtsl-spectator-heads');
  const arms = scene.getObjectByName('wtsl-unified-crowd-fallback-arms');
  assert.ok(heads?.isInstancedMesh);
  assert.ok(arms?.isInstancedMesh);
  const crowdMeshes = [];
  scene.traverse((object) => {
    if (/wtsl-(unified|spectator)/.test(object.name)) crowdMeshes.push(object);
  });
  assert.ok(crowdMeshes.length > 0);
  assert.ok(crowdMeshes.every((mesh) => mesh.isInstancedMesh),
    'crowd body parts and seating use instancing rather than per-spectator meshes');
  assert.equal(heads.count, crowd.seats.length);
  assert.equal(arms.count, crowd.seats.length * 2);
  const animatedSeat = crowd.seats.findIndex((seat) => seat.row >= 4 && seat.sourceIndex % 5 !== 0);
  assert.ok(animatedSeat >= 0);
  const before = new THREE.Matrix4();
  const after = new THREE.Matrix4();
  const armBefore = new THREE.Matrix4();
  const armAfter = new THREE.Matrix4();
  heads.getMatrixAt(crowd.seats.length - 1, before);
  arms.getMatrixAt(animatedSeat * 2, armBefore);
  crowd.update(1, true, new THREE.Vector3(-10, 1, 0));
  heads.getMatrixAt(crowd.seats.length - 1, after);
  arms.getMatrixAt(animatedSeat * 2, armAfter);
  assert.notDeepEqual(after.elements, before.elements, 'the same gaze animation reaches upper-bowl spectators');
  assert.notDeepEqual(armAfter.elements, armBefore.elements, 'the same applause animation reaches upper-bowl spectators');
});

test('transparent courtside safety barriers stay outside runoff and preserve four access gaps', () => {
  const scene = new THREE.Scene();
  sceneApi.buildCourt(scene, 'hard');
  const barrier = scene.getObjectByName('wtsl-courtside-safety-barrier');
  assert.ok(barrier);
  assert.equal(barrier.userData.height, 1.3);
  assert.equal(barrier.userData.accessGaps, 4);
  assert.equal(barrier.userData.outsideClearRunoff, true);
  const panels = barrier.children.filter((object) => object.name === 'wtsl-courtside-safety-glass');
  assert.equal(panels.length, 8, 'four transparent sides retain centered player and spectator access aisles');
  for (const panel of panels) {
    assert.ok(Math.abs(panel.position.z) >= 11.5 || Math.abs(panel.position.x) >= 21.5,
      'the barrier remains beyond the continuous court apron');
    assert.equal(panel.material.transparent, true);
  }
  const continuousCourt = scene.children.find((object) =>
    object.isMesh
    && object.geometry?.type === 'PlaneGeometry'
    && object.geometry.parameters.width === 42
    && object.geometry.parameters.height === 22);
  assert.ok(continuousCourt, 'the original 42 by 22 court apron geometry is unchanged');
});

test('upper crowd anchors match the architecture seat coordinates and facing', () => {
  const scene = new THREE.Scene();
  sceneApi.buildStadiumEnvironment(scene);
  const crowd = sceneApi.buildCrowd(scene);
  const architectureSeats = scene.getObjectByName('wtsl-continuous-bowl-seats');
  assert.ok(architectureSeats?.isInstancedMesh);
  const innerX = 27.8, innerZ = 18.8, rowWidth = 1.62, rowRise = 0.94;
  const concourseWidth = 2.15, tierRows = 6, baseY = 2.7, tunnelHalfWidth = 2.5;
  const rowRadiusStart = (row) => row * rowWidth + Math.floor(row / tierRows) * concourseWidth;
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  let sourceOffset = 0;
  for (let row = 0; row < 18; row += 1) {
    const radius = rowRadiusStart(row) + rowWidth / 2;
    const ellipseX = innerX + radius;
    const ellipseZ = innerZ + radius;
    const count = Math.round((Math.PI * 2 * ((ellipseX + ellipseZ) / 2)) / 0.86);
    const expected = [];
    for (let index = 0; index < count; index += 1) {
      architectureSeats.getMatrixAt(sourceOffset + index, matrix);
      matrix.decompose(position, rotation, scale);
      if (Math.abs(position.x) < tunnelHalfWidth || Math.abs(position.z) < tunnelHalfWidth) continue;
      expected.push({ x: position.x, z: position.z, facing: Math.atan2(matrix.elements[8], matrix.elements[0]) });
    }
    const actual = crowd.seats.filter((seat) => seat.row === row + 4);
    assert.equal(actual.length, expected.length, `crowd row ${row} keeps architecture seat occupancy`);
    for (let index = 0; index < expected.length; index += 1) {
      assert.ok(Math.abs(actual[index].x - expected[index].x) < 1e-5, `row ${row} x aligns`);
      assert.ok(Math.abs(actual[index].z - expected[index].z) < 1e-5, `row ${row} z aligns`);
      assert.ok(Math.abs(actual[index].facing - expected[index].facing) < 1e-5,
        `row ${row} index ${index} at ${actual[index].x},${actual[index].z}: facing ${actual[index].facing} != architecture ${expected[index].facing}`);
      assert.ok(Math.abs(actual[index].y - (baseY + row * rowRise)) < 1e-5, `row ${row} floor height aligns`);
    }
    sourceOffset += count;
  }
});

test('crowd implementation contains no legacy stand block and keeps textured people instanced', async () => {
  const sceneSource = await readFile(new URL('../components/DmoLiveCourt3DScene.ts', import.meta.url), 'utf8');
  const crowdSource = sceneSource.slice(
    sceneSource.indexOf('export function buildCrowd('),
    sceneSource.indexOf('export function buildCourtFixtures('),
  );
  assert.match(crowdSource, /return buildUnifiedCrowd\(scene\)/);
  assert.doesNotMatch(crowdSource, /historical reference|rowStep = 0\.66|platformMaterial/);
  const humanCrowdSource = await readFile(new URL('../components/DmoHumanCrowd.ts', import.meta.url), 'utf8');
  assert.match(humanCrowdSource, /new THREE\.InstancedMesh/);
  assert.doesNotMatch(humanCrowdSource, /new THREE\.Mesh\s*\(/,
    'textured spectators stay in shared batches rather than one draw call per person');
});

test('players use realistic materials and natural human proportions', () => {
  for (const isWta of [false, true]) {
    const rig = sceneApi.makePlayer(0xffffff, 0x445566, isWta);
    rig.head.geometry.computeBoundingBox();
    const headSize = rig.head.geometry.boundingBox.getSize(new THREE.Vector3()).multiply(rig.head.scale);
    assert.ok(headSize.y <= 0.285 && headSize.y >= 0.22, `head height ${headSize.y}`);
    assert.ok(headSize.x <= 0.215, `head width ${headSize.x}`);
    assert.notEqual(rig.body.geometry.type, 'LatheGeometry');
    assert.ok(rig.head.material.isMeshStandardMaterial, 'face uses physically based shading');
    assert.ok(rig.body.material.isMeshPhysicalMaterial, 'uniform uses a fabric-like physical material');
    assert.ok(!rig.head.material.isMeshToonMaterial);
    assert.ok(!rig.body.material.isMeshToonMaterial);
    assert.ok(rig.head.getObjectByName('natural-scalp'));
    const scalp = rig.head.getObjectByName('natural-scalp');
    scalp.geometry.computeBoundingBox();
    const scalpSize = scalp.geometry.boundingBox.getSize(new THREE.Vector3());
    assert.equal(scalp.geometry.userData.scalpShell.rowCount, 7, 'the fitted hair shell covers crown and sides');
    assert.ok(scalpSize.x > 0.19 && scalpSize.y > 0.22);
    const scalpVertices = scalp.geometry.getAttribute('position');
    const crownStart = new THREE.Vector3().fromBufferAttribute(scalpVertices, 4 * 49);
    const crownEnd = new THREE.Vector3().fromBufferAttribute(scalpVertices, 4 * 49 + 48);
    assert.ok(crownStart.distanceTo(crownEnd) < 0.00001, 'the face opening closes above the forehead');
    const headNames = [];
    rig.head.traverse(child => headNames.push(child.name));
    assert.equal(headNames.some(name => /anime|spike|blush/i.test(name)), false,
      'face and hair details avoid cartoon-specific features');
    assert.equal(rig.head.children.some(child => child.geometry?.type === 'ConeGeometry'), false,
      'hair uses a continuous scalp silhouette instead of spikes');
    for (const hand of [rig.leftHand, rig.rightHand]) {
      assert.equal(hand.geometry.userData.closedGrip, true, 'grip uses one continuous fist surface');
      assert.equal(hand.children.filter(child => child.geometry?.type === 'TubeGeometry').length, 0,
        'no detached finger loops');
      const thumb = hand.getObjectByName('grip-thumb');
      assert.ok(thumb && thumb.geometry.type === 'CapsuleGeometry');
      hand.updateMatrixWorld(true);
      const palmBounds = new THREE.Box3().setFromBufferAttribute(hand.geometry.getAttribute('position'))
        .applyMatrix4(hand.matrixWorld);
      assert.ok(palmBounds.intersectsBox(new THREE.Box3().setFromObject(thumb)),
        'the thumb joins the fist instead of floating beside it');
    }
    const handle = rig.racket.getObjectByName('racket-handle');
    const tape = rig.racket.getObjectByName('racket-grip-tape');
    assert.ok(handle && handle.geometry.parameters.radiusTop <= 0.02, 'the grip is narrow enough to show the hand');
    assert.ok(tape && tape.geometry.parameters.radiusTop <= 0.022);
    assert.ok(tape.geometry.parameters.radiusTop > handle.geometry.parameters.radiusBottom,
      'grip tape clears the shaft surface instead of flickering over it');
    assert.ok(rig.rightElbow.geometry.parameters.radius > 0.04, 'muscle segments blend into rounded elbows');
    rig.leftArm.geometry.computeBoundingBox();
    assert.ok(rig.leftArm.geometry.boundingBox.max.x - rig.leftArm.geometry.boundingBox.min.x > 0.14);
    for (const limb of [rig.leftArm, rig.leftForearm, rig.leftCalf]) {
      const profile = limb.geometry.parameters.points;
      assert.ok(profile[0].x > profile.at(-1).x, 'limbs taper toward the wrist or ankle, not toward the body');
    }
    assert.ok(rig.leftLeg.geometry.parameters.points[0].x <= 0.055,
      'upper thighs remain inside the waistband');
    if (!isWta) {
      const shorts = rig.hip.getObjectByName('single-piece-athletic-shorts');
      assert.ok(shorts, 'ATP apparel uses one connected shorts shell');
      assert.equal(shorts.geometry.type, 'ExtrudeGeometry');
      assert.equal(rig.hip.children.filter(part => part.name === 'shorts-volume').length, 1);
    } else {
      assert.ok(rig.hip.getObjectByName('tennis-skirt'));
    }
    const face = new THREE.Mesh(rig.head.geometry, rig.head.material);
    face.updateMatrixWorld(true);
    for (const eye of [rig.face.leftEye, rig.face.rightEye]) {
      const ray = new THREE.Raycaster(new THREE.Vector3(eye.position.x, eye.position.y, 1),
        new THREE.Vector3(0, 0, -1));
      const hit = ray.intersectObject(face, false)[0];
      assert.ok(hit, 'eye position must intersect the face');
      eye.geometry.computeBoundingBox();
      const eyeFront = eye.position.z + eye.geometry.boundingBox.max.z * eye.scale.z;
      assert.ok(eyeFront > hit.point.z + 0.003, 'whites must protrude beyond the face, not be buried');
      const eyeSize = eye.geometry.boundingBox.getSize(new THREE.Vector3()).multiply(eye.scale);
      assert.ok(eyeSize.y > 0.014 && eyeSize.y < 0.026, `natural eye height ${eyeSize.y}`);
      assert.ok(eye.getObjectByName('iris'));
      assert.ok(eye.getObjectByName('pupil'));
    }
    assert.ok((rig.head.position.y + headSize.y / 2) * rig.root.scale.y < 1.95);
  }
});

test('crowd is human-scaled and separated from deep-baseline player space', () => {
  const scene = new THREE.Scene();
  const crowd = sceneApi.buildCrowd(scene);
  const heads = scene.getObjectByName('wtsl-spectator-heads');
  assert.ok(heads, 'adult-sized spectator heads');
  assert.equal(heads.count, crowd.seats.length, 'every near and upper-bowl seat shares one crowd rig');
  assert.equal(heads.geometry.type, 'SphereGeometry', 'the lightweight fallback is replaced by textured seated humans');
  const matrix = new THREE.Matrix4();
  const before = new THREE.Matrix4();
  heads.getMatrixAt(0, before);
  const position = new THREE.Vector3().setFromMatrixPosition(before);
  assert.ok(position.y >= 1.2 && position.y <= 1.7, `front row head ${position.y}`);
  const headScale = new THREE.Vector3().setFromMatrixScale(before);
  assert.ok(headScale.y >= 0.22 && headScale.y <= 0.29, 'heads retain adult human proportions');
  assert.ok(headScale.x < 0.20, 'heads remain narrower than their height');
  for (let index = 0; index < heads.count; index++) {
    heads.getMatrixAt(index, matrix);
    const p = new THREE.Vector3().setFromMatrixPosition(matrix);
    assert.ok(Math.abs(p.x) >= 21.9 || Math.abs(p.z) >= 11.7, 'crowd must stay outside the runoff');
  }
  crowd.update(1, false, new THREE.Vector3(-10, 1, 0));
  heads.getMatrixAt(0, matrix);
  assert.notDeepEqual(matrix.elements, before.elements, 'spectator gaze follows the rally');
});

test('venue modes retain the same enclosed bowl without adding roof or sky geometry', () => {
  const outdoor = new THREE.Scene();
  sceneApi.buildStadiumEnvironment(outdoor, false);
  assert.equal(outdoor.getObjectByName('wtsl-open-sky'), undefined);
  assert.ok(outdoor.children.some(item => item.isLight)
    || outdoor.getObjectByName('wtsl-stadium-architecture')?.children.some(item => item.isLight));
  assert.equal(isIndoorDmoVenue('Paris-Bercy'), true);
  assert.equal(isIndoorDmoVenue('Philippe Chatrier'), false);
  const indoor = new THREE.Scene();
  sceneApi.buildStadiumEnvironment(indoor, true);
  assert.equal(indoor.getObjectByName('wtsl-open-sky'), undefined);
  assert.equal(indoor.getObjectByName('wtsl-indoor-ceiling'), undefined);
  assert.ok(indoor.getObjectByName('wtsl-continuous-seating-bowl'));
  assert.ok(outdoor.getObjectByName('wtsl-continuous-seating-bowl'));
});

test('court ground ends at the arena apron instead of extending into an exterior landscape', () => {
  const scene = new THREE.Scene();
  sceneApi.buildCourt(scene, 'hard');
  const apron = scene.getObjectByName('wtsl-court-apron');
  assert.ok(apron?.isMesh);
  assert.deepEqual(
    [apron.geometry.parameters.width, apron.geometry.parameters.height],
    [50, 36],
    'the playing surface is supported without a huge outdoor ground plane',
  );
});

test('umpire face turns both ways with the ball rather than rotating a featureless sphere', () => {
  const scene = new THREE.Scene();
  const official = sceneApi.buildCourtFixtures(scene);
  const gaze = scene.getObjectByName('wtsl-umpire-gaze');
  assert.ok(gaze && gaze.children.length >= 6);
  for (let n = 0; n < 30; n++) official.update(new THREE.Vector3(-10, 1, 0));
  const first = gaze.rotation.y;
  for (let n = 0; n < 30; n++) official.update(new THREE.Vector3(10, 1, 0));
  assert.ok(first * gaze.rotation.y < 0, 'head tracks both halves of the court');
});

test('clay wear follows forward and lateral slides at recorded court locations', () => {
  const samples = [
    { frame: 0, values: [0, 0, 0, 700, 100, -1200, 0] },
    { frame: 6, values: [0, 0, 0, 730, 100, -1200, 30] },
    { frame: 12, values: [0, 0, 0, 735, 100, -1200, 60] },
  ];
  const footwork = deriveLiveCourtFootworkEvents(samples);
  assert.ok(footwork.some(event => event.kind === 'slide' && event.player === 1),
    'a forward braking slide is not restricted to baseline-parallel motion');
  const marks = deriveLiveCourtSkidMarks(samples, footwork);
  assert.ok(marks.some(mark => mark.player === 1 && mark.x > 7 && mark.x < 8));
  assert.ok(marks.some(mark => mark.player === 2 && mark.z > 0));
});

test('contacts remain audible when the optional source sound list is empty', () => {
  const shots = [{ frame: 10, kind: 'shot', player: 1, shotType: 'rally' },
    { frame: 30, kind: 'point-end' }];
  const samples = [
    { frame: 18, values: [0, 0, 25, 0, 0, 0, 0] },
    { frame: 20, values: [0, 0, 4, 0, 0, 0, 0] },
    { frame: 22, values: [0, 0, 20, 0, 0, 0, 0] },
  ];
  const cues = deriveLiveCourtSoundEvents([], shots, [{ frame: 16, kind: 'footstep', player: 1 }], samples);
  assert.deepEqual(cues.map(event => event.kind), ['racket', 'footstep', 'bounce']);
  const deduped = deriveLiveCourtSoundEvents([{ frame: 10, kind: 'racket' }, { frame: 21, kind: 'bounce' }],
    shots, [], samples);
  assert.equal(deduped.filter(event => event.kind === 'racket').length, 1);
  assert.equal(deduped.filter(event => event.kind === 'bounce').length, 1);
  assert.equal(deriveLiveCourtSoundEvents([], [{ frame: 0, kind: 'point-end' }], [], samples).length, 0);
});

test('court contacts use compact varied sound textures for each effect and surface', () => {
  const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const makeContext = () => {
    const buffers = [];
    const sources = [];
    const filters = [];
    const gains = [];
    const node = () => ({
      connect() { return this; },
      disconnect() {},
      start() {},
      stop() {},
      gain: param(),
      playbackRate: param(),
      threshold: param(),
      knee: param(),
      ratio: param(),
      attack: param(),
      release: param(),
      frequency: param(),
      Q: param(),
    });
    return {
      buffers,
      sources,
      filters,
      gains,
      context: {
        currentTime: 0, sampleRate: 8000, destination: {},
        createBuffer: (_, length, sampleRate) => {
          const channel = new Float32Array(length);
          const buffer = {
            duration: length / sampleRate,
            length,
            getChannelData: () => channel,
          };
          buffers.push(buffer);
          return buffer;
        },
        createBufferSource: () => {
          const source = node();
          sources.push(source);
          return source;
        },
        createGain: () => {
          const gain = node();
          gains.push(gain);
          return gain;
        },
        createBiquadFilter: () => {
          const filter = node();
          filters.push(filter);
          return filter;
        },
        createDynamicsCompressor: node,
      },
    };
  };

  for (const kind of ['racket', 'bounce', 'footstep', 'slide']) {
    const { context, sources } = makeContext();
    playLiveCourtEffect(context, kind, 'clay', 0.9);
    assert.equal(sources.length, 1, `${kind} plays one composed buffer`);
    const { buffer } = sources[0];
    assert.ok(buffer.duration > 0.04 && buffer.duration <= 0.2, `${kind} remains a short court cue`);
    const samples = buffer.getChannelData(0);
    assert.ok(samples.some(value => Math.abs(value) > 0.05), `${kind} has audible body`);
    assert.ok(Math.abs(samples[0]) < 0.001, `${kind} has a click-free onset`);
    assert.ok(sources[0].playbackRate.value >= 0.97 && sources[0].playbackRate.value <= 1.03);
  }

  const { context, sources } = makeContext();
  for (const surface of ['hard', 'clay', 'grass']) playLiveCourtEffect(context, 'bounce', surface);
  const bounceSamples = sources.map(source => Array.from(source.buffer.getChannelData(0).slice(0, 64)));
  assert.equal(new Set(bounceSamples.map(samples => samples.join(','))).size, 3,
    'surface profiles produce distinct bounce textures');

  const silent = makeContext();
  playLiveCourtEffect(silent.context, 'racket', 'hard', 0);
  assert.equal(silent.sources.length, 0, 'zero effects volume remains silent');
});

test('court effects load recorded samples and retain quiet, surface-aware footwork', async () => {
  const requestedUrls = [];
  const { samples, missing } = await loadCourtEffectSamples({
    decodeAudioData: async () => ({ duration: 0.25 }),
  }, async url => {
    requestedUrls.push(url);
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(32) };
  });
  assert.deepEqual(missing, []);
  assert.deepEqual(Object.keys(samples).sort(), ['bounce', 'footstep', 'racket', 'slide']);
  assert.deepEqual(requestedUrls.sort(), [
    '/audio/dmo-ball-bounce.mp3',
    '/audio/dmo-court-footstep.mp3',
    '/audio/dmo-court-slide.mp3',
    '/audio/dmo-racket-impact.mp3',
  ]);

  const param = () => ({ value: 0 });
  const makeContext = () => {
    const sources = [];
    const filters = [];
    const gains = [];
    const node = () => ({
      connect() { return this; },
      disconnect() {},
      start() {},
      stop() {},
      gain: param(),
      playbackRate: param(),
      frequency: param(),
      Q: param(),
      threshold: param(),
      knee: param(),
      ratio: param(),
      attack: param(),
      release: param(),
    });
    const context = {
      currentTime: 0,
      destination: {},
      createBufferSource: () => {
        const source = node();
        sources.push(source);
        return source;
      },
      createGain: () => {
        const gain = node();
        gains.push(gain);
        return gain;
      },
      createBiquadFilter: () => {
        const filter = node();
        filters.push(filter);
        return filter;
      },
      createDynamicsCompressor: node,
    };
    return { context, sources, filters, gains };
  };

  const sample = { duration: 0.25 };
  const hard = makeContext();
  const clay = makeContext();
  const grass = makeContext();
  for (const [context, surface] of [[hard.context, 'hard'], [clay.context, 'clay'], [grass.context, 'grass']]) {
    playLiveCourtEffect(context, 'footstep', surface, 1, { footstep: sample });
  }
  assert.ok(hard.sources.every(source => source.buffer === sample));
  assert.ok(clay.sources.every(source => source.buffer === sample));
  assert.ok(grass.sources.every(source => source.buffer === sample));
  assert.equal(new Set([
    hard.sources[0].playbackRate.value.toFixed(3),
    clay.sources[0].playbackRate.value.toFixed(3),
    grass.sources[0].playbackRate.value.toFixed(3),
  ]).size, 3, 'surface profiles shape the same recording differently');
  assert.ok(clay.gains[0].gain.value < 0.6, 'footsteps stay quieter than racket and ball contacts');

  const partial = await loadCourtEffectSamples({
    decodeAudioData: async () => ({ duration: 0.25 }),
  }, async url => ({
    ok: !url.endsWith('dmo-court-slide.mp3'),
    arrayBuffer: async () => new ArrayBuffer(32),
  }));
  assert.deepEqual(partial.missing, ['slide'], 'unavailable samples are reported for the visible fallback status');
});

test('point and game boundaries do not clear accumulated clay marks', async () => {
  const source = await readFile(new URL('../components/DmoLiveCourt3D.tsx', import.meta.url), 'utf8');
  const pointBlock = source.slice(source.indexOf("liveCourtTrajectoryCue(cue, false) === 'cheer'"),
    source.indexOf('const context = audioContextRef.current;', source.indexOf("liveCourtTrajectoryCue(cue, false)")));
  assert.doesNotMatch(pointBlock, /clearSkidMarks/);
  assert.match(source, /Test court sounds/);
  assert.match(source, /Court effects volume/);
});

test('crowd volume is adjustable with touch-friendly controls in both court views', async () => {
  const source = await readFile(new URL('../components/DmoLiveCourt3D.tsx', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../components/DmoLiveCourt3D.module.css', import.meta.url), 'utf8');
  const fallback = await readFile(new URL('../components/DmoLiveCourt.tsx', import.meta.url), 'utf8');
  const fallbackStyles = await readFile(new URL('../components/DmoLiveCourt.module.css', import.meta.url), 'utf8');
  assert.match(source, /\{stadiumAtmosphere && \(/, 'crowd volume remains available while sound is muted');
  assert.match(source, /aria-label="Lower crowd volume"/);
  assert.match(source, /aria-label="Raise crowd volume"/);
  assert.match(source, /aria-label="Crowd volume level"/);
  assert.match(source, /createMediaElementSource\(crowdAudio\)\.connect\(crowdGain\)/,
    'iOS crowd volume uses a Web Audio gain node');
  assert.match(source, /crowdGainRef\.current\.gain\.setTargetAtTime\(volume/);
  assert.doesNotMatch(source, /crowdAudioRef\.current\.volume/);
  assert.match(styles, /\.volumeButton\s*\{[\s\S]*?width:\s*44px/);
  assert.match(styles, /\.volumeControl input\s*\{[\s\S]*?min-height:\s*44px/);
  assert.match(fallback, /\{stadiumAtmosphere && \(\s*<div className=\{styles\.crowdVolumeControl\}/,
    'the mobile/WebGL fallback also exposes crowd volume while muted');
  assert.match(fallback, /crowdBed\.gain\.gain\.setTargetAtTime\(\s*volume \* 0\.02368421/,
    'the fallback slider changes the crowd audio gain');
  assert.match(fallbackStyles, /\.crowdVolumeControl input\s*\{[^}]*min-height:\s*44px/);
  assert.match(fallbackStyles, /\.sceneControls \.crowdVolumeControl button\s*\{\s*width:\s*44px/);
});

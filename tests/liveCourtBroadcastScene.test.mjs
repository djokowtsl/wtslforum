import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as THREE from 'three';
import { courtSurfaceSoundProfile, isIndoorDmoVenue } from '../lib/te4DmoSurface.ts';
import { deriveLiveCourtFootworkEvents, deriveLiveCourtSkidMarks } from '../lib/liveCourtMotion.ts';
import { advanceGait, gaitFeet, newGaitState } from '../lib/liveCourtGait.ts';

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
const venueApi = await loadTs('../lib/dmoVenue.ts');
const sceneApi = await loadTs('../components/DmoLiveCourt3DScene.ts', {
  './DmoStadiumArchitecture': stadiumArchitectureApi,
  '../lib/dmoVenue': venueApi,
});
const crowdLodApi = await loadTs('../lib/dmoCrowdLod.ts');
const {
  deriveLiveCourtSoundEvents,
  loadCourtEffectSamples,
  playLiveCourtEffect,
  updateLiveCourtFootstepContact,
} = await loadTs('../lib/liveCourtAudio.ts', {
  './te4DmoSurface': { courtSurfaceSoundProfile },
});
const umpireApi = await loadTs('../lib/liveCourtUmpire.ts');

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
    assert.ok(superstructure.userData.maxInteriorCameraDistance >= 26);
    assert.ok(superstructure.userData.maxInteriorCameraDistance <= 44,
      'manual zoom remains inside the venue rather than exposing the complete stadium');
    assert.ok(
      superstructure.userData.interiorSeatEdgeRadius
        >= superstructure.userData.maxInteriorCameraDistance
          + Math.SQRT2 * superstructure.userData.maxInteriorCameraPan - 1e-9,
      'the maximum camera distance plus bounded pan stays within the seating edge',
    );
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

test('stadium and audience scale with recognized tournament capacities', async () => {
  const ashe = venueApi.resolveDmoVenueProfile('Arthur Ashe Stadium');
  const wimbledon = venueApi.resolveDmoVenueProfile('Wimbledon Centre Court');
  const delray = venueApi.resolveDmoVenueProfile('Delray Beach Tennis Center');
  assert.equal(ashe.capacity, 23_771);
  assert.equal(wimbledon.capacity, 14_979);
  assert.equal(delray.capacity, 8_200);
  assert.ok(ashe.upperRows > wimbledon.upperRows && wimbledon.upperRows > delray.upperRows);

  const asheScene = new THREE.Scene();
  const delrayScene = new THREE.Scene();
  sceneApi.buildStadiumEnvironment(asheScene, false, undefined, 'Arthur Ashe Stadium');
  sceneApi.buildStadiumEnvironment(delrayScene, false, undefined, 'Delray Beach Tennis Center');
  const asheBowl = asheScene.getObjectByName('wtsl-continuous-seating-bowl');
  const delrayBowl = delrayScene.getObjectByName('wtsl-continuous-seating-bowl');
  assert.equal(asheBowl.geometry.userData.rows, ashe.upperRows);
  assert.equal(delrayBowl.geometry.userData.rows, delray.upperRows);
  assert.ok(
    asheScene.getObjectByName('wtsl-stadium-superstructure').userData.seatCount
      > delrayScene.getObjectByName('wtsl-stadium-superstructure').userData.seatCount,
  );
  assert.ok(
    asheScene.getObjectByName('wtsl-stadium-superstructure').userData.maxInteriorCameraDistance
      > delrayScene.getObjectByName('wtsl-stadium-superstructure').userData.maxInteriorCameraDistance,
    'the zoom limit tracks venue scale while remaining inside the bowl',
  );

  const asheCrowd = sceneApi.buildCrowd(new THREE.Scene(), 'Arthur Ashe Stadium');
  const delrayCrowd = sceneApi.buildCrowd(new THREE.Scene(), 'Delray Beach Tennis Center');
  assert.ok(asheCrowd.seats.length > delrayCrowd.seats.length);
  const court = await readFile(new URL('../components/DmoLiveCourt3D.tsx', import.meta.url), 'utf8');
  const viewer = await readFile(new URL('../components/DmoLiveViewer.tsx', import.meta.url), 'utf8');
  assert.match(court, /sceneDataRef\.current\.snapshot\.stadium/);
  assert.match(court, /snapshot\.stadium\]\)/);
  assert.match(court, /const RENDERER_BUILD = 'stadium\/audio \+ recorded volleys \+ player repair r14';/);
  assert.ok(court.includes('· ${RENDERER_BUILD}'), 'the renderer build hint remains visible under the court');
  assert.match(court, /maxInteriorCameraDistance/);
  assert.match(court, /controls\.maxDistance = maxDistanceForTarget\(cameraTargetAnchor\)/);
  assert.match(court, /maxPolarAngle = THREE\.MathUtils\.degToRad\(75\)/);
  assert.match(court, /clampDmoCameraTarget\(controls\.target, cameraTargetAnchor, cameraPanLimit\)/);
  assert.match(court, /camera\.fov = view === 'aerial' \? 50/);
  assert.match(viewer, /previousSnapshot\.stadium === nextSnapshot\.stadium/);
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
  const occupiedSeats = crowd.seats.filter((seat) => seat.occupied);
  const emptySeats = crowd.seats.filter((seat) => !seat.occupied);
  assert.ok(emptySeats.length > 50 && emptySeats.length < crowd.seats.length * 0.04,
    'a small, distributed number of seats remain empty');
  assert.ok(occupiedSeats.length > crowd.seats.length * 0.96,
    'the stands remain mostly full');
  assert.ok(emptySeats.some((seat) => seat.row < 4) && emptySeats.some((seat) => seat.row >= 4),
    'empty seats are distributed across lower and upper stands');
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
  const nearSupports = scene.getObjectByName('wtsl-near-court-seating-supports');
  assert.ok(nearSupports?.isInstancedMesh);
  assert.equal(nearSupports.count, 32, 'each lower row has narrow supports beneath its four seating sides');
  assert.equal(nearSupports.userData.style, 'narrow-beams');
  assert.equal(nearSupports.userData.accessPassages, 4, 'the supports leave the four walk-through gaps open');
  assert.equal(scene.getObjectByName('wtsl-near-court-seating-platforms'), undefined,
    'lower seating does not sit on a broad floating platform');
  assert.equal(scene.getObjectByName('wtsl-near-court-seating-risers'), undefined);
  const supportMatrix = new THREE.Matrix4();
  const supportScale = new THREE.Vector3();
  nearSupports.getMatrixAt(0, supportMatrix);
  supportMatrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), supportScale);
  assert.ok(supportScale.y < 0.13 && Math.min(supportScale.x, supportScale.z) <= 0.181,
    'visible supports are slim beams, not seating slabs');
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
  assert.equal(heads.count, occupiedSeats.length);
  assert.equal(arms.count, occupiedSeats.length * 2);
  const animatedSeat = occupiedSeats.findIndex((seat) => seat.row >= 4 && seat.sourceIndex % 5 !== 0);
  assert.ok(animatedSeat >= 0);
  const before = new THREE.Matrix4();
  const after = new THREE.Matrix4();
  const armBefore = new THREE.Matrix4();
  const armAfter = new THREE.Matrix4();
  heads.getMatrixAt(occupiedSeats.length - 1, before);
  arms.getMatrixAt(animatedSeat * 2, armBefore);
  crowd.update(1, true, new THREE.Vector3(-10, 1, 0));
  heads.getMatrixAt(occupiedSeats.length - 1, after);
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

test('professional courtside team areas have compact equipment and lower-stand coach seats', () => {
  const scene = new THREE.Scene();
  const fixtures = sceneApi.buildCourtFixtures(scene);
  assert.ok(fixtures);
  for (const side of ['left', 'right']) {
    const bench = scene.getObjectByName(`wtsl-player-bench-${side}`);
    assert.ok(bench?.userData.courtsideTeamArea);
    assert.ok(scene.getObjectByName(`wtsl-player-kit-bag-${side}`));
    assert.ok(scene.getObjectByName(`wtsl-player-water-bottle-${side}`));
    assert.ok(scene.getObjectByName(`wtsl-player-court-towel-${side}`));
    assert.equal(bench.getObjectByName(`wtsl-court-coach-${side === 'left' ? 1 : 2}`), undefined,
      'coaches are not seated on the courtside benches');
  }
  const crowd = sceneApi.buildCrowd(scene);
  assert.equal(crowd.staffSeats.length, 2);
  assert.ok(crowd.staffSeats.every((seat) => seat.row === 1 && Math.abs(seat.z) > 13),
    'reserved coach places are in the lower stands beyond the courtside runoff');
  assert.ok(crowd.staffSeats.every((staffSeat) =>
    !crowd.seats.some((seat) => seat.sourceIndex === staffSeat.sourceIndex)),
  'team staff seats are reserved rather than doubled with spectators');
  assert.ok(scene.getObjectByName('wtsl-umpire-chair'), 'the umpire remains in the chair');
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
  assert.match(crowdSource, /return buildUnifiedCrowd\(scene, resolveDmoVenueProfile\(venueName\)\)/);
  assert.doesNotMatch(crowdSource, /historical reference|rowStep = 0\.66|platformMaterial/);
  const humanCrowdSource = await readFile(new URL('../components/DmoHumanCrowd.ts', import.meta.url), 'utf8');
  assert.match(humanCrowdSource, /new THREE\.InstancedMesh/);
  const seatedGeometrySource = humanCrowdSource.slice(
    humanCrowdSource.indexOf('function seatedGeometry('),
    humanCrowdSource.indexOf('/** Textured seated humans'),
  );
  assert.doesNotMatch(seatedGeometrySource, /new THREE\.Mesh\s*\(/,
    'textured spectators stay in shared batches rather than one draw call per person');
  assert.match(humanCrowdSource, /wtsl-fan-banner-/);
  assert.match(humanCrowdSource, /wtsl-court-coach-/);
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
  assert.equal(heads.count, crowd.seats.filter((seat) => seat.occupied).length,
    'people occupy most but not all near and upper-bowl seats');
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

test('slide footwork stays visual and never enters the court audio queue', () => {
  const queued = deriveLiveCourtSoundEvents(
    [{ frame: 8, kind: 'slide' }],
    [],
    [{ frame: 8, kind: 'slide', player: 1 }, { frame: 12, kind: 'footstep', player: 1 }],
    [],
  );
  assert.deepEqual(queued, [{ frame: 12, kind: 'footstep', player: 1 }]);
});

test('court contacts stay compact and slide squeaks are silent', () => {
  const param = () => ({
    value: 0,
    setValueAtTime() {},
    linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {},
  });
  const makeContext = () => {
    const buffers = [];
    const sources = [];
    const filters = [];
    const gains = [];
    const node = () => ({
      connect() { return this; },
      disconnect() {},
      start(...args) { this.startArguments = args; },
      stop(time) { this.stoppedAt = time; },
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

  for (const kind of ['racket', 'bounce', 'footstep']) {
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

  const unwantedSlide = makeContext();
  playLiveCourtEffect(unwantedSlide.context, 'slide', 'clay', 0.9, {
    slide: { duration: 0.522 },
  });
  assert.equal(unwantedSlide.sources.length, 0, 'slide events stay silent even if an old sample is supplied');

  const { context, sources } = makeContext();
  for (const surface of ['hard', 'clay', 'grass']) playLiveCourtEffect(context, 'bounce', surface);
  const bounceSamples = sources.map(source => Array.from(source.buffer.getChannelData(0).slice(0, 64)));
  assert.equal(new Set(bounceSamples.map(samples => samples.join(','))).size, 3,
    'surface profiles produce distinct bounce textures');

  const silent = makeContext();
  playLiveCourtEffect(silent.context, 'racket', 'hard', 0);
  assert.equal(silent.sources.length, 0, 'zero effects volume remains silent');

  for (const recorded of [false, true]) {
    const spaced = makeContext();
    const samples = recorded ? { footstep: { duration: 0.45 } } : {};
    for (let index = 0; index < 20; index += 1) {
      spaced.context.currentTime = index * 0.025;
      playLiveCourtEffect(spaced.context, 'footstep', 'hard', 1, samples);
    }
    assert.equal(spaced.sources.length, 5,
      'recorded and backup footsteps merge coincident contacts without imposing a slow cadence');
    const count = spaced.sources.length;
    for (let index = 0; index < 20; index += 1) {
      playLiveCourtEffect(spaced.context, 'footstep', 'hard', 1, samples);
    }
    assert.equal(spaced.sources.length, count, 'a delayed batch cannot play footsteps together');
    playLiveCourtEffect(spaced.context, 'racket', 'hard', 1);
    playLiveCourtEffect(spaced.context, 'bounce', 'hard', 1);
    assert.equal(spaced.sources.length, count + 2, 'footstep spacing never suppresses contacts');
    assert.ok(spaced.gains.slice(0, count).every(gain => gain.gain.value < (recorded ? 0.35 : 0.6)),
      'footsteps stay quieter in both playback modes');
  }

  const mutedSteps = makeContext();
  playLiveCourtEffect(mutedSteps.context, 'footstep', 'hard', 0);
  playLiveCourtEffect(mutedSteps.context, 'footstep', 'hard', 1);
  assert.equal(mutedSteps.sources.length, 1, 'muted events do not suppress the first audible step');
});

test('footsteps sound on animated foot plants, not on a movement timer', () => {
  for (const fps of [30, 60, 120]) {
    for (const speed of [1.5, 4]) {
      const gait = newGaitState();
      const state = { frame: NaN, airborne: [false, false] };
      let contacts = 0;
      for (let index = 0; index < fps * 3; index += 1) {
        advanceGait(gait, [0, speed / fps], speed);
        const feet = gaitFeet(gait, speed);
        const frame = index * 60 / fps;
        const contact = updateLiveCourtFootstepContact(state, frame, feet.map(foot => foot.lift), true);
        if (contact) {
          contacts += 1;
          assert.ok(feet.some(foot => foot.lift <= 0.001), 'a foot is touching the court');
        }
        assert.equal(updateLiveCourtFootstepContact(state, frame, feet.map(foot => foot.lift), true), false,
          'a paused render cannot repeat a contact');
      }
      assert.ok(contacts >= 4 && contacts < 28, `${fps}fps/${speed}m/s has movement-driven landings`);
    }
  }
  const state = { frame: 0, airborne: [false, false] };
  assert.equal(updateLiveCourtFootstepContact(state, 1, [0, 0], true), false, 'standing is silent');
  updateLiveCourtFootstepContact(state, 2, [0.03, 0], true);
  assert.equal(updateLiveCourtFootstepContact(state, 3, [0, 0], false), false, 'slides and non-gait poses are silent');
  updateLiveCourtFootstepContact(state, 4, [0.03, 0], true);
  assert.equal(updateLiveCourtFootstepContact(state, 80, [0, 0], true), false, 'a seek does not replay landings');
  updateLiveCourtFootstepContact(state, 81, [0.03, 0], true);
  assert.equal(updateLiveCourtFootstepContact(state, 0, [0, 0], true), false, 'rewinding resets contact tracking');
});

test('court effects load only playable samples and sound checks exclude slides', async () => {
  const requestedUrls = [];
  const { samples, missing } = await loadCourtEffectSamples({
    decodeAudioData: async () => ({ duration: 0.25 }),
  }, async url => {
    requestedUrls.push(url);
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(32) };
  });
  assert.deepEqual(missing, []);
  assert.deepEqual(Object.keys(samples).sort(), ['bounce', 'footstep', 'racket']);
  assert.deepEqual(requestedUrls.sort(), [
    '/audio/dmo-ball-bounce.mp3',
    '/audio/dmo-court-footstep.mp3',
    '/audio/dmo-racket-impact.mp3',
  ]);

  const param = () => ({
    value: 0,
    setValueAtTime() {},
    linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {},
  });
  const makeContext = () => {
    const sources = [];
    const filters = [];
    const gains = [];
    const node = () => ({
      connect() { return this; },
      disconnect() {},
      start(...args) { this.startedAt = args[0]; this.startArguments = args; },
      stop(time) { this.stoppedAt = time; },
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
      sampleRate: 44_100,
      destination: {},
      createBuffer: (_channels, length, sampleRate) => ({
        duration: length / sampleRate,
        getChannelData: () => new Float32Array(length),
      }),
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
    ok: !url.endsWith('dmo-ball-bounce.mp3'),
    arrayBuffer: async () => new ArrayBuffer(32),
  }));
  assert.deepEqual(partial.missing, ['bounce'], 'unavailable samples are reported for the visible fallback status');
  const audioSource = await readFile(new URL('../lib/liveCourtAudio.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(audioSource, /dmo-court-slide\.mp3/);
  assert.match(audioSource, /!Object\.hasOwn\(sampleGain, kind\)/,
    'legacy slide cues fail closed instead of producing any sound');
});

test('point and game boundaries do not clear accumulated clay marks', async () => {
  const source = await readFile(new URL('../components/DmoLiveCourt3D.tsx', import.meta.url), 'utf8');
  const pointBlock = source.slice(source.indexOf("liveCourtTrajectoryCue(cue, false) === 'cheer'"),
    source.indexOf('const context = audioContextRef.current;', source.indexOf("liveCourtTrajectoryCue(cue, false)")));
  assert.doesNotMatch(pointBlock, /clearSkidMarks/);
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

test('umpire score calls use server order and tennis point language', () => {
  const players = ['Player One', 'Player Two'];
  assert.equal(umpireApi.formatTennisPointScoreCall('15-0', 1, players), 'fifteen-love');
  assert.equal(umpireApi.formatTennisPointScoreCall('15-0', 2, players), 'love-fifteen');
  assert.equal(umpireApi.formatTennisPointScoreCall('40-40', 1, players), 'Deuce');
  assert.equal(umpireApi.formatTennisPointScoreCall('40-AD', 2, players), 'Advantage, Player Two');
  assert.equal(umpireApi.formatTennisPointScoreCall('5-5', 1, players, true), 'five-all');
  assert.equal(umpireApi.formatTennisPointScoreCall('3-4', 1, players), 'three-four',
    'numeric tiebreak scores are recognized from the DMO timeline');
});

test('live TE4 score changes announce games and scores without replaying the initial score', () => {
  const players = ['Player One', 'Player Two'];
  const previous = {
    sets: [],
    games: [2, 2],
    pointText: ['40', '30'],
    tiebreak: false,
    server: 1,
  };
  assert.equal(
    umpireApi.formatLiveUmpireScoreCall(
      { ...previous, pointText: ['40', '40'] },
      previous,
      players,
    ),
    'Deuce',
  );
  assert.equal(
    umpireApi.formatLiveUmpireScoreCall(
      { ...previous, games: [3, 2], pointText: ['0', '0'] },
      previous,
      players,
    ),
    'Game, Player One',
  );
  assert.equal(
    umpireApi.formatLiveUmpireScoreCall(
      { ...previous, sets: [[6, 4]], games: [0, 0] },
      previous,
      players,
    ),
    'Game and set, Player One',
  );
});

test('replay score calls follow point-end frames and only clear rally-outs are called', () => {
  const trajectory = [
    { frame: 10, kind: 'shot', shotType: 'rally' },
    { frame: 14, kind: 'point-end', scoreCall: 'fifteen-love' },
    { frame: 20, kind: 'shot', shotType: 'rally' },
    { frame: 25, kind: 'point-end', scoreCall: 'Game, Player One' },
  ];
  const sounds = [
    { frame: 12, kind: 'bounce' },
    { frame: 22, kind: 'bounce' },
  ];
  const samples = [
    { frame: 12, values: [1_215, 0, 2, 0, 0, 0, 0] },
    { frame: 22, values: [0, 420, 2, 0, 0, 0, 0] },
  ];
  const calls = umpireApi.deriveUmpireCallEvents(trajectory, sounds, samples);
  assert.deepEqual(calls, [
    { frame: 12, kind: 'out', text: 'Out' },
    { frame: 14, kind: 'score', text: 'fifteen-love' },
    { frame: 25, kind: 'score', text: 'Game, Player One' },
  ]);
  assert.deepEqual(umpireApi.umpireCallsBetween(calls, 12, 25), [
    { frame: 14, kind: 'score', text: 'fifteen-love' },
    { frame: 25, kind: 'score', text: 'Game, Player One' },
  ]);
  assert.deepEqual(
    umpireApi.deriveUmpireCallEvents(
      [
        { frame: 10, kind: 'shot', shotType: 'serve' },
        { frame: 14, kind: 'point-end', scoreCall: 'fifteen-love' },
      ],
      [{ frame: 12, kind: 'bounce' }],
      [{ frame: 12, values: [1_215, 0, 2, 0, 0, 0, 0] }],
    ),
    [{ frame: 14, kind: 'score', text: 'fifteen-love' }],
    'a serve bounce is not presented as an authoritative line call',
  );
});

test('umpire calls have independent controls in both court renderers', async () => {
  const primary = await readFile(new URL('../components/DmoLiveCourt3D.tsx', import.meta.url), 'utf8');
  const fallback = await readFile(new URL('../components/DmoLiveCourt.tsx', import.meta.url), 'utf8');
  for (const source of [primary, fallback]) {
    assert.match(source, /aria-label=\{umpireCallsEnabled \? 'Turn umpire calls off'/);
    assert.match(source, /aria-pressed=\{umpireCallsEnabled\}/);
    assert.match(source, /formatLiveUmpireScoreCall\(current, previous, scoreboardData\.players\)/);
  }
  assert.match(primary, /call\.kind === 'score' && !fullReplay/);
  assert.match(fallback, /call\.kind === 'score' && !fullReplayRef\.current/);
});

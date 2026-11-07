import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as THREE from 'three';
import { BVHLoader } from 'three/examples/jsm/loaders/BVHLoader.js';
import {
  courtSurfaceSoundProfile,
  courtSurfaceVisualProfile,
  isIndoorDmoVenue,
} from '../lib/te4DmoSurface.ts';
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
const courtSurfaceApi = await loadTs('../lib/te4DmoSurface.ts');
const crowdDensityApi = await loadTs('../lib/dmoCrowdDensity.ts');
const sceneApi = await loadTs('../components/DmoLiveCourt3DScene.ts', {
  './DmoStadiumArchitecture': stadiumArchitectureApi,
  '../lib/dmoVenue': venueApi,
  '@/lib/te4DmoSurface': courtSurfaceApi,
  '@/lib/dmoCrowdDensity': crowdDensityApi,
});
const crowdLodApi = await loadTs('../lib/dmoCrowdLod.ts');
const smashApi = await loadTs('../lib/dmoSmash.ts');
const {
  deriveLiveCourtSoundEvents,
  loadCourtEffectSamples,
  playLiveCourtEffect,
  updateLiveCourtFootstepContact,
} = await loadTs('../lib/liveCourtAudio.ts', {
  './te4DmoSurface': { courtSurfaceSoundProfile },
});
const xktUmpireAudioApi = await loadTs('../lib/xktUmpireAudio.ts');
const umpireApi = await loadTs('../lib/liveCourtUmpire.ts', {
  './xktUmpireAudio': xktUmpireAudioApi,
});

test('automatic crowd density follows the broadcaster-selected tournament round', () => {
  assert.equal(crowdDensityApi.resolveCrowdDensity('auto', 'round-of-64'), 0.58);
  assert.equal(crowdDensityApi.resolveCrowdDensity('auto', 'semifinal'), 0.94);
  assert.equal(crowdDensityApi.resolveCrowdDensity('auto', 'final'), 0.99);
  assert.equal(crowdDensityApi.resolveCrowdDensity('light', 'final'), 0.42);
  assert.equal(crowdDensityApi.resolveCrowdDensity('standard', 'final'), 0.98);
  assert.equal(crowdDensityApi.resolveCrowdDensity('auto', 'unknown'), 0.98);
  assert.equal(crowdDensityApi.isCrowdSeatOccupied(17, 0), false);
  assert.equal(crowdDensityApi.isCrowdSeatOccupied(17, 1), true);
  assert.equal(crowdDensityApi.isCrowdSeatOccupied(17, 0.5), crowdDensityApi.isCrowdSeatOccupied(17, 0.5));
});

test('crowd occupancy updates in place without changing the seating layout', () => {
  const scene = new THREE.Scene();
  const crowd = sceneApi.buildCrowd(scene);
  const heads = scene.getObjectByName('wtsl-spectator-heads');
  const seatCount = crowd.seats.length;
  assert.ok(heads);

  crowd.setDensity(0);
  assert.equal(crowd.seats.filter((seat) => seat.occupied).length, 0);
  assert.equal(heads.count, 0);
  crowd.setDensity(1);
  assert.equal(crowd.seats.filter((seat) => seat.occupied).length, seatCount);
  assert.equal(heads.count, seatCount);
});

function smashFlight(player = 1) {
  const event = { frame: 60, kind: 'shot', shotType: 'rally', player };
  const incoming = { frame: 0, kind: 'shot', shotType: 'rally', player: player === 1 ? 2 : 1 };
  const heights = [100, 160, 250, 350, 450, 500, 470, 410, 350, 300, 250];
  const samples = heights.map((height, index) => ({
    frame: index * 6,
    values: [
      -900 + index * 120, 0, height,
      player === 1 ? 300 : -900, 0,
      player === 2 ? 300 : -900, 0,
    ],
  }));
  return { event, samples, events: [incoming, event], contact: samples.at(-1).values };
}

test('captured smashes require near-net overhead contact after an incoming descending lob', () => {
  for (const player of [1, 2]) {
    const flight = smashFlight(player);
    assert.equal(smashApi.isCapturedSmashShot(
      flight.event, flight.contact, flight.samples, flight.events, 60,
    ), true);
  }
});

test('normal rallies and baseline shots keep their existing non-smash animations', () => {
  const { event, samples, events, contact } = smashFlight();
  const baseline = [...contact];
  baseline[0] = baseline[3] = 1100;
  assert.equal(smashApi.isCapturedSmashShot(event, baseline, samples, events), false,
    'even a high lob contact at the baseline is not a near-net smash');
  for (const centimetres of [40, 80, 120, 180, 224]) {
    const normalContact = [...contact];
    normalContact[2] = centimetres;
    assert.equal(smashApi.isCapturedSmashShot(event, normalContact, samples, events), false,
      `${centimetres} source centimetres must not be compared directly with a metre threshold`);
  }
  const flatFlight = samples.map(sample => ({ ...sample, values: sample.values.map(
    (value, index) => index === 2 ? 260 : value,
  ) }));
  assert.equal(smashApi.isCapturedSmashShot(event, contact, flatFlight, events), false,
    'high contact alone is not evidence of an incoming lob');
});

test('smash inference fails closed for serves, rising balls, sparse flights and missing opponents', () => {
  const { event, samples, events, contact } = smashFlight();
  assert.equal(smashApi.isCapturedSmashShot({ ...event, shotType: 'serve' }, contact, samples, events), false);
  assert.equal(smashApi.isCapturedSmashShot(undefined, contact, samples, events), false);
  assert.equal(smashApi.isCapturedSmashShot(event, null, samples, events), false,
    'a missing interpolated contact keeps the original rally animation');
  assert.equal(smashApi.isCapturedSmashShot(event, contact, samples, [event]), false);
  assert.equal(smashApi.isCapturedSmashShot(event, contact, samples, [
    events[0], { frame: 30, kind: 'point-end' }, event,
  ]), false);
  assert.equal(smashApi.isCapturedSmashShot(event, contact, samples.filter(
    sample => sample.frame % 24 === 0,
  ), events), false);
  const risingFlight = samples.map((sample, index) => ({
    ...sample, values: sample.values.map((value, axis) => axis === 2 && index === 9 ? 230 : value),
  }));
  assert.equal(smashApi.isCapturedSmashShot(event, contact, risingFlight, events), false,
    'an earlier high apex is insufficient when the ball is rising again at contact');
  const bouncedFlight = samples.map((sample, index) => ({
    ...sample, values: sample.values.map((value, axis) => axis === 2 && index === 7 ? 5 : value),
  }));
  assert.equal(smashApi.isCapturedSmashShot(event, contact, bouncedFlight, events), false);
});

test('captured smash source parses, reaches its selected contact frame, and is credited', async () => {
  const motion = await readFile(new URL('../public/models/dmo-humans/tennis-smash.bvh', import.meta.url), 'utf8');
  const parsed = new BVHLoader().parse(motion);
  assert.ok(parsed.clip.duration > 7.85, 'the selected contact frame is in the recording');
  assert.ok(parsed.skeleton.bones.some((bone) => bone.name === 'RightWrist'));
  assert.match(
    await readFile(new URL('../public/models/dmo-humans/SMASH-MOCAP-CREDIT.md', import.meta.url), 'utf8'),
    /CC BY-SA 3\.0/,
  );
});

test('captured smash motion is fetched and registered with the player retargeter', async () => {
  const [modelSource, rigSource, courtSource] = await Promise.all([
    readFile(new URL('../components/DmoHumanModels.ts', import.meta.url), 'utf8'),
    readFile(new URL('../components/DmoCapturedGroundstroke.ts', import.meta.url), 'utf8'),
    readFile(new URL('../components/DmoLiveCourt3D.tsx', import.meta.url), 'utf8'),
  ]);
  assert.match(modelSource, /load\('smash'\)/);
  assert.match(rigSource, /smash: this\.prepare\('smash', sources\.smash, rest\)/);
  assert.match(courtSource, /strokeCue === 'close-net'\s*&& isCapturedSmashShot\(\s*strokeEvent,\s*contactSample,\s*samples,\s*events,/);
  assert.match(courtSource, /const stroke = recordedStrokeForSide\(baseStroke, strokeCue === 'close-net'\)/);
  assert.match(courtSource, /capturedEvent\.stroke = 'smash'/);
});

test('umpire match keys normalize player order and keep tours distinct', () => {
  assert.equal(
    umpireApi.liveUmpireMatchKey(['Player Two', 'Player One'], false),
    umpireApi.liveUmpireMatchKey(['Player One', 'Player Two'], false),
  );
  assert.notEqual(
    umpireApi.liveUmpireMatchKey(['Player One', 'Player Two'], false),
    umpireApi.liveUmpireMatchKey(['Player One', 'Player Two'], true),
  );
});

test('recorded umpire playback replaces the previous voice for the same match', async () => {
  const cancelled = [];
  const played = [];
  const playbackApi = await loadTs('../lib/liveCourtUmpire.ts', {
    './xktUmpireAudio': {
      cancelXktUmpireCalls: (context) => cancelled.push(context),
      playXktUmpireCall: async (context, text) => {
        played.push({ context, text });
        return true;
      },
    },
  });
  const firstContext = {};
  const secondContext = {};
  const otherMatchContext = {};
  await playbackApi.speakUmpireCall('Game, Player One', firstContext, false, () => true, 'match-one');
  await playbackApi.speakUmpireCall('15-all', firstContext, false, () => true, 'match-one');
  await playbackApi.speakUmpireCall('30-all', secondContext, false, () => true, 'match-one');
  await playbackApi.speakUmpireCall('Game, Player Three', otherMatchContext, false, () => true, 'match-two');

  assert.deepEqual(cancelled, [firstContext]);
  assert.deepEqual(played.map((call) => call.context), [
    firstContext,
    firstContext,
    secondContext,
    otherMatchContext,
  ]);
});

test('stadium keeps its structure and clear score screen without smeared ribbon graphics', () => {
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
    const firstSeatMatrix = new THREE.Matrix4();
    const firstSeatPosition = new THREE.Vector3();
    seats.getMatrixAt(0, firstSeatMatrix);
    firstSeatPosition.setFromMatrixPosition(firstSeatMatrix);
    assert.ok(Math.abs(firstSeatPosition.y - 3.55) < 1e-5,
      'upper seats sit at the same body-to-seat height as the lower seating');
    const firstSeatBackMatrix = new THREE.Matrix4();
    const firstSeatBackPosition = new THREE.Vector3();
    seatBacks.getMatrixAt(0, firstSeatBackMatrix);
    firstSeatBackPosition.setFromMatrixPosition(firstSeatBackMatrix);
    assert.ok(Math.abs(firstSeatBackPosition.y - 3.89) < 1e-5,
      'seat backs support the lower torso instead of sitting below the spectators');
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
    assert.equal(named(superstructure, 'wtsl-scoreboard-frame').length, 2);
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

test('clear livescore screen remains while smeared stand ribbons are removed', async () => {
  const source = await readFile(new URL('../components/DmoStadiumArchitecture.ts', import.meta.url), 'utf8');
  assert.match(source, /screenDisplay\.update\(data\)/);
  assert.match(source, /makeScreenTexture/);
  assert.doesNotMatch(source, /makeRibbonTexture|ribbonDisplay\.update\(data\)/);
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
  const fallback = await readFile(new URL('../components/DmoLiveCourt.tsx', import.meta.url), 'utf8');
  const viewer = await readFile(new URL('../components/DmoLiveViewer.tsx', import.meta.url), 'utf8');
  assert.match(court, /sceneDataRef\.current\.snapshot\.stadium/);
  assert.match(court, /snapshot\.stadium\]\)/);
  assert.doesNotMatch(court, /RENDERER_BUILD|player repair r14|recorded volleys \+/);
  assert.doesNotMatch(court, /Drag to orbit · scroll to zoom|Use Look across court to pan laterally/);
  assert.match(court, /backgroundColor: colorToCss\(PALETTE\.shirtOne\)/);
  assert.match(court, /backgroundColor: colorToCss\(PALETTE\.shirtTwo\)/);
  assert.match(court, /backgroundColor: colorToCss\(PALETTE\.yellow\)/);
  assert.match(fallback, /color: LIVE_COURT_COLORS\.playerOne/);
  assert.match(fallback, /color: LIVE_COURT_COLORS\.playerTwo/);
  assert.match(fallback, /backgroundColor: LIVE_COURT_COLORS\.playerOne/);
  assert.match(fallback, /backgroundColor: LIVE_COURT_COLORS\.playerTwo/);
  assert.match(fallback, /backgroundColor: LIVE_COURT_COLORS\.ball/);
  assert.doesNotMatch(fallback, /sceneNote/);
  assert.doesNotMatch(fallback, /Drag to orbit · adjust angle and elevation|Live court view · drag to orbit/);
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
     assert.ok(Math.abs(actual[index].y - (baseY + row * rowRise + rowRise / 2)) < 1e-5,
       `row ${row} seat height follows the sloped bowl row center`);
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
  assert.match(crowdSource, /return buildUnifiedCrowd\(scene, resolveDmoVenueProfile\(venueName\), density\)/);
  assert.doesNotMatch(crowdSource, /historical reference|rowStep = 0\.66|platformMaterial/);
  const humanCrowdSource = await readFile(new URL('../components/DmoHumanCrowd.ts', import.meta.url), 'utf8');
  assert.match(humanCrowdSource, /new THREE\.InstancedMesh/);
  assert.match(humanCrowdSource, /getCrowdAppearance\(sourceIndex, seat\.row\)/,
    'the detailed crowd consumes the same deterministic variation as its fallback');
  assert.match(humanCrowdSource, /getChairUmpireLegTargets\(sign, hipsY\)/,
    'the seated umpire uses the regression-tested chair-local leg targets');
  assert.match(humanCrowdSource, /'wtsl-detailed-umpire', 0x38536a, 1\.34, true/,
    'the chair pose is anchored to the revised seat height');
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
  assert.ok(headScale.y >= 0.21 && headScale.y <= 0.29, 'heads retain adult human proportions while stature varies');
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

test('spectators carry deterministic wardrobe, skin-tone, hair, and seated-silhouette variation', () => {
  const scene = new THREE.Scene();
  const crowd = sceneApi.buildCrowd(scene);
  const sample = crowd.seats.filter((seat) => seat.occupied).slice(0, 240);
  const appearances = sample.map((seat, index) =>
    sceneApi.getCrowdAppearance(seat.sourceIndex ?? index, seat.row));
  assert.ok(appearances.every((look) => look.stature >= 0.94 && look.stature <= 1.03),
    'seated people vary naturally without extreme height outliers');
  assert.ok(new Set(appearances.map((look) => look.skinToneIndex)).size >= 7,
    'the audience uses a broad, naturally varied skin-tone palette without appearance labels');
  assert.equal(new Set(appearances.map((look) => look.hairStyle)).size, 4,
    'multiple hair silhouettes are distributed through the crowd');
  assert.equal(new Set(appearances.map((look) => look.wardrobe)).size, 4,
    'spectator clothing has more than a repeating two-look alternation');
  assert.ok(new Set(appearances.map((look) => look.stature)).size >= 8,
    'seated stature varies subtly from person to person');

  const bodies = scene.getObjectByName('wtsl-unified-crowd-fallback-bodies');
  const hair = scene.getObjectByName('wtsl-spectator-hair');
  const ponytails = scene.getObjectByName('wtsl-spectator-ponytails');
  assert.ok(bodies?.isInstancedMesh && hair?.isInstancedMesh && ponytails?.isInstancedMesh);
  const matrix = new THREE.Matrix4();
  const scale = new THREE.Vector3();
  const bodyWidths = new Set();
  let ponytailCount = 0;
  for (let index = 0; index < sample.length; index += 1) {
    bodies.getMatrixAt(index, matrix);
    matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
    bodyWidths.add(scale.x.toFixed(3));
    ponytails.getMatrixAt(index, matrix);
    matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
    if (scale.length() > 0.1) ponytailCount += 1;
  }
  assert.ok(bodyWidths.size >= 6, 'instanced torso widths avoid a single repeated silhouette');
  assert.ok(ponytailCount > 30, 'a subset of crowd hairstyles includes tied-back silhouettes');
  assert.ok(hair.count >= sample.length, 'hair remains instanced at crowd scale');
});

test('chair umpire has a natural bent-leg pose with feet supported by the chair foot bar', () => {
  const scene = new THREE.Scene();
  sceneApi.buildCourtFixtures(scene);
  const chair = scene.getObjectByName('wtsl-umpire-chair');
  const footBar = scene.getObjectByName('wtsl-umpire-foot-bar');
  assert.ok(chair && footBar?.isMesh);
  assert.equal(footBar.userData.supportsSeatedFeet, true);
  const seat = chair.children.find((object) => object.isMesh
    && object.geometry.type === 'BoxGeometry'
    && object.geometry.parameters.width === 0.58
    && Math.abs(object.position.y - 1.27) < 1e-6);
  assert.ok(seat, 'the chair seat and official remain at a compact, believable scale');

  const barTop = footBar.position.y + footBar.geometry.parameters.height / 2;
  for (const sign of [-1, 1]) {
    const { hip, knee, ankle, toe } = sceneApi.getChairUmpireLegTargets(sign, 1.34);
    const vector = (point) => new THREE.Vector3(...point);
    const hipPoint = vector(hip), kneePoint = vector(knee);
    const anklePoint = vector(ankle), toePoint = vector(toe);
    const thigh = hipPoint.distanceTo(kneePoint);
    const shin = kneePoint.distanceTo(anklePoint);
    const kneeAngle = kneePoint.clone().sub(hipPoint).normalize()
      .angleTo(anklePoint.clone().sub(kneePoint).normalize());
    assert.ok(thigh > 0.48 && thigh < 0.55, `human-length seated thigh ${thigh}`);
    assert.ok(shin > 0.43 && shin < 0.50, `human-length seated shin ${shin}`);
    assert.ok(kneeAngle > 1.55 && kneeAngle < 2.35, `naturally flexed seated knee ${kneeAngle}`);
    assert.ok(Math.abs(toePoint.y - barTop) < 0.01,
      'the toe rests on the top surface of the chair foot bar');
    assert.ok(toePoint.z > anklePoint.z, 'the foot points forward onto the support bar');
  }
  assert.ok(seat.position.y < 1.4 && footBar.position.y < 0.7,
    'the official is not raised on an oversized chair');
});

test('seated crowd and coach legs stay compact and within the seat-to-step reach', () => {
  const distance = (from, to) => new THREE.Vector3(...from).distanceTo(new THREE.Vector3(...to));
  for (const side of [-1, 1]) {
    const crowd = sceneApi.getSeatedCrowdLegTargets(side);
    assert.ok(distance(crowd.hip, crowd.knee) < 0.34, 'crowd thighs stay naturally bent');
    assert.ok(distance(crowd.knee, crowd.ankle) < 0.36, 'crowd shins do not stretch beyond their step');
    assert.ok(crowd.toe[1] < crowd.ankle[1] && crowd.toe[2] > crowd.ankle[2]);

    const coach = sceneApi.getSeatedCoachLegTargets(side, 0.4);
    assert.ok(distance(coach.hip, coach.knee) > 0.40 && distance(coach.hip, coach.knee) < 0.49);
    assert.ok(distance(coach.knee, coach.ankle) > 0.42 && distance(coach.knee, coach.ankle) < 0.49);
    assert.ok(coach.toe[1] > -0.5, 'coach feet stay at the lower stand step, not below the stadium');
  }
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
    const samples = recorded ? { footstep: { hard: [{ duration: 0.45 }] } } : {};
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
    assert.ok(spaced.gains.slice(0, count).every(gain => gain.gain.value < (recorded ? 0.07 : 0.11)),
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
  assert.equal(requestedUrls.length, 39, 'surface-matched XKT clips load alongside compact legacy fallbacks');
  assert.ok(requestedUrls.includes('/audio/xkt/court/racket/clay-01.mp3'));
  assert.ok(requestedUrls.includes('/audio/xkt/court/bounce/grass-03.mp3'));
  assert.deepEqual(samples.racket?.hard?.length, 6);
  assert.deepEqual(samples.bounce?.hard?.length, 3);
  assert.deepEqual(samples.footstep?.hard?.length, 1);

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
    playLiveCourtEffect(context, 'footstep', surface, 1, {
      footstep: { hard: [sample], clay: [sample], grass: [sample] },
    });
  }
  assert.ok(hard.sources.every(source => source.buffer === sample));
  assert.ok(clay.sources.every(source => source.buffer === sample));
  assert.ok(grass.sources.every(source => source.buffer === sample));
  assert.equal(new Set([
    hard.sources[0].playbackRate.value.toFixed(3),
    clay.sources[0].playbackRate.value.toFixed(3),
    grass.sources[0].playbackRate.value.toFixed(3),
  ]).size, 3, 'surface profiles shape the same recording differently');
  assert.ok(clay.gains[0].gain.value < 0.07, 'sampled footsteps are strongly reduced beneath racket and ball contacts');
  const synthesized = makeContext();
  playLiveCourtEffect(synthesized.context, 'footstep', 'clay', 1);
  assert.ok(
    synthesized.gains[0].gain.value < 0.11,
    'synthesized fallback footsteps also remain subdued',
  );

  const partial = await loadCourtEffectSamples({
    decodeAudioData: async () => ({ duration: 0.25 }),
  }, async url => ({
    ok: !url.includes('/court/bounce/') && !url.endsWith('dmo-ball-bounce.mp3'),
    arrayBuffer: async () => new ArrayBuffer(32),
  }));
  assert.deepEqual(partial.missing, ['bounce'], 'unavailable samples are reported for the visible fallback status');
  const audioSource = await readFile(new URL('../lib/liveCourtAudio.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(audioSource, /dmo-court-slide\.mp3/);
  assert.match(audioSource, /!Object\.hasOwn\(sampleGain, kind\)/,
    'legacy slide cues fail closed instead of producing any sound');
});

test('XKT umpire calls resolve score, tiebreak and recorded player-name clips', () => {
  const umpire = {
    pointScores: {
      '0_15': ['/score/love-fifteen.mp3'],
      '15_15': ['/score/fifteen-all.mp3'],
      advantage: ['/score/advantage.mp3'],
      deuce: ['/score/deuce.mp3'],
    },
    tiebreakScores: { '1_0': ['/tiebreak/1-0.mp3'] },
    gameCalls: ['/game/game.mp3'],
    setCalls: ['/set/set-one.mp3', '/set/set-two.mp3', '/set/set-three.mp3', '/set/set-four.mp3'],
  };
  const names = {
    atp: { alcaraz: '/names/alcaraz.mp3' },
    wta: { swiatek: '/names/swiatek.mp3' },
  };
  const resolve = (text, isWta = false) => (
    xktUmpireAudioApi.resolveXktUmpireCallPaths(text, umpire, names, isWta, () => 0)
  );

  assert.deepEqual(resolve('love-fifteen'), ['/score/love-fifteen.mp3']);
  assert.deepEqual(resolve('fifteen-all'), ['/score/fifteen-all.mp3']);
  assert.deepEqual(resolve('Deuce'), ['/score/deuce.mp3']);
  assert.deepEqual(resolve('1-0'), ['/tiebreak/1-0.mp3']);
  assert.deepEqual(resolve('Advantage, Carlos Alcaraz'), [
    '/score/advantage.mp3',
    '/names/alcaraz.mp3',
  ]);
  assert.deepEqual(resolve('Game, Carlos Alcaraz'), [
    '/game/game.mp3',
    '/names/alcaraz.mp3',
  ]);
  assert.deepEqual(resolve('Game and second set, Iga Świątek', true), [
    '/game/game.mp3',
    '/set/set-two.mp3',
    '/names/swiatek.mp3',
  ]);
  assert.equal(resolve('Game and set, Iga Świątek', true), null,
    'set calls without a known set number never choose a random ordinal');
  assert.equal(resolve('Out'), null, 'unsupported out calls stay silent instead of using another voice');
  assert.deepEqual(resolve('Game, Unlisted Player'), ['/game/game.mp3'],
    'unlisted players still receive the recorded game call without a mismatched name');
  assert.deepEqual(resolve('Advantage, Unlisted Player'), ['/score/advantage.mp3']);
  assert.deepEqual(resolve('Game and second set, Unlisted Player'), [
    '/game/game.mp3',
    '/set/set-two.mp3',
  ]);
});

test('recorded XKT calls decode, play through Web Audio, and stop on rewind', async () => {
  const startedSources = [];
  const requestedUrls = [];
  const context = {
    state: 'running',
    destination: {},
    decodeAudioData: async () => ({ duration: 0.4 }),
    createBufferSource() {
      const source = {
        buffer: null,
        onended: null,
        connect(target) { return target; },
        disconnect() {},
        start() { startedSources.push(this); },
        stop() { this.stopped = true; },
      };
      return source;
    },
    createGain() {
      return {
        gain: { value: 0 },
        connect() { return this; },
        disconnect() {},
      };
    },
  };
  const umpire = {
    pointScores: { '15_15': ['/score/fifteen-all.mp3'] },
    tiebreakScores: {},
    gameCalls: [],
    setCalls: [],
  };
  const names = { atp: {}, wta: {} };
  const fetcher = async (url) => {
    requestedUrls.push(url);
    return {
      ok: true,
      json: async () => (url.includes('umpire-index') ? umpire : names),
      arrayBuffer: async () => new ArrayBuffer(16),
    };
  };

  assert.equal(
    await xktUmpireAudioApi.playXktUmpireCall(context, 'fifteen-all', false, fetcher),
    true,
  );
  assert.equal(startedSources.length, 1);
  assert.ok(requestedUrls.includes('/audio/xkt/umpire-index.json'));
  assert.ok(requestedUrls.includes('/score/fifteen-all.mp3'));
  xktUmpireAudioApi.cancelXktUmpireCalls(context);
  assert.equal(startedSources[0].stopped, true);
});

test('missing recorded umpire clips never trigger a browser-system voice', async () => {
  const utterances = [];
  const hadWindow = Object.hasOwn(globalThis, 'window');
  const previousWindow = globalThis.window;
  const hadUtterance = Object.hasOwn(globalThis, 'SpeechSynthesisUtterance');
  const PreviousUtterance = globalThis.SpeechSynthesisUtterance;
  globalThis.window = {
    speechSynthesis: {
      speak: utterance => utterances.push(utterance),
      cancel() {},
    },
  };
  globalThis.SpeechSynthesisUtterance = class {
    constructor(text) {
      this.text = text;
    }
  };
  try {
    const playbackApi = await loadTs('../lib/liveCourtUmpire.ts', {
      './xktUmpireAudio': {
        cancelXktUmpireCalls() {},
        playXktUmpireCall: async () => false,
      },
    });
    const spoken = await playbackApi.speakUmpireCall(
      'Game, Unlisted Player',
      { state: 'running' },
      false,
      () => true,
      'missing-clip-test',
    );
    assert.equal(spoken, false);
    assert.equal(utterances.length, 0);
  } finally {
    if (hadWindow) globalThis.window = previousWindow;
    else delete globalThis.window;
    if (hadUtterance) globalThis.SpeechSynthesisUtterance = PreviousUtterance;
    else delete globalThis.SpeechSynthesisUtterance;
  }
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
  assert.equal(umpireApi.formatTennisPointScoreCall('5-6', 2, players, true), 'five-six',
    'tiebreak calls stay in player order regardless of the next server');
  assert.equal(umpireApi.formatTennisPointScoreCall('deuce', 1, players), 'Deuce');
  assert.equal(umpireApi.formatTennisPointScoreCall('ad 1', 2, players), 'Advantage, Player One');
  assert.equal(umpireApi.formatTennisPointScoreCall('ad 2', 1, players), 'Advantage, Player Two');
  assert.equal(umpireApi.formatTennisPointScoreCall('3-4', 1, players), 'three-four',
    'numeric tiebreak scores are recognized from the DMO timeline');
});

test('live TE4 score changes format games and scores without repeating the initial score', () => {
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
    'Game and first set, Player One',
  );
  assert.equal(
    umpireApi.formatLiveUmpireScoreCall(
      { ...previous, sets: [[6, 4], [4, 6]], games: [0, 0] },
      { ...previous, sets: [[6, 4]], games: [5, 4] },
      players,
    ),
    'Game and second set, Player Two',
    'set-ending calls state the number of the set that just finished',
  );
});

test('live score calls follow DMO point ends and stay within one score transition', () => {
  const players = ['Player One', 'Player Two'];
  const scores = [
    { sets: [], games: [0, 0], pointText: ['0', '0'], tiebreak: false, server: 1 },
    { sets: [], games: [0, 0], pointText: ['15', '0'], tiebreak: false, server: 1 },
    { sets: [], games: [0, 0], pointText: ['30', '0'], tiebreak: false, server: 1 },
    { sets: [], games: [0, 0], pointText: ['40', '0'], tiebreak: false, server: 1 },
    { sets: [], games: [1, 0], pointText: ['0', '0'], tiebreak: false, server: 2 },
  ];
  const tether = umpireApi.createLiveUmpireScoreTether();

  assert.equal(umpireApi.observeLiveUmpireScore(tether, scores[0], players, true), null);
  assert.equal(umpireApi.observeLiveUmpireScore(tether, scores[1], players, true), null,
    'a TE4 score update is queued instead of being announced early');
  assert.equal(umpireApi.matchLiveUmpireScoreToDmoPointEnd(tether, true), 'fifteen-love');

  assert.equal(umpireApi.matchLiveUmpireScoreToDmoPointEnd(tether, true), null,
    'a DMO point-end can arrive before its TE4 score update');
  assert.equal(umpireApi.observeLiveUmpireScore(tether, scores[2], players, true), 'thirty-love',
    'the delayed TE4 update is announced only after the matching DMO event');

  const capped = umpireApi.createLiveUmpireScoreTether();
  assert.equal(umpireApi.observeLiveUmpireScore(capped, scores[0], players, true), null);
  for (const score of scores.slice(1)) {
    assert.equal(umpireApi.observeLiveUmpireScore(capped, score, players, true), null);
  }
  assert.equal(capped.pendingScoreCalls.length, 2);
  assert.equal(umpireApi.MAX_LIVE_UMPIRE_SCORE_LAG_POINTS, 1);
  assert.equal(umpireApi.matchLiveUmpireScoreToDmoPointEnd(capped, true), 'forty-love',
    'stale calls are trimmed so the oldest queued call is at most one transition behind');
  assert.equal(umpireApi.matchLiveUmpireScoreToDmoPointEnd(capped, true), 'Game, Player One');
  assert.equal(umpireApi.matchLiveUmpireScoreToDmoPointEnd(capped, true), null,
    'a point end without a recent score waits for its corresponding TE4 update');

  const disabled = umpireApi.createLiveUmpireScoreTether();
  umpireApi.observeLiveUmpireScore(disabled, scores[0], players, true);
  umpireApi.observeLiveUmpireScore(disabled, scores[1], players, true);
  assert.equal(disabled.pendingScoreCalls.length, 1);
  assert.equal(umpireApi.observeLiveUmpireScore(disabled, scores[1], players, false), null);
  assert.equal(disabled.pendingScoreCalls.length, 0, 'disabling speech drops queued announcements');
  assert.equal(umpireApi.matchLiveUmpireScoreToDmoPointEnd(disabled, true), null);
  assert.equal(
    umpireApi.observeLiveUmpireScore(disabled, scores[2], players, true),
    'thirty-love',
    'only score updates after a new DMO event are announced when speech is re-enabled',
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
  assert.deepEqual(
    umpireApi.deriveUmpireCallEvents(
      [{ frame: 16, kind: 'point-end' }],
      [],
      [],
    ),
    [{ frame: 16, kind: 'point-end', text: '' }],
    'live score synchronization still gets a timing cue without a DMO score string',
  );
});

test('only the first bounce associated with a point can trigger an out call', () => {
  const trajectory = [
    { frame: 10, kind: 'shot', shotType: 'rally' },
    { frame: 30, kind: 'point-end', scoreCall: 'fifteen-love' },
    { frame: 40, kind: 'shot', shotType: 'rally' },
    { frame: 70, kind: 'point-end', scoreCall: 'thirty-love' },
  ];
  const sounds = [
    { frame: 12, kind: 'bounce' },
    { frame: 18, kind: 'bounce' },
    { frame: 42, kind: 'bounce' },
    { frame: 48, kind: 'bounce' },
  ];
  const samples = [
    { frame: 12, values: [1_215, 0, 2, 0, 0, 0, 0] },
    { frame: 18, values: [1_220, 0, 2, 0, 0, 0, 0] },
    { frame: 42, values: [0, 0, 2, 0, 0, 0, 0] },
    { frame: 48, values: [1_220, 0, 2, 0, 0, 0, 0] },
  ];

  assert.deepEqual(
    umpireApi.deriveUmpireCallEvents(trajectory, sounds, samples),
    [
      { frame: 12, kind: 'out', text: 'Out' },
      { frame: 30, kind: 'score', text: 'fifteen-love' },
      { frame: 70, kind: 'score', text: 'thirty-love' },
    ],
    'later dead-ball bounces cannot repeat or overturn the first-bounce decision',
  );
});

test('umpire calls have independent controls in both court renderers', async () => {
  const primary = await readFile(new URL('../components/DmoLiveCourt3D.tsx', import.meta.url), 'utf8');
  const fallback = await readFile(new URL('../components/DmoLiveCourt.tsx', import.meta.url), 'utf8');
  for (const source of [primary, fallback]) {
    assert.match(source, /aria-label=\{umpireCallsEnabled && !umpireSpeechReady/);
    assert.match(source, /aria-pressed=\{umpireCallsEnabled && umpireSpeechReady\}/);
    assert.match(source, /observeLiveUmpireScore\(/);
    assert.match(source, /matchLiveUmpireScoreToDmoPointEnd\(/);
    assert.doesNotMatch(source, /formatLiveUmpireScoreCall\(current, previous, scoreboardData\.players\)/);
    assert.match(source, /resumeUmpireAudioContext\(/);
    assert.doesNotMatch(source, /unlockBrowserUmpireSpeech\(\)/);
    assert.match(source, /Enable calls/);
    assert.match(source, /data-umpire-calls-toggle/);
    const activationStart = source.indexOf('const handleSoundActivationGesture');
    const activationEnd = source.indexOf('\n  };', activationStart);
    const activationHandler = source.slice(activationStart, activationEnd);
    assert.match(activationHandler, /data-umpire-calls-toggle/);
    assert.ok(
      activationHandler.indexOf('activateUmpireSpeechFromGesture()')
        < activationHandler.indexOf('soundEnabledRef.current')
        || activationHandler.indexOf('activateUmpireSpeechFromGesture()')
          < activationHandler.indexOf('soundPreferenceRef.current'),
      'umpire activation is attempted before checking whether court effects are active',
    );
  }
  assert.match(primary, /call\.kind === 'score' \|\| call\.kind === 'point-end'/);
  assert.match(fallback, /call\.kind === 'score' \|\| call\.kind === 'point-end'/);
  assert.doesNotMatch(primary, /soundOnRef\.current && umpireCallsEnabledRef\.current/);
  assert.doesNotMatch(fallback, /soundEnabledRef\.current && umpireCallsEnabledRef\.current/);
});

test('recorded umpire playback waits for a running audio context', async () => {
  const suspendedContext = {
    state: 'suspended',
    resume: async function () {
      this.state = 'running';
    },
  };
  assert.equal(await umpireApi.resumeUmpireAudioContext(suspendedContext), true);
  assert.equal(suspendedContext.state, 'running');

  const blockedContext = {
    state: 'suspended',
    resume: async () => undefined,
  };
  assert.equal(await umpireApi.resumeUmpireAudioContext(blockedContext), false);

  const rejectedContext = {
    state: 'suspended',
    resume: async () => { throw new Error('browser blocked activation'); },
  };
  assert.equal(await umpireApi.resumeUmpireAudioContext(rejectedContext), false);
});

test('broadcast court audio defaults on and the Court camera remains the initial preset', async () => {
  const primary = await readFile(new URL('../components/DmoLiveCourt3D.tsx', import.meta.url), 'utf8');
  const fallback = await readFile(new URL('../components/DmoLiveCourt.tsx', import.meta.url), 'utf8');
  assert.match(primary, /const \[soundEnabled, setSoundEnabled\] = useState\(true\)/);
  assert.match(fallback, /const \[soundEnabled, setSoundEnabled\] = useState\(true\)/);
  assert.match(primary, /const \[umpireCallsEnabled, setUmpireCallsEnabled\] = useState\(true\)/);
  assert.match(fallback, /const \[umpireCallsEnabled, setUmpireCallsEnabled\] = useState\(true\)/);
  assert.match(primary, /const \[gruntsEnabled, setGruntsEnabled\] = useState\(true\)/);
  assert.match(primary, /const \[cameraView, setCameraView\] = useState<CameraView>\('court'\)/);
  assert.match(primary, /onPointerDownCapture=\{\(event\) => handleSoundActivationGesture\(event\.target\)\}/);
  assert.match(fallback, /onPointerDownCapture=\{\(event\) => handleSoundActivationGesture\(event\.target\)\}/);
  assert.match(primary, /data-sound-toggle/);
  assert.match(fallback, /data-sound-toggle/);
});

test('mobile speech unlock is silent and happens only when called from a user gesture', () => {
  const originalWindow = globalThis.window;
  const originalUtterance = globalThis.SpeechSynthesisUtterance;
  const utterances = [];
  globalThis.window = {
    speechSynthesis: {
      speak: (utterance) => utterances.push(utterance),
    },
  };
  globalThis.SpeechSynthesisUtterance = class {
    constructor(text) {
      this.text = text;
    }
  };
  try {
    assert.equal(umpireApi.unlockBrowserUmpireSpeech(), true);
    assert.equal(utterances.length, 1);
    assert.equal(utterances[0].volume, 0);
    assert.equal(utterances[0].lang, 'en-GB');
    assert.equal(umpireApi.isBrowserUmpireSpeechUnlocked(), true);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalUtterance === undefined) delete globalThis.SpeechSynthesisUtterance;
    else globalThis.SpeechSynthesisUtterance = originalUtterance;
  }
});

test('surface finishes and ATP/WTA net treatments follow detected viewer metadata', async () => {
  const surfaces = ['hard', 'clay', 'grass', 'unknown'];
  const profiles = surfaces.map(surface => courtSurfaceVisualProfile(surface));
  assert.equal(new Set(profiles.map(profile => profile.playing)).size, surfaces.length);
  assert.equal(new Set(profiles.map(profile => profile.runoff)).size, surfaces.length);
  for (const profile of profiles) {
    assert.notEqual(profile.playing, profile.runoff);
  }

  const wtaScene = new THREE.Scene();
  sceneApi.buildCourt(wtaScene, 'clay', true);
  assert.equal(wtaScene.getObjectByName('wtsl-court-runoff').userData.surface, 'clay');
  assert.equal(wtaScene.getObjectByName('wtsl-court-playing-surface').userData.surface, 'clay');
  assert.equal(wtaScene.getObjectByName('wtsl-net-tour-mark').userData.tour, 'WTA');
  assert.equal(wtaScene.getObjectByName('wtsl-net-tour-accent').userData.tour, 'WTA');

  const atpScene = new THREE.Scene();
  sceneApi.buildCourt(atpScene, 'hard', false);
  assert.equal(atpScene.getObjectByName('wtsl-net-tour-mark').userData.tour, 'ATP');
  assert.notEqual(
    atpScene.getObjectByName('wtsl-net-tour-accent').material.color.getHex(),
    wtaScene.getObjectByName('wtsl-net-tour-accent').material.color.getHex(),
  );

  const stadiumSource = await readFile(new URL('../lib/liveCourtStadium.ts', import.meta.url), 'utf8');
  const canvasSource = await readFile(new URL('../components/DmoLiveCourt.tsx', import.meta.url), 'utf8');
  const threeSource = await readFile(new URL('../components/DmoLiveCourt3D.tsx', import.meta.url), 'utf8');
  assert.match(stadiumSource, /palette\.runoff/);
  assert.match(stadiumSource, /isWta \? '#bd2f68' : '#2878aa'/);
  assert.match(canvasSource, /drawLiveCourtBackdrop\(context, surface, camera, zoom, stadiumAtmosphere, isWta\)/);
  assert.match(threeSource, /sceneDataRef\.current\.isWta/);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as THREE from 'three';
import { BVHLoader } from 'three/examples/jsm/loaders/BVHLoader.js';
import * as dmoCharacterAppearance from '../lib/dmoCharacterAppearance.mjs';
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
const crowdBrandingApi = await loadTs('../lib/dmoCrowdBranding.ts');
const courtSurfaceApi = await loadTs('../lib/te4DmoSurface.ts');
const crowdDensityApi = await loadTs('../lib/dmoCrowdDensity.ts');
const sceneApi = await loadTs('../components/DmoLiveCourt3DScene.ts', {
  './DmoStadiumArchitecture': stadiumArchitectureApi,
  '../lib/dmoVenue': venueApi,
  '@/lib/te4DmoSurface': courtSurfaceApi,
  '@/lib/dmoCrowdDensity': crowdDensityApi,
  '@/lib/dmoCharacterAppearance.mjs': dmoCharacterAppearance,
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
const liveDmoUmpireScoreSourceApi = await loadTs('../lib/liveDmoUmpireScoreSource.ts');

function assertNetMeshIsNeutral(scene, label) {
  const mesh = scene.getObjectByName('wtsl-net-mesh');
  assert.ok(mesh, `${label}: the court net mesh exists`);
  const hex = mesh.material.color.getHex();
  const channels = [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
  assert.ok(
    Math.max(...channels) - Math.min(...channels) <= 12,
    `${label}: net wires should be neutral gray, not green`,
  );
  assert.ok(Math.min(...channels) >= 100, `${label}: net wires remain visible, not near-black`);
  assert.ok(mesh.material.opacity <= 0.85, `${label}: the weave stays translucent at court view`);
}

test('an unsupported umpire call cannot cancel a supported score in progress', async () => {
  const cancelled = [];
  const api = await loadTs('../lib/liveCourtUmpire.ts', {
    './xktUmpireAudio': {
      playXktUmpireCall: async (_context, text) => text !== 'Missing clip',
      cancelXktUmpireCalls: context => cancelled.push(context),
    },
  });
  const context = { state: 'running' };
  assert.equal(await api.speakUmpireCall('fifteen-love', context, false), true);
  assert.equal(await api.speakUmpireCall('Out', context, false), true);
  assert.equal(await api.speakUmpireCall('Missing clip', context, false), false);
  assert.equal(cancelled.length, 0);
  api.cancelUmpireCall(context);
  assert.ok(cancelled.length > 0, 'explicit mute still cancels the active voice');
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

test('tournament and venue metadata resolve city lettering across the tour calendar', async () => {
  const cityCases = [
    ['Vienna', 'VIENNA'],
    ['Erste Bank Open', 'VIENNA'],
    ['Wiener Stadthalle', 'VIENNA'],
    ['Miami Open', 'MIAMI'],
    ['Roland Garros', 'PARIS'],
    ['Wimbledon Centre Court', 'LONDON'],
    ['Arthur Ashe Stadium', 'NEW YORK'],
    ['ATP Doha', 'DOHA'],
    ['Mutua Madrid Open', 'MADRID'],
    ['Internazionali d’Italia', 'ROME'],
    ['Barcelona Open', 'BARCELONA'],
    ['BMW Open Munich', 'MUNICH'],
    ['Mallorca Championships', 'SANTA PONSA'],
    ['Surbiton Trophy', 'SURBITON'],
    ['Libema Open', 'DEN BOSCH'],
    ['China Open Beijing', 'BEIJING'],
    ['WTA Finals Riyadh', 'RIYADH'],
    ['A made-up tennis venue', undefined],
    [null, undefined],
  ];
  for (const [venue, expectedCity] of cityCases) {
    assert.equal(venueApi.resolveDmoVenueProfile(venue).cityLabel, expectedCity, String(venue));
  }
  assert.equal(venueApi.resolveDmoVenueProfile('A made-up tennis venue').cityLabel, undefined,
    'unknown venue metadata must not invent a city label');
  const sceneSource = await readFile(new URL('../components/DmoLiveCourt3DScene.ts', import.meta.url), 'utf8');
  assert.match(sceneSource, /venue\.cityLabel && typeof document !== 'undefined'/);
  assert.match(sceneSource, /wtsl-court-city-label/);
  assert.match(sceneSource, /context\.fillText\(venue\.cityLabel/);
  const liveCourtSource = await readFile(new URL('../components/DmoLiveCourt3D.tsx', import.meta.url), 'utf8');
  assert.match(liveCourtSource, /sceneDataRef\.current\.snapshot\.stadium,\s*\n\s*\);/);
});

test('selected fan banners use the WTSL/ACE identity and a sparse original mascot mark', async () => {
  assert.deepEqual(
    Array.from({ length: 6 }, (_, index) => crowdBrandingApi.getCrowdBannerBranding(index)),
    [
      { label: 'ACE', mascot: 'rally-fox' },
      { label: 'WTSL', mascot: null },
      { label: 'ACE', mascot: null },
      { label: 'WTSL', mascot: 'rally-fox' },
      { label: 'ACE', mascot: null },
      { label: 'WTSL', mascot: null },
    ],
  );
  const crowdSource = await readFile(new URL('../components/DmoHumanCrowd.ts', import.meta.url), 'utf8');
  assert.match(crowdSource, /getCrowdBannerBranding\(index\)/);
  assert.match(crowdSource, /wtsl-fan-banner-panel/);
  assert.match(crowdSource, /banner\.userData\.mascot = branding\.mascot/);
  assert.match(crowdSource, /context\.translate\(canvas\.width \/ 2, 74\)/);
});

test('court lettering spans both baselines, faces play, and stays outside the lines', () => {
  const originalDocument = globalThis.document;
  const printed = [];
  const noop = () => {};
  const context = new Proxy({
    fillText: text => printed.push(text),
    createLinearGradient: () => ({ addColorStop: noop }),
  }, { get: (target, key) => target[key] ?? noop });
  globalThis.document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  };
  try {
    for (const [surface, venue, city] of [
      ['hard', 'Paris Masters', 'PARIS'],
      ['clay', 'Roland Garros', 'PARIS'],
      ['grass', 'Wimbledon', 'LONDON'],
      ['hard', 'Vienna', 'VIENNA'],
      ['hard', 'Doha', 'DOHA'],
    ]) {
      const scene = new THREE.Scene();
      sceneApi.buildCourt(scene, surface, false, venue);
      scene.updateMatrixWorld(true);
      const labels = scene.children.filter(object => object.name === 'wtsl-court-city-label');
      assert.equal(labels.length, 2);
      assert.deepEqual(labels.map(label => Math.sign(label.position.x)), [-1, 1]);
      for (const label of labels) {
        assert.equal(label.userData.cityLabel, city);
        const bounds = new THREE.Box3().setFromObject(label);
        assert.ok(bounds.max.x < -sceneApi.COURT_LENGTH / 2 || bounds.min.x > sceneApi.COURT_LENGTH / 2);
        assert.ok(bounds.min.x >= -21 && bounds.max.x <= 21 && bounds.min.z >= -11 && bounds.max.z <= 11);
        const widthDirection = new THREE.Vector3(1, 0, 0).applyQuaternion(label.quaternion);
        assert.ok(Math.abs(widthDirection.z) > 0.99, 'the word spans the baseline width');
        const letterTop = new THREE.Vector3(0, 1, 0).applyQuaternion(label.quaternion);
        assert.ok(letterTop.x * label.position.x < 0, 'letter tops point toward the court');
      }
    }
    const unknown = new THREE.Scene();
    sceneApi.buildCourt(unknown, 'hard', true, 'Unmapped venue');
    assert.equal(unknown.children.filter(object => object.name === 'wtsl-court-city-label').length, 0);
    assert.ok(printed.includes('PARIS'));
    assert.ok(printed.includes('LONDON'));
    assert.ok(printed.includes('VIENNA'));
    assert.ok(printed.includes('DOHA'));
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test('the real crowd rig forwards the active camera to the detailed renderer', () => {
  const crowd = sceneApi.buildCrowd(new THREE.Scene());
  const camera = new THREE.PerspectiveCamera();
  const ball = new THREE.Vector3(1, 2, 3);
  let received;
  crowd.replacePeople((...args) => { received = args; });
  crowd.update(1, true, ball, camera);
  assert.deepEqual(received, [1, true, ball, camera]);
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

test('rally contacts at or above 2.2 m select a smash anywhere on court', () => {
  const event = { frame: 60, kind: 'shot', shotType: 'rally', player: 1 };
  const contact = [1100, 0, 220, 1100, 0, -900, 0];
  assert.equal(smashApi.isCapturedSmashShot(event, contact), true,
    'the exact height threshold qualifies at the baseline');
  assert.equal(smashApi.isCapturedSmashShot({ ...event, player: 2 }, contact), true,
    'either player may use the overhead');
  assert.equal(smashApi.isCapturedSmashShot(event, [...contact.slice(0, 2), 500, ...contact.slice(3)]), true,
    'higher contacts also qualify without inspecting the incoming flight or bounce');
  assert.equal(smashApi.isCapturedSmashShot(event, [...contact.slice(0, 2), 219, ...contact.slice(3)]), false);
});

test('smash selection excludes serves and invalid contacts', () => {
  const event = { frame: 60, kind: 'shot', shotType: 'rally', player: 1 };
  const contact = [0, 0, 250, 300, 0, -900, 0];
  assert.equal(smashApi.isCapturedSmashShot({ ...event, shotType: 'serve' }, contact), false);
  assert.equal(smashApi.isCapturedSmashShot({ ...event, kind: 'point-end' }, contact), false);
  assert.equal(smashApi.isCapturedSmashShot(undefined, contact), false);
  assert.equal(smashApi.isCapturedSmashShot({ ...event, player: undefined }, contact), false);
  assert.equal(smashApi.isCapturedSmashShot(event, null), false);
  assert.equal(smashApi.isCapturedSmashShot(event, [0, 0, Number.NaN, 0, 0, 0, 0]), false);
});

test('the Jarua smash is loadable and the existing Adorozco capture remains', async () => {
  const motion = await readFile(new URL('../public/models/dmo-humans/tennis-smash-jarua.bvh', import.meta.url), 'utf8');
  const parsed = new BVHLoader().parse(motion);
  assert.ok(parsed.clip.duration > 7.6, 'the selected contact frame is in the recording');
  assert.ok(parsed.skeleton.bones.some((bone) => bone.name === 'RightWrist'));
  const manifest = JSON.parse(await readFile(
    new URL('../public/models/dmo-humans/provenance.json', import.meta.url), 'utf8',
  ));
  const provenance = manifest.find((entry) => entry.filename === 'tennis-smash-jarua.bvh');
  assert.equal(provenance.bytes, Buffer.byteLength(motion));
  assert.equal(provenance.license, 'CC-BY-SA-3.0');
  assert.match(provenance.source, /jarua_Remate\.bvh/);
  assert.equal((await readFile(
    new URL('../public/models/dmo-humans/tennis-smash.bvh', import.meta.url),
  )).byteLength, 854760, 'the older Adorozco recording stays untouched');
  const credit = await readFile(
    new URL('../public/models/dmo-humans/SMASH-MOCAP-CREDIT.md', import.meta.url), 'utf8',
  );
  assert.match(credit, /tennis-smash\.bvh/);
  assert.match(credit, /tennis-smash-jarua\.bvh/);
  assert.match(credit, /CC BY-SA 3\.0/);
});

test('the optional Jarua smash is loaded by both player variants and selected for high rallies', async () => {
  const [modelSource, rigSource, currentPlayerSource, claudePlayerSource, courtSource] = await Promise.all([
    readFile(new URL('../components/DmoHumanModels.ts', import.meta.url), 'utf8'),
    readFile(new URL('../components/DmoCapturedGroundstroke.ts', import.meta.url), 'utf8'),
    readFile(new URL('../components/DmoNativePlayer.ts', import.meta.url), 'utf8'),
    readFile(new URL('../components/DmoNativePlayerClaude.ts', import.meta.url), 'utf8'),
    readFile(new URL('../components/DmoLiveCourt3D.tsx', import.meta.url), 'utf8'),
  ]);
  assert.match(modelSource, /tennis-smash-jarua\.bvh/);
  assert.match(modelSource, /loadSmash/);
  assert.match(rigSource, /if \(sources\.smash\)/);
  assert.match(rigSource, /get hasSmash\(\)/);
  assert.match(currentPlayerSource, /capturedSmash = capturedGroundstroke\.hasSmash/);
  assert.match(claudePlayerSource, /capturedSmash = capturedGroundstroke\.hasSmash/);
  assert.match(courtSource, /isCapturedSmashShot\(strokeEvent, contactSample\)/);
  assert.match(courtSource, /recordedSmash \? 'forehand' : stroke/);
  assert.match(courtSource, /\.\.\.\(recordedSmash \? \{ smash: true \} : \{\}\)/);
  assert.match(courtSource, /!capturedEvent\.smash && contactSample/);
  assert.match(courtSource, /hands: !capturedEvent\.smash/);
  assert.ok(courtSource.indexOf('const strokeEvent =') < courtSource.indexOf('const crouch ='),
    'the selected lead/contact event determines whether crouch is suppressed');
  assert.match(courtSource, /const crouch = suppressSmashCrouch \? 0/);
  assert.match(courtSource, /lowReachFull = capturedEvent\.smash\s*\?\s*0/);
});

test('live scoreboard sits below the court and both win estimates remain distinct', async () => {
  const [displaySource, viewerSource, styles] = await Promise.all([
    readFile(new URL('../components/DmoLiveDisplay.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../components/DmoLiveViewer.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../components/DmoLiveDisplay.module.css', import.meta.url), 'utf8'),
  ]);
  const stageStart = displaySource.indexOf('<div className={styles.liveCourtStage}>');
  const scoreboard = displaySource.indexOf('<aside className={styles.scoreBug}');
  assert.ok(stageStart >= 0 && scoreboard > stageStart);
  assert.ok(displaySource.slice(stageStart, scoreboard).trimEnd().endsWith('</div>'),
    'the court stage closes before the scoreboard markup');
  assert.match(displaySource, /LIVE WIN CHANCE/);
  assert.match(displaySource, /<strong>PRE-MATCH<\/strong>/);
  assert.match(displaySource, /preMatchStatus === 'loading'/);
  assert.match(viewerSource, /setPreMatchStatuses/);
  assert.match(viewerSource, /'unavailable'/);
  assert.doesNotMatch(styles, /\.scoreBug\s*\{[^}]*position:\s*absolute/s);
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
    assert.ok(bowl?.isMesh, 'one uninterrupted bowl surface carries the full seating rake');
    assert.equal(bowl.geometry.userData.continuousPerimeter, true);
    assert.equal(bowl.geometry.userData.inwardFacing, true);
    assert.equal(bowl.geometry.userData.rows, 18, 'the bowl continues well above the sparse detailed crowd');
    assert.equal(bowl.geometry.userData.tiers, 3);
    assert.equal(bowl.geometry.userData.sectionAisleCount, 16);
    assert.equal(bowl.geometry.userData.passageGaps, 4);
    const exteriorWall = named(superstructure, 'wtsl-stadium-exterior-wall-shell')[0];
    assert.equal(exteriorWall.material.side, THREE.DoubleSide, 'the full-height outer wall seals from either face');
    assert.equal(exteriorWall.material.depthWrite, true);
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
    assert.equal(seats.userData.sectionAisleCount, 16);
    assert.equal(seats.userData.passageGaps, 4);
    const stairs = named(superstructure, 'wtsl-stadium-section-stair-treads')[0];
    assert.ok(stairs?.isInstancedMesh);
    assert.equal(stairs.count, 18 * 16, 'stair treads repeat through every seating row and tier');
    assert.equal(stairs.userData.alignedWithSeatGaps, true);
    assert.equal(stairs.userData.continuousThroughTiers, true);
    const stairPosition = new THREE.Vector3();
    const stairMatrix = new THREE.Matrix4();
    for (let index = 0; index < stairs.count; index += 1) {
      stairs.getMatrixAt(index, stairMatrix);
      stairPosition.setFromMatrixPosition(stairMatrix);
      assert.equal(stadiumArchitectureApi.isUpperBowlSectionAisle(stairPosition.x, stairPosition.z), true,
        'seat-row treads land in the matching radial section gap');
    }
    const concourseStairs = named(superstructure, 'wtsl-stadium-concourse-stair-treads')[0];
    assert.ok(concourseStairs?.isInstancedMesh);
    assert.equal(concourseStairs.count, 2 * 16 * 4,
      'stair aisles bridge both horizontal concourse level transitions');
    assert.equal(concourseStairs.userData.alignedWithSectionStairs, true);
    for (let index = 0; index < concourseStairs.count; index += 1) {
      concourseStairs.getMatrixAt(index, stairMatrix);
      stairPosition.setFromMatrixPosition(stairMatrix);
      assert.equal(stadiumArchitectureApi.isUpperBowlSectionAisle(stairPosition.x, stairPosition.z), true,
        'concourse transition treads continue through the same radial aisle');
    }
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
      if (
        /retaining|riser|seat-cap|stadium-rib/i.test(object.name)
        && !/stadium-(?:section|concourse)-stair-risers/i.test(object.name)
      ) blockingArchitecture.push(object.name);
    });
    assert.deepEqual(blockingArchitecture, [],
      'stair risers stay in passageways, not in the court sightline');
    assert.equal(named(superstructure, 'wtsl-advertising-board-baseline').length, 4);
    assert.equal(named(superstructure, 'wtsl-advertising-board-sideline').length, 4);
    assert.equal(named(superstructure, 'wtsl-scoreboard-screen').length, 2);
    assert.equal(named(superstructure, 'wtsl-scoreboard-frame').length, 2);
    const concourses = named(superstructure, 'wtsl-stadium-concourse');
    assert.equal(concourses.length, 2);
    assert.ok(concourses.every((walkway) => walkway.userData.amenities.includes('concessions')
      && walkway.userData.amenities.includes('restrooms')));
    const suiteFronts = named(superstructure, 'wtsl-stadium-suite-front');
    const suiteWindows = named(superstructure, 'wtsl-stadium-suite-window');
    assert.equal(suiteFronts.length, 2);
    assert.equal(suiteWindows.length, 2);
    assert.ok(suiteFronts.every((front) => front.isInstancedMesh
      && front.userData.concourseBand === true
      && front.userData.suiteCount === front.count
      && front.count > 32
      && front.count < 48), 'suite fronts avoid the main tunnels and stair aisles');
    assert.ok(suiteWindows.every((front, index) => front.isInstancedMesh
      && front.userData.integratedWith === 'concourse'
      && front.count === suiteFronts[index].count), 'visible booth glazing repeats across both concourses');
    const suitePosition = new THREE.Vector3();
    const suiteMatrix = new THREE.Matrix4();
    for (const front of suiteFronts) {
      for (let index = 0; index < front.count; index += 1) {
        front.getMatrixAt(index, suiteMatrix);
        suitePosition.setFromMatrixPosition(suiteMatrix);
        assert.equal(stadiumArchitectureApi.isUpperBowlAccessGap(suitePosition.x, suitePosition.z), false,
          'suite fronts do not block tunnel passages or section stairs');
      }
    }
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
    assert.equal(named(superstructure, 'wtsl-stadium-support-columns').length, 0);
    assert.equal(named(superstructure, 'wtsl-open-air-canopy').length, 0);
    assert.equal(named(superstructure, 'wtsl-indoor-roof-wing').length, 0);
    assert.equal(Boolean(scene.getObjectByName('wtsl-open-sky')), false);
    assert.equal(Boolean(scene.getObjectByName('wtsl-indoor-ceiling')), indoor);
    assert.equal(stadium.children.some(child => /roof|shell|facade|exterior/i.test(child.name)), false);
  }
});

test('seat and concourse stairways close sightline gaps to the exterior', () => {
  const scene = new THREE.Scene();
  sceneApi.buildStadiumEnvironment(scene, false, undefined, 'Roland Garros');
  const sectionTreads = scene.getObjectByName('wtsl-stadium-section-stair-treads');
  const sectionRisers = scene.getObjectByName('wtsl-stadium-section-stair-risers');
  const concourseTreads = scene.getObjectByName('wtsl-stadium-concourse-stair-treads');
  const concourseRisers = scene.getObjectByName('wtsl-stadium-concourse-stair-risers');
  assert.ok(sectionTreads && sectionRisers);
  assert.ok(concourseTreads && concourseRisers);
  assert.equal(sectionRisers.count,
    (sectionTreads.userData.rowsPerAisle - 1) * sectionTreads.userData.sectionAisleCount);
  assert.equal(sectionRisers.userData.backedByExterior, true);
  assert.equal(concourseRisers.count,
    concourseTreads.userData.transitionCount * concourseTreads.userData.sectionAisleCount
      * (concourseTreads.userData.stepsPerTransition - 1));
  assert.equal(concourseRisers.userData.backedByExterior, true);
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
  assert.match(court, /snapshot\.stadium,\s*\]\)/);
  assert.doesNotMatch(court, /player repair r19|RENDERER_BUILD|Renderer build|buildTag/);
  assert.doesNotMatch(court, /player repair r14|recorded volleys \+/);
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
  assert.match(court, /dmoOrbitSettings\(window\.matchMedia\('\(pointer: coarse\)'\)\.matches\)/);
  assert.match(court, /constrainDmoOrbit\(/);
  assert.match(court, /controls\.touches\.ONE = THREE\.TOUCH\.ROTATE/);
  assert.match(court, /controls\.touches\.TWO = THREE\.TOUCH\.DOLLY_PAN/);
  assert.match(court, /camera\.fov = view === 'aerial'\s*\? 50/);
  assert.match(viewer, /previousSnapshot\.stadium === nextSnapshot\.stadium/);
});

test('stadium metadata refreshes when generic venue lettering resolves to another city', () => {
  const scene = new THREE.Scene();
  sceneApi.buildStadiumEnvironment(scene, false, undefined, 'Vienna');
  const viennaStadium = scene.getObjectByName('wtsl-stadium-architecture');
  assert.equal(viennaStadium.userData.cityLabel, 'VIENNA');
  assert.equal(scene.userData.wtslStadiumVenue, 'Unspecified tennis venue:VIENNA');

  sceneApi.buildStadiumEnvironment(scene, false, undefined, 'Doha');
  const dohaStadium = scene.getObjectByName('wtsl-stadium-architecture');
  assert.notEqual(dohaStadium, viennaStadium);
  assert.equal(dohaStadium.userData.cityLabel, 'DOHA');
  assert.equal(scene.userData.wtslStadiumVenue, 'Unspecified tennis venue:DOHA');
});

test('player-grade crowd models cover every seat in the nearest two rows', () => {
  for (const genderIndex of [0, 1]) {
    const selected = Array.from({ length: 2 * 10_000 }, (_, index) => index)
      .filter((index) => crowdLodApi.shouldUseHighDetailCrowdSeat(Math.floor(index / 10_000), index, genderIndex));
    assert.equal(selected.length, 10_000);
    assert.ok(selected.every((index) => index % 2 === genderIndex));
    assert.ok(selected.every((index) => Math.floor(index / 10_000) < crowdLodApi.HIGH_DETAIL_CROWD_ROW_LIMIT));
    assert.equal(crowdLodApi.shouldUseHighDetailCrowdSeat(2, 20_000, genderIndex), false,
      'high-detail meshes stay limited to the nearest two crowd rows for mobile performance');
  }
});

test('nearby spectators use the approved complete models while staff keep their separate rig', async () => {
  const [courtSource, crowdProvenanceText] = await Promise.all([
    readFile(new URL('../components/DmoLiveCourt3D.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../public/models/dmo-humans/provenance.json', import.meta.url), 'utf8'),
  ]);
  assert.match(courtSource, /loadHumanModel\('male', 'crowd-high'/);
  assert.match(courtSource, /loadHumanModel\('female', 'crowd-high'/);
  assert.doesNotMatch(courtSource, /createNativeFaceSet|nativeFaces/);
  assert.match(courtSource, /loadSpectatorModel\('male', 'far'/);
  assert.match(courtSource, /loadSpectatorModel\('female', 'far'/);
  assert.match(courtSource, /loadSpectatorModel\('male', 'full'/);
  assert.match(courtSource, /loadSpectatorModel\('female', 'full'/);
  assert.match(courtSource, /attachSpectatorCrowd\(scene, crowdRig, crowdTemplates\)/);
  assert.match(courtSource, /crowdRig\.setHighDetailModel\(maleHighDetailCrowd\.value, 0\)/);
  assert.match(courtSource, /crowdRig\.setHighDetailModel\(femaleHighDetailCrowd\.value, 1\)/);
  assert.match(courtSource, /attachHumanCourtStaff\(scene, fixtureRig, \[male, female\], crowdRig, male\)/);

  const provenance = JSON.parse(crowdProvenanceText);
  assert.notEqual(
    provenance.find(asset => asset.filename === 'male-crowd.glb').sourceSha256,
    provenance.find(asset => asset.filename === 'female-crowd.glb').sourceSha256,
    'the two genders must not point to the same source model',
  );
  for (const gender of ['male', 'female']) {
    const player = provenance.find((asset) => asset.filename === `${gender}-player.glb`);
    const crowd = provenance.find((asset) => asset.filename === `${gender}-crowd.glb`);
    assert.ok(player && crowd, `${gender} player and crowd assets are registered`);
    assert.equal(player.sourceSha256, crowd.sourceSha256, `${gender} models share the same face source`);
    assert.ok(player.triangles >= crowd.triangles * 7, `${gender} player-grade mesh has substantially more detail`);
  }
});

test('continuous crowd seats include narrow stairs aligned to the four tunnel entrances', () => {
  const scene = new THREE.Scene();
  sceneApi.buildStadiumEnvironment(scene);
  const crowd = sceneApi.buildCrowd(scene);
  assert.ok(crowd.seats.length > 4_800, 'detailed crowd seats continue through every stadium tier');
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
    assert.ok(upperRow.every((seat) => Math.abs(seat.x) >= 0.82 && Math.abs(seat.z) >= 0.82),
      'upper tiers clear the narrow stair aisles, not a five-metre void');
  }
  const nearSeats = crowd.seats.filter((seat) => seat.row < 4);
  const nearSupports = scene.getObjectByName('wtsl-near-court-seating-supports');
  assert.ok(nearSupports?.isInstancedMesh);
  assert.equal(nearSupports.count, 32, 'each lower row has narrow supports beneath its four seating sides');
  assert.equal(nearSupports.userData.style, 'narrow-beams');
  assert.equal(nearSupports.userData.accessPassages, 4, 'the stair aisles align to four ground-level tunnel entrances');
  assert.equal(nearSupports.userData.stairAisleWidth, 1.64);
  assert.equal(nearSupports.userData.tunnelMouthWidth, 5);
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
  assert.ok(sidelineSeats.every((seat) => Math.abs(seat.x) >= 0.82),
    'the two sideline stair aisles remain clear through the lower crowd');
  assert.ok(baselineSeats.every((seat) => Math.abs(seat.z) >= 0.82),
    'the two baseline stair aisles remain clear through the lower crowd');
  assert.ok(nearSeats.some((seat) => seat.row === 0 && Math.abs(seat.x) >= 1.2
    && Math.abs(seat.x) < 1.6 && Math.abs(seat.z) === 12),
  'lower-row spectators fill the excess empty width beside the entrance stairs');
  const lowerTreads = scene.getObjectByName('wtsl-lower-section-stair-treads');
  const lowerRisers = scene.getObjectByName('wtsl-lower-section-stair-risers');
  assert.ok(lowerTreads?.isInstancedMesh && lowerRisers?.isInstancedMesh);
  assert.equal(lowerTreads.count, 36);
  assert.equal(lowerRisers.count, lowerTreads.count);
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
  const concourseWidth = 2.15, tierRows = 6, baseY = 2.7;
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
      const angle = (index / count) * Math.PI * 2;
      const expectedX = Math.cos(angle) * ellipseX;
      const expectedZ = Math.sin(angle) * ellipseZ;
      if (stadiumArchitectureApi.isUpperBowlAccessGap(expectedX, expectedZ)) continue;
      architectureSeats.getMatrixAt(sourceOffset + expected.length, matrix);
      matrix.decompose(position, rotation, scale);
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
    sourceOffset += expected.length;
  }
  const upperCrowd = crowd.seats.filter((seat) => seat.row >= 4);
  assert.ok(upperCrowd.every((seat) => !stadiumArchitectureApi.isUpperBowlAccessGap(seat.x, seat.z)),
    'animated crowd anchors leave every section stair and tunnel-aligned aisle open');
  for (let aisle = 0; aisle < stadiumArchitectureApi.UPPER_BOWL_AISLE_COUNT; aisle += 1) {
    const angle = (aisle / stadiumArchitectureApi.UPPER_BOWL_AISLE_COUNT) * Math.PI * 2;
    const sampleRadius = 40;
    assert.ok(stadiumArchitectureApi.isUpperBowlSectionAisle(
      Math.cos(angle) * sampleRadius,
      Math.sin(angle) * sampleRadius,
    ), `aisle ${aisle} stays aligned along the rake`);
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
  assert.match(humanCrowdSource, /attachStaffModel\(\s*chair,\s*detailedUmpireTemplate,\s*'wtsl-detailed-umpire',\s*0x38536a,\s*1\.34,\s*true,/,
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
    assert.equal(rig.root.scale.y, isWta ? 0.91 : 0.95,
      'WTA players should be slightly shorter than the standard player rig');
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
    assert.equal(headNames.some(name => /anime|spike/i.test(name)), false,
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
      const skirt = rig.hip.getObjectByName('tennis-skirt');
      assert.ok(skirt);
      skirt.geometry.computeBoundingBox();
      assert.ok(skirt.geometry.boundingBox.min.y > -0.11, 'WTA skirt hem sits higher on the thigh');
      assert.equal(rig.hip.scale.x, 1.14, 'WTA hips should be fuller than the standard rig');
      const ponytail = rig.root.getObjectByName('wta-long-ponytail');
      assert.ok(ponytail);
      ponytail.geometry.computeBoundingBox();
      assert.ok(
        ponytail.geometry.boundingBox.max.z < -0.06,
        'long hair stays behind the head instead of draping beside the face',
      );
      assert.equal(rig.head.children.some(child => child.name.startsWith('wta-front-lock-')), false);
      assert.ok(rig.root.getObjectByName('wta-blush-left'));
      assert.ok(rig.root.getObjectByName('wta-earring-left'));
      assert.ok(rig.root.getObjectByName('wta-lip-tint'));
      const sleeve = rig.root.getObjectByName('wta-cap-sleeve');
      assert.ok(sleeve);
      sleeve.geometry.computeBoundingBox();
      assert.ok(sleeve.geometry.boundingBox.max.y - sleeve.geometry.boundingBox.min.y < 0.31,
        'WTA tops use short cap sleeves');
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
  assert.equal(new Set(appearances.map((look) => look.wardrobe)).size, 8,
    'detailed spectators use eight varied outfit and skin-tone looks');
  const seatedLegs = sceneApi.getSeatedCrowdLegTargets(1);
  assert.ok(Math.hypot(
    seatedLegs.knee[0] - seatedLegs.ankle[0],
    seatedLegs.knee[1] - seatedLegs.ankle[1],
    seatedLegs.knee[2] - seatedLegs.ankle[2],
  ) < 0.3, 'seated lower legs stay compact instead of hanging at standing length');
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
    assert.ok(thigh > 0.28 && thigh < 0.33, `compact seated thigh ${thigh}`);
    assert.ok(shin > 0.25 && shin < 0.30, `compact seated shin ${shin}`);
    assert.ok(kneeAngle > 1.25 && kneeAngle < 1.75, `near-right-angle seated knee ${kneeAngle}`);
    assert.ok(toePoint.y - barTop > 0.02 && toePoint.y - barTop < 0.04,
      'the toe joint leaves room for the sole above the foot bar');
    assert.ok(anklePoint.distanceTo(toePoint) < 0.15,
      'the foot is not stretched into another long leg segment');
    assert.ok(hipPoint.y - toePoint.y < 0.4, 'the legs stay tucked immediately below the seat');
    assert.ok(toePoint.z > anklePoint.z, 'the foot points forward onto the support bar');
  }
  assert.ok(seat.position.y < 1.4 && footBar.position.y > 0.86 && footBar.position.y < 0.92,
    'the seated foot bar stays near the chair rungs instead of below the official');
});

test('seated crowd and coach legs stay compact and within the seat-to-step reach', () => {
  const distance = (from, to) => new THREE.Vector3(...from).distanceTo(new THREE.Vector3(...to));
  for (const side of [-1, 1]) {
    const crowd = sceneApi.getSeatedCrowdLegTargets(side);
    assert.ok(distance(crowd.hip, crowd.knee) < 0.24, 'crowd thighs stay tucked close to the seat');
    assert.ok(distance(crowd.knee, crowd.ankle) < 0.25, 'crowd shins stay compact above the step');
    assert.ok(crowd.hip[1] - crowd.toe[1] < 0.45, 'crowd feet do not hang far below the seated hips');
    assert.ok(crowd.toe[1] < crowd.ankle[1] && crowd.toe[2] > crowd.ankle[2]);

    const coach = sceneApi.getSeatedCoachLegTargets(side, 0.4);
    assert.ok(distance(coach.hip, coach.knee) > 0.24 && distance(coach.hip, coach.knee) < 0.29);
    assert.ok(distance(coach.knee, coach.ankle) > 0.25 && distance(coach.knee, coach.ankle) < 0.29);
    assert.ok(coach.hip[1] - coach.toe[1] < 0.4,
      'front-row coaches cannot retain standing-length legs while the ordinary crowd is compact');
    assert.ok(coach.toe[1] >= 0, 'coach toe joints stay above their own row floor');
    assert.ok(distance(coach.ankle, coach.toe) < 0.15);
  }
});

test('venue modes retain the same enclosed bowl without adding exterior landscape', () => {
  const outdoor = new THREE.Scene();
  sceneApi.buildStadiumEnvironment(outdoor, false);
  assert.equal(outdoor.getObjectByName('wtsl-open-sky'), undefined,
    'the stadium builder leaves broadcast sky and weather to the time-of-day lighting controller');
  assert.ok(outdoor.children.some(item => item.isLight)
    || outdoor.getObjectByName('wtsl-stadium-architecture')?.children.some(item => item.isLight));
  assert.equal(isIndoorDmoVenue('Paris-Bercy'), true);
  assert.equal(isIndoorDmoVenue('Philippe Chatrier'), false);
  const indoor = new THREE.Scene();
  sceneApi.buildStadiumEnvironment(indoor, true);
  assert.equal(indoor.getObjectByName('wtsl-open-sky'), undefined,
    'indoor venues keep the same enclosed bowl');
  assert.ok(indoor.getObjectByName('wtsl-indoor-ceiling'));
  assert.ok(indoor.getObjectByName('wtsl-continuous-seating-bowl'));
  assert.ok(outdoor.getObjectByName('wtsl-continuous-seating-bowl'));
});

test('Basel and Vienna indoor aliases get an underside-only ceiling within the bowl', () => {
  for (const name of ['Basel', 'Vienna', 'Basel_2026_TE4', 'Wiener Stadthalle', 'Swiss Indoors', 'Erste-Bank-Open']) {
    assert.equal(isIndoorDmoVenue(name), true, name);
    const scene = new THREE.Scene();
    sceneApi.buildStadiumEnvironment(scene, isIndoorDmoVenue(name), undefined, name);
    scene.updateMatrixWorld(true);
    const ceiling = scene.getObjectByName('wtsl-indoor-ceiling');
    const panel = scene.getObjectByName('wtsl-indoor-ceiling-panel');
    const fascia = scene.getObjectByName('wtsl-indoor-upper-bowl-fascia');
    const walls = scene.getObjectByName('wtsl-stadium-exterior-walls');
    const wallShell = scene.getObjectByName('wtsl-stadium-exterior-wall-shell');
    assert.equal(ceiling.userData.passThrough, true);
    assert.equal(walls.userData.openSky, false);
    assert.ok(wallShell?.isMesh, 'the crowd gaps have an enclosing stadium wall behind them');
    assert.equal(panel.material.side, THREE.BackSide);
    const below = new THREE.Raycaster(new THREE.Vector3(0, 1.6, 0), new THREE.Vector3(0, 1, 0));
    const above = new THREE.Raycaster(new THREE.Vector3(0, ceiling.userData.height + 3, 0), new THREE.Vector3(0, -1, 0));
    assert.ok(below.intersectObject(panel).length > 0, 'court-level upward view sees a roof');
    assert.equal(above.intersectObject(panel).length, 0, 'above-ceiling camera sees through to the court');
    assert.equal(fascia.material.side, THREE.BackSide, 'no exterior wall is rendered');
    const bounds = new THREE.Box3().setFromObject(ceiling);
    const bowl = scene.getObjectByName('wtsl-continuous-seating-bowl');
    bowl.geometry.computeBoundingBox();
    assert.ok(bounds.max.x <= bowl.geometry.boundingBox.max.x + 0.01);
    assert.ok(bounds.max.z <= bowl.geometry.boundingBox.max.z + 0.01);
  }
  const scene = new THREE.Scene();
  sceneApi.buildStadiumEnvironment(scene, false, undefined, 'Roland Garros');
  assert.equal(scene.getObjectByName('wtsl-indoor-ceiling'), undefined, 'outdoors remains open overhead');
  const outdoorRim = scene.getObjectByName('wtsl-stadium-upper-rim');
  const outdoorWalls = scene.getObjectByName('wtsl-stadium-exterior-walls');
  const outdoorWall = scene.getObjectByName('wtsl-stadium-exterior-wall-shell');
  assert.ok(outdoorRim, 'outdoor seating has a clear structural edge against the sky');
  assert.equal(outdoorRim.userData.openSky, true, 'the rim frames the sky without a canopy');
  assert.equal(outdoorWalls.userData.openSky, true, 'outdoor walls close the bowl but leave the sky open above');
  const outdoorStructure = scene.getObjectByName('wtsl-stadium-superstructure');
  assert.ok(outdoorWalls.userData.lowerEdge <= -7.5,
    'the exterior backing extends below grade to stop low-angle sky leaks');
  assert.ok(outdoorWalls.userData.upperEdge >= outdoorStructure.userData.topStandHeight + 8,
    'the wall stands high enough to block sky through lower sections');
  assert.ok(scene.getObjectByName('wtsl-stadium-exterior-tier-course-1'));
  assert.ok(scene.getObjectByName('wtsl-stadium-exterior-tier-course-2'));
   assert.equal(outdoorWall.material.side, THREE.DoubleSide, 'the wall seals views from both sides');
  const outdoorBowl = scene.getObjectByName('wtsl-continuous-seating-bowl');
  outdoorBowl.geometry.computeBoundingBox();
  const wallsBounds = new THREE.Box3().setFromObject(outdoorWalls);
  assert.ok(wallsBounds.max.x <= outdoorBowl.geometry.boundingBox.max.x + 0.66);
  assert.ok(wallsBounds.max.z <= outdoorBowl.geometry.boundingBox.max.z + 0.66);
  const wallRay = new THREE.Raycaster(new THREE.Vector3(0, outdoorWalls.userData.upperEdge / 2, 0), new THREE.Vector3(1, 0, 0));
  assert.ok(wallRay.intersectObject(outdoorWall).length > 0, 'an interior view is backed by structure rather than open sky');
  const lowSightline = new THREE.Raycaster(
    new THREE.Vector3(0, 3, 0),
    new THREE.Vector3(0, -0.09, -1).normalize(),
  );
  assert.ok(lowSightline.intersectObject(outdoorWall).length > 0,
    'a downward sightline through low seating still meets the exterior wall');
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

test('automated Fault and Out calls use dedicated audio clips without loading umpire manifests', async () => {
  const requestedUrls = [];
  const startedSources = [];
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
      return { gain: { value: 0 }, connect() { return this; }, disconnect() {} };
    },
  };
  const fetcher = async (url) => {
    requestedUrls.push(url);
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(16) };
  };

  assert.equal(
    xktUmpireAudioApi.resolveAutomatedLineCallPath('Out', false, () => 0),
    '/audio/xkt/line-calls/atp-out-01.mp3',
  );
  assert.equal(
    xktUmpireAudioApi.resolveAutomatedLineCallPath('Out', false, () => 0.999),
    '/audio/xkt/line-calls/atp-out-09.mp3',
  );
  assert.equal(
    xktUmpireAudioApi.resolveAutomatedLineCallPath('Out', true, () => 0),
    '/audio/xkt/line-calls/atp-out-01.mp3',
    'WTA uses the approved recorded Out clips already used for ATP',
  );
  assert.equal(
    xktUmpireAudioApi.resolveAutomatedLineCallPath('Out', true, () => 0.999),
    '/audio/xkt/line-calls/atp-out-09.mp3',
    'the full shared Out clip set remains selectable for WTA',
  );
  assert.equal(
    xktUmpireAudioApi.resolveAutomatedLineCallPath('Fault', false),
    '/audio/xkt/line-calls/fault.mp3',
  );
  assert.equal(
    xktUmpireAudioApi.resolveAutomatedLineCallPath('Fault', true),
    '/audio/xkt/line-calls/fault.mp3',
  );

  for (const text of ['Fault', 'Out']) {
    assert.equal(await xktUmpireAudioApi.playXktUmpireCall(context, text, false, fetcher), true);
  }
  assert.equal(await xktUmpireAudioApi.playXktUmpireCall(context, 'Out', true, fetcher), true);
  const atpOutFiles = Array.from({ length: 9 }, (_, index) =>
    xktUmpireAudioApi.resolveAutomatedLineCallPath(
      'Out',
      false,
      () => (index + 0.5) / 9,
    ));
  assert.equal(new Set(atpOutFiles).size, 9, 'all distinct ATP clips are selectable');
  assert.ok(requestedUrls.includes('/audio/xkt/line-calls/fault.mp3'));
  assert.ok(requestedUrls.some(url => url.startsWith('/audio/xkt/line-calls/atp-out-')));
  assert.ok(!requestedUrls.includes('/audio/xkt/line-calls/out.mp3'),
    'the generated generic Out clip is never fetched');
  assert.ok(
    requestedUrls.every(url => url.startsWith('/audio/xkt/line-calls/')),
    'dedicated line calls do not fetch umpire manifests',
  );
  await xktUmpireAudioApi.preloadAutomatedLineCalls(context, fetcher);
  assert.ok(atpOutFiles.every(url => requestedUrls.includes(url)),
    'activation preloads every ATP variation, not only the generic out clip');
  for (const file of ['fault.mp3', ...atpOutFiles.map(url => url.split('/').at(-1))]) {
    const asset = await readFile(new URL(`../public/audio/xkt/line-calls/${file}`, import.meta.url));
    assert.ok(asset.byteLength > 5_000, `${file} is bundled as a real audio clip`);
  }
  assert.equal(startedSources.length, 1, 'later calls queue behind the first');
  startedSources[0].onended();
  assert.equal(startedSources.length, 2);
  startedSources[1].onended();
  assert.equal(startedSources.length, 3, 'the shared WTA Out clip plays after the queued ATP call');
  startedSources[2].onended();
  assert.equal(startedSources.length, 3);
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

test('raw DMO end markers cannot release a TE4 score unless the point scored', () => {
  const events = umpireApi.deriveUmpireCallEvents([
    { frame: 20, kind: 'point-end', scoreEligible: false },
    { frame: 40, kind: 'point-end' },
  ], [], []);
  assert.deepEqual(events, [{ frame: 40, kind: 'point-end', text: '' }]);
});

test('only ongoing automatic streams use TE4 scores in the live-window fallback', async () => {
  const viewer = await readFile(new URL('../components/DmoLiveViewer.tsx', import.meta.url), 'utf8');
  const display = await readFile(new URL('../components/DmoLiveDisplay.tsx', import.meta.url), 'utf8');

  assert.equal(
    liveDmoUmpireScoreSourceApi.resolveLiveDmoUmpireScoreSource('manual', false),
    'dmo',
  );
  assert.equal(
    liveDmoUmpireScoreSourceApi.resolveLiveDmoUmpireScoreSource('auto', false),
    'te4',
  );
  assert.equal(
    liveDmoUmpireScoreSourceApi.resolveLiveDmoUmpireFallbackScoreSource('auto', false),
    'te4',
    'an ongoing automatic stream uses the TE4 live score',
  );
  assert.equal(
    liveDmoUmpireScoreSourceApi.resolveLiveDmoUmpireFallbackScoreSource('auto', true),
    'dmo',
    'an automatic stream played as a historical DMO uses its recorded DMO score',
  );
  assert.equal(
    liveDmoUmpireScoreSourceApi.resolveLiveDmoUmpireFallbackScoreSource('manual', true),
    'dmo',
  );
  assert.equal(
    liveDmoUmpireScoreSourceApi.resolveLiveDmoUmpireScoreSource('manual', true),
    'replay',
  );
  const oldDmoReplayFallback = liveDmoUmpireScoreSourceApi.resolveLiveDmoUmpireScoreSource(
    'manual', false,
  );
  assert.equal(oldDmoReplayFallback, 'dmo',
    'legacy replay streams use the score path their live-window court actually renders');
  assert.equal(
    liveDmoUmpireScoreSourceApi.shouldPairLiveDmoScoreWithPointEnd(oldDmoReplayFallback, 'live'),
    true,
    'manual old-DMO playback pairs its DMO score changes with point-end events');
  assert.equal(
    liveDmoUmpireScoreSourceApi.shouldPairLiveDmoScoreWithPointEnd(
      liveDmoUmpireScoreSourceApi.resolveLiveDmoUmpireScoreSource('manual', true), 'live',
    ),
    false,
    'the full replay player remains event-scored instead',
  );
  assert.equal(
    liveDmoUmpireScoreSourceApi.shouldPairLiveDmoScoreWithPointEnd('dmo', 'live'),
    true,
  );
  assert.equal(
    liveDmoUmpireScoreSourceApi.shouldPairLiveDmoScoreWithPointEnd('te4', 'live'),
    true,
  );
  assert.equal(
    liveDmoUmpireScoreSourceApi.shouldPairLiveDmoScoreWithPointEnd('replay', 'live'),
    false,
  );
  assert.equal(
    liveDmoUmpireScoreSourceApi.shouldPairLiveDmoScoreWithPointEnd('dmo', 'ended'),
    false,
  );
  assert.match(display, /scoreSource === 'te4' \? liveScore \?\? null : snapshot\.score/);
  assert.match(
    display,
    /live: shouldPairLiveDmoScoreWithPointEnd\(scoreSource, state\)/,
  );
  assert.match(
    viewer,
    /const fullReplayPlayer = broadcast\.replay && broadcast\.replayDataReady/,
  );
  assert.match(
    viewer,
    /resolveLiveDmoUmpireFallbackScoreSource\(\s*broadcast\.broadcastMode,\s*broadcast\.replay,?\s*\)/,
  );
  assert.match(
    viewer,
    /const scoreSource = fullReplayPlayer\s*\?\s*resolveLiveDmoUmpireScoreSource\(broadcast\.broadcastMode,\s*true\)\s*:\s*fallbackScoreSource/,
  );
  assert.match(viewer, /scoreSource={fallbackScoreSource}/);
  assert.equal((viewer.match(/scoreSource={scoreSource}/g) ?? []).length, 1);

  const players = ['Player One', 'Player Two'];
  const source = liveDmoUmpireScoreSourceApi.resolveLiveDmoUmpireScoreSource('manual', false);
  const enabled = liveDmoUmpireScoreSourceApi.shouldPairLiveDmoScoreWithPointEnd(source, 'live');
  const tether = umpireApi.createLiveUmpireScoreTether();
  const initial = { sets: [], games: [0, 0], pointText: ['0', '0'], tiebreak: false, server: 1 };
  assert.equal(umpireApi.observeLiveUmpireScore(tether, initial, players, enabled), null);
  assert.equal(umpireApi.observeLiveUmpireScore(
    tether, { ...initial, pointText: ['15', '0'] }, players, enabled,
  ), null);
  const events = umpireApi.deriveUmpireCallEvents([{ frame: 20, kind: 'point-end' }], [], []);
  assert.equal(umpireApi.umpireCallsBetween(events, 19, 20).length, 1);
  const call = umpireApi.matchLiveUmpireScoreToDmoPointEnd(tether, enabled);
  assert.equal(call, 'fifteen-love', 'the first new DMO point announces without a TE4 feed');
  const manifest = JSON.parse(await readFile(
    new URL('../public/audio/xkt/umpire-index.json', import.meta.url), 'utf8',
  ));
  assert.ok(xktUmpireAudioApi.resolveXktUmpireCallPaths(
    call, manifest, { atp: {}, wta: {} }, false,
  )?.length, 'the local DMO call resolves to a curated recording');
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
      [
        { frame: 10, values: [-1_100, 0, 200, 0, 0, 0, 0] },
        { frame: 12, values: [400, 0, 20, 0, 0, 0, 0] },
      ],
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

test('a delayed replay point-end cannot turn a later dead-ball bounce into Out', () => {
  const calls = umpireApi.deriveUmpireCallEvents(
    [{ frame: 10, kind: 'shot', shotType: 'rally' }, { frame: 160, kind: 'point-end' }],
    [{ frame: 30, kind: 'bounce' }, { frame: 50, kind: 'bounce' }],
    [
      { frame: 30, values: [800, 0, 3, 0, 0, 0, 0] },
      { frame: 50, values: [1_350, 0, 3, 0, 0, 0, 0] },
    ],
  );
  assert.deepEqual(calls.filter(call => call.kind === 'out'), []);
});

test('full replay out detection reaches the recorded audio dispatcher', async () => {
  const spoken = [];
  const api = await loadTs('../lib/liveCourtUmpire.ts', {
    './xktUmpireAudio': {
      playXktUmpireCall: async (_context, text, isWta) => { spoken.push({ text, isWta }); return true; },
      cancelXktUmpireCalls() {},
    },
  });
  const calls = api.deriveUmpireCallEvents(
    [{ frame: 10, kind: 'shot', shotType: 'rally' }, { frame: 100, kind: 'point-end' }],
    [{ frame: 30, kind: 'bounce' }],
    [{ frame: 30, values: [1_250, 0, 3, 0, 0, 0, 0] }],
  );
  for (const call of api.umpireCallsBetween(calls, 29, 31)) {
    assert.equal(await api.speakUmpireCall(call.text, { state: 'running' }, false), true);
  }
  assert.deepEqual(spoken, [{ text: 'Out', isWta: false }]);
});

test('live out calls reach the playhead before the delayed point-end marker', () => {
  const shot = { frame: 10, kind: 'shot', shotType: 'rally' };
  const sounds = [{ frame: 30, kind: 'bounce' }];
  const samples = [{ frame: 30, values: [1_250, 0, 4, 0, 0, 0, 0] }];
  const pending = umpireApi.deriveUmpireCallEvents([shot], sounds, samples, { allowPendingPointEnd: true });
  assert.deepEqual(pending, [{ frame: 30, kind: 'out', text: 'Out' }]);
  const cursor = umpireApi.createLiveUmpireEventCursor();
  assert.deepEqual(umpireApi.consumeLiveUmpireCallEvents(cursor, pending, 29, 31, true), pending);
  const completed = umpireApi.deriveUmpireCallEvents(
    [shot, { frame: 240, kind: 'point-end', scoreCall: 'fifteen-love' }],
    sounds, samples, { allowPendingPointEnd: true },
  );
  assert.equal(umpireApi.consumeLiveUmpireCallEvents(cursor, completed, 239, 241, true)
    .filter(call => call.kind === 'out').length, 0, 'late point-end never repeats the earlier line call');
  assert.deepEqual(umpireApi.deriveUmpireCallEvents([shot], sounds, samples), [],
    'full replays retain their point-end corroboration');
});

test('live line calls ignore later dead-ball bounces and uncertain first landings', () => {
  const shot = { frame: 10, kind: 'shot', shotType: 'rally' };
  const sounds = [{ frame: 30, kind: 'bounce' }, { frame: 50, kind: 'bounce' }];
  for (const first of [[0, 0, 3], [1_250, 0, 45], [1_200, 0, 3]]) {
    const samples = [
      { frame: 30, values: [...first, 0, 0, 0, 0] },
      { frame: 50, values: [1_350, 600, 3, 0, 0, 0, 0] },
    ];
    assert.deepEqual(umpireApi.deriveUmpireCallEvents([shot], sounds, samples,
      { allowPendingPointEnd: true }), []);
  }
  assert.deepEqual(umpireApi.deriveUmpireCallEvents(
    [shot, { frame: 20, kind: 'point-end' }], sounds,
    [{ frame: 30, values: [1_350, 0, 3, 0, 0, 0, 0] }],
    { allowPendingPointEnd: true },
  ).filter(call => call.kind === 'out'), [], 'bounces after a completed point remain silent');
});

test('serve faults use first-bounce evidence and valid serves remain silent', () => {
  const trajectory = [
    { frame: 10, kind: 'shot', shotType: 'serve' },
    { frame: 30, kind: 'shot', shotType: 'serve' },
    { frame: 60, kind: 'point-end', scoreCall: 'fifteen-love' },
  ];
  const sounds = [
    { frame: 15, kind: 'bounce' },
    { frame: 35, kind: 'bounce' },
  ];
  const samples = [
    { frame: 10, values: [-1_100, 0, 200, 0, 0, 0, 0] },
    { frame: 15, values: [-300, 0, 20, 0, 0, 0, 0] },
    { frame: 30, values: [-1_100, 0, 200, 0, 0, 0, 0] },
    { frame: 35, values: [400, 0, 20, 0, 0, 0, 0] },
  ];
  assert.deepEqual(
    umpireApi.deriveUmpireCallEvents(trajectory, sounds, samples),
    [
      { frame: 15, kind: 'fault', text: 'Fault' },
      { frame: 60, kind: 'score', text: 'fifteen-love' },
    ],
  );
});

test('live line calls play only on an immediate frame crossing', () => {
  const cursor = umpireApi.createLiveUmpireEventCursor();
  const events = [
    { frame: 105, kind: 'fault', text: 'Fault' },
    { frame: 118, kind: 'out', text: 'Out' },
    { frame: 130, kind: 'score', text: 'fifteen-love' },
  ];
  assert.deepEqual(
    umpireApi.consumeLiveUmpireCallEvents(cursor, events, 100, 120, true),
    [events[0], events[1]],
  );
  assert.deepEqual(
    umpireApi.consumeLiveUmpireCallEvents(cursor, events, 120, 131, true),
    [events[2]],
  );
  assert.deepEqual(
    umpireApi.consumeLiveUmpireCallEvents(cursor, events, 131, 300, true),
    [],
    'a delayed line-call backlog is dropped',
  );
});

test('all broadcast audio follows one master control in both court renderers', async () => {
  const primary = await readFile(new URL('../components/DmoLiveCourt3D.tsx', import.meta.url), 'utf8');
  const fallback = await readFile(new URL('../components/DmoLiveCourt.tsx', import.meta.url), 'utf8');
  for (const source of [primary, fallback]) {
    assert.match(source, /const umpireCallsEnabled = soundEnabled/);
    assert.match(source, /const activateSoundFromGesture = async \(reportFailure = true\)/);
    assert.match(source, /observeLiveUmpireScore\(/);
    assert.match(source, /matchLiveUmpireScoreToDmoPointEnd\(/);
    assert.doesNotMatch(source, /formatLiveUmpireScoreCall\(current, previous, scoreboardData\.players\)/);
    assert.match(source, /resumeUmpireAudioContext\(/);
    assert.doesNotMatch(source, /unlockBrowserUmpireSpeech\(\)/);
    assert.match(source, /void activateSoundFromGesture\(false\)/);
    assert.match(source, /Mute all broadcast audio/);
    assert.doesNotMatch(source, /Enable calls|data-umpire-calls-toggle|handleUmpireCallsToggle/);
    assert.doesNotMatch(source, /Recorded umpire audio is unavailable for this call/);
    const activationStart = source.indexOf('const handleSoundActivationGesture');
    const activationEnd = source.indexOf('\n  };', activationStart);
    const activationHandler = source.slice(activationStart, activationEnd);
    assert.match(activationHandler, /data-sound-toggle/);
    assert.match(activationHandler, /soundPointerActivationRef\.current = true/);
    assert.match(activationHandler, /activateSoundFromGesture\(\)/);
    assert.match(source, /setUmpireSpeechReady\(true\)/);
  }
  assert.match(primary, /call\.kind === 'score' \|\| call\.kind === 'point-end'/);
  assert.match(fallback, /call\.kind === 'score' \|\| call\.kind === 'point-end'/);
  assert.match(primary, /if \(!soundPreferenceRef\.current\) return;\s*void activateSoundFromGesture\(\)/);
  assert.match(fallback, /if \(!soundEnabledRef\.current\) return;\s*void activateSoundFromGesture\(\)/);
  assert.doesNotMatch(primary, /line.?judge/i);
  assert.doesNotMatch(fallback, /line.?judge/i);
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
  assert.match(primary, /const umpireCallsEnabled = soundEnabled/);
  assert.match(fallback, /const umpireCallsEnabled = soundEnabled/);
  assert.match(primary, /void activateSoundFromGesture\(false\)/);
  assert.match(fallback, /void activateSoundFromGesture\(false\)/);
  assert.match(primary, /const \[gruntsEnabled, setGruntsEnabled\] = useState\(true\)/);
  assert.match(primary, /const initialCameraView: Exclude<CameraView, 'custom'> = fullReplay \? 'tv' : 'court'/);
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
  assertNetMeshIsNeutral(wtaScene, 'generic clay');
  assert.equal(wtaScene.getObjectByName('wtsl-court-runoff').userData.surface, 'clay');
  assert.equal(wtaScene.getObjectByName('wtsl-court-playing-surface').userData.surface, 'clay');
  assert.equal(wtaScene.getObjectByName('wtsl-net-tour-mark').userData.tour, 'WTA');
  assert.equal(wtaScene.getObjectByName('wtsl-net-tour-accent').userData.tour, 'WTA');

  const atpScene = new THREE.Scene();
  sceneApi.buildCourt(atpScene, 'hard', false);
  assertNetMeshIsNeutral(atpScene, 'generic hard');
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

test('Paris net uses a dense weave and visible, decaying hit vibration', () => {
  const scene = new THREE.Scene();
  const courtEffects = sceneApi.buildCourt(scene, 'hard', false, 'Paris Masters');
  const net = scene.getObjectByName('wtsl-court-net');
  const mesh = scene.getObjectByName('wtsl-net-mesh');
  const posts = net?.children.filter(object => object.name === 'wtsl-net-post-pad') ?? [];
  assert.ok(net && mesh);
  assertNetMeshIsNeutral(scene, 'Paris Masters');
  assert.equal(net.userData.eventLabel, 'PARIS MASTERS');
  assert.equal(posts.length, 2);
  assert.ok(posts.every(post => post.userData.eventLabel === 'PARIS MASTERS'));
  assert.equal(mesh.userData.wireColumns, 241);
  assert.equal(mesh.userData.wireRows, 24);
  assert.ok(mesh.userData.cellWidth <= 0.05);
  assert.ok(mesh.geometry.getAttribute('position').count > 17_000);
  assert.ok(mesh.material.color.getHex() > 0x303030, 'the woven net should not render near black');
  assert.ok(mesh.material.color.getHex() < 0xa0a0a0, 'the woven net should remain gray, not white');
  assert.equal(mesh.material.transparent, true);
  assert.ok(
    mesh.material.opacity >= 0.2 && mesh.material.opacity <= 0.35,
    'the mesh should stay translucent but visible instead of reading as a solid white panel',
  );
  assert.equal(mesh.material.depthWrite, false, 'the mesh should not occlude the court behind it');
  assert.equal(mesh.material.toneMapped, false);
  assert.ok(scene.getObjectByName('wtsl-net-center-strap'));

  const positions = mesh.geometry.getAttribute('position');
  const rest = Array.from(positions.array);
  courtEffects.net.impact(0.3, 1, 1, 0);
  courtEffects.net.update(0.04);
  assert.notDeepEqual(Array.from(positions.array), rest);
  const maxDisplacement = Math.max(...Array.from(
    { length: positions.count },
    (_, index) => Math.abs(positions.getX(index) - rest[index * 3]),
  ));
  assert.ok(maxDisplacement > 0.12, 'a net strike should create an obvious mesh ripple');
  assert.ok(
    Math.abs(scene.getObjectByName('wtsl-net-top-tape-group').position.x) > 0.025,
    'the top tape should visibly react to a net strike',
  );
  courtEffects.net.update(2);
  assert.deepEqual(Array.from(positions.array), rest);

  const rolandGarros = new THREE.Scene();
  sceneApi.buildCourt(rolandGarros, 'clay', false, 'Roland Garros');
  assertNetMeshIsNeutral(rolandGarros, 'Roland-Garros');
  assert.equal(rolandGarros.getObjectByName('wtsl-court-net').userData.eventLabel, 'ROLAND-GARROS');
  assert.notEqual(
    rolandGarros.getObjectByName('wtsl-net-mesh').material.color.getHex(),
    mesh.material.color.getHex(),
  );
});

test('net impact cues detect low crossings and rebounds but ignore clear shots', async () => {
  const { detectCourtNetImpact } = sceneApi;
  const crossing = detectCourtNetImpact(
    new THREE.Vector3(-0.9, 0.7, -0.4),
    new THREE.Vector3(-0.1, 0.8, 0.3),
    new THREE.Vector3(0.1, 0.82, 0.5),
  );
  assert.ok(crossing);
  assert.equal(crossing.direction, 1);
  assert.ok(crossing.z > 0.3 && crossing.z < 0.5);

  const rebound = detectCourtNetImpact(
    new THREE.Vector3(-0.5, 0.72, -1),
    new THREE.Vector3(-0.08, 0.74, -0.2),
    new THREE.Vector3(-0.15, 0.75, -0.1),
  );
  assert.ok(rebound);
  assert.equal(rebound.direction, 1);

  const sparseSampleRebound = detectCourtNetImpact(
    new THREE.Vector3(-0.62, 0.74, -0.4),
    new THREE.Vector3(-0.33, 0.75, -0.2),
    new THREE.Vector3(-0.44, 0.76, -0.1),
  );
  assert.ok(sparseSampleRebound, 'a rebound near the net should survive sparse replay samples');

  assert.equal(detectCourtNetImpact(
    null,
    new THREE.Vector3(-0.1, 1.4, 0),
    new THREE.Vector3(0.1, 1.45, 0.1),
  ), null);
  assert.equal(detectCourtNetImpact(
    new THREE.Vector3(-0.8, 0.7, 0),
    new THREE.Vector3(-0.5, 0.7, 0),
    new THREE.Vector3(-0.2, 0.7, 0),
  ), null);

  const rendererSource = await readFile(new URL('../components/DmoLiveCourt3D.tsx', import.meta.url), 'utf8');
  assert.match(rendererSource, /detectCourtNetImpact\(/);
  assert.match(rendererSource, /courtEffects\.net\.impact\(/);
  assert.match(rendererSource, /courtEffects\.net\.update\(/);
});

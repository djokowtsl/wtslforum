import assert from 'node:assert/strict';
import { stat, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { courtSurfaceSoundProfile, courtSurfaceDisplayName } from '../lib/te4DmoSurface.ts';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');
const threeCourt = await readFile(
  new URL('../components/DmoLiveCourt3D.tsx', import.meta.url),
  'utf8',
);
const fallbackCourt = await readFile(
  new URL('../components/DmoLiveCourt.tsx', import.meta.url),
  'utf8',
);
const gruntAudioModuleSource = await readFile(
  new URL('../lib/liveGruntAudio.ts', import.meta.url),
  'utf8',
);
const { code } = transformSync(gruntAudioModuleSource, {
  jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
  module: { type: 'commonjs' },
});
const gruntAudioModule = { exports: {} };
new Function('module', 'exports', code)(gruntAudioModule, gruntAudioModule.exports);
const { liveGruntAudioUrl } = gruntAudioModule.exports;

test('WTA live courts use a dedicated female effort-grunt sample', async () => {
  const asset = await stat(new URL('../public/audio/te4-player-grunt-wta.mp3', import.meta.url));

  assert.ok(asset.size > 1_000);
  assert.equal(liveGruntAudioUrl(true), '/audio/te4-player-grunt-wta.mp3');
  assert.equal(liveGruntAudioUrl(false), '/audio/te4-player-grunt.mp3');
  assert.match(threeCourt, /loadGruntSample\(context, isWta\)/);
  assert.match(threeCourt, /gruntAudioRef\.current\?\.isWta === isWta/);
});

test('the 2D fallback uses the same WTA sample and recorded court effects', () => {
  assert.match(fallbackCourt, /isWta \? 260 : 150/);
  assert.match(fallbackCourt, /isWta \? 520 : 340/);
  assert.match(fallbackCourt, /fetch\(liveGruntAudioUrl\(true\)\)/);
  assert.match(fallbackCourt, /playLiveCourtCue\(context, cue, activeGruntVoicesRef\.current, isWta,[\s\S]*?courtEffectSamplesRef\.current\)/);
  assert.match(fallbackCourt, /deriveLiveCourtFootworkEvents\(/);
  assert.match(fallbackCourt, /playLiveCourtEffect\(context, kind, surface, 0\.9, courtEffectSamples\)/);
});

test('court effect samples stay compact and surface labels remain distinct', async () => {
  for (const file of [
    'dmo-racket-impact.mp3',
    'dmo-ball-bounce.mp3',
    'dmo-court-footstep.mp3',
  ]) {
    const asset = await stat(new URL(`../public/audio/${file}`, import.meta.url));
    assert.ok(asset.size > 1_000 && asset.size < 20_000, `${file} is a small, bundled court cue`);
  }
  assert.match(threeCourt, /loadCourtEffectSamples\(context\)/);
  assert.match(threeCourt, /courtEffectSamplesRef\.current/);

  const surfaces = ['clay', 'grass', 'hard', 'unknown'];
  const profiles = surfaces.map((surface) => courtSurfaceSoundProfile(surface));

  assert.deepEqual(surfaces.map((surface) => courtSurfaceDisplayName(surface)), [
    'CLAY COURT',
    'GRASS COURT',
    'HARD COURT',
    'SURFACE UNKNOWN',
  ]);
  assert.equal(new Set(profiles.map((profile) => profile.stepNoiseHz)).size, 4);
  assert.equal(new Set(profiles.map((profile) => profile.bounceHz.join(':'))).size, 4);
  assert.equal(new Set(profiles.map((profile) => profile.racketHz.join(':'))).size, 4);
  assert.doesNotMatch(threeCourt, /dmo-court-slide\.mp3/);
  assert.match(fallbackCourt, /if \(event\.kind !== 'footstep'\) continue/);
});

test('the nonfunctional 3D court sound-test control is removed', () => {
  assert.doesNotMatch(threeCourt, /Test court sounds|playCourtSoundCheck/);
  assert.match(threeCourt, /Court effects volume/,
    'the actual court-effects volume control remains available');
});

test('both viewers discard stale footsteps rather than replaying a backlog', () => {
  assert.match(threeCourt, /if \(cue\.kind === 'footstep'\) continue/);
  assert.match(threeCourt, /updateLiveCourtFootstepContact\([\s\S]*?\[leftLift, rightLift\]/);
  assert.match(threeCourt, /player\.root\.userData\.footstepContact/);
  assert.match(fallbackCourt, /snapshot\.frameCount - event\.frame > TE4_DMO_FRAMES_PER_SECOND \* 0\.12/);
});

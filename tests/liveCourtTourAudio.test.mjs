import assert from 'node:assert/strict';
import { stat, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';

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

test('the 2D fallback uses the same WTA sample and a higher-register synthetic fallback', () => {
  assert.match(fallbackCourt, /isWta \? 260 : 150/);
  assert.match(fallbackCourt, /isWta \? 520 : 340/);
  assert.match(fallbackCourt, /fetch\(liveGruntAudioUrl\(true\)\)/);
  assert.match(fallbackCourt, /playLiveCourtCue\(context, cue, activeGruntVoicesRef\.current, isWta, wtaGruntAudioRef\.current\)/);
});

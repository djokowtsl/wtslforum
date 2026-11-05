// Exercise the actual production updater, not hand-picked racket targets.
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');
const root = new URL('../../', import.meta.url);
async function source(path, baseline) {
  return baseline
    ? execFileSync('git', ['show', `origin/main:${path}`], { cwd: root, encoding: 'utf8' })
    : readFile(new URL(path, root), 'utf8');
}
async function load(path, overrides = {}, baseline = false) {
  const { code } = transformSync(await source(path, baseline), {
    jsc: { parser: { syntax: 'typescript' }, target: 'es2022' }, module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', code)(module, module.exports, n => overrides[n] ?? require(n));
  return module.exports;
}
const scene = await load('components/DmoLiveCourt3DScene.ts');
const motion = await load('lib/liveCourtMotion.ts');
const performance = await load('lib/liveCourtPerformance.ts');
const gait = await load('lib/liveCourtGait.ts');
const racket = await load('components/DmoRacketOrientation.ts');
const grip = await load('components/DmoNativeGrip.ts');
const twist = await load('components/DmoNativeTwist.ts');
const kit = await load('components/DmoNativeKit.ts');
const waiting = await load('components/DmoWaitingPose.ts');
const bytes = await readFile(new URL('public/models/dmo-humans/native-player.glb', root));
const template = (await new GLTFLoader().parseAsync(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '',
)).scene;
const motions = Object.fromEntries(await Promise.all(['forehand', 'backhand', 'serve'].map(async name =>
  [name, await readFile(new URL(`public/models/dmo-humans/tennis-${name}.bvh`, root), 'utf8')])));

export function syntheticSamples(moving = false) {
  return Array.from({ length: 181 }, (_, frame) => ({
    frame, values: [0, 0, 100, -900, moving ? (frame - 90) * 12 : 0, 900, 0],
  }));
}

export async function productionPlayer({ handedness = 'right', baseline = false } = {}) {
  const capture = await load('components/DmoCapturedGroundstroke.ts', {}, baseline);
  const native = await load('components/DmoNativePlayerClaude.ts', {
    './DmoRacketOrientation': racket, './DmoNativeGrip': grip, './DmoNativeKit': kit,
    './DmoNativeTwist': twist,
    './DmoCapturedGroundstroke': capture,
  }, baseline);
  const rig = scene.makePlayer(0x81b6b4, 0x202020);
  rig.root.userData.dominantHandedness = handedness;
  const attached = native.attachNativePlayer(template, rig, 0x81b6b4, motions);
  const text = await source('components/DmoLiveCourt3D.tsx', baseline);
  const start = text.indexOf('    const updatePlayer = (');
  const end = text.indexOf('\n    const animate = ', start);
  if (start < 0 || end < 0) throw new Error('Production player updater boundaries changed.');
  const footworkEventsRef = { current: [] };
  const env = {
    THREE, ...scene, ...motion, ...performance, ...gait, ...racket, ...capture, ...waiting,
    TE4_DMO_FRAMES_PER_SECOND: 60,
    sceneDataRef: { current: { snapshot: { frameRate: 60 }, playbackSpeed: 1 } },
    footworkEventsRef, transitionRef: { current: null },
  };
  const { code } = transformSync(`let changeoverUntil = 0;\n${text.slice(start, end)}\nmodule.exports = updatePlayer;`, {
    jsc: { parser: { syntax: 'typescript' }, target: 'es2022' }, module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  new Function('module', ...Object.keys(env), code)(module, ...Object.values(env));
  return {
    rig, ...attached,
    updateFrame(frame, { samples = syntheticSamples(), events = [], footwork = [] } = {}) {
      const values = motion.interpolateLiveCourtFrame(samples, frame);
      if (!values) throw new Error('Synthetic frame unavailable.');
      footworkEventsRef.current = footwork;
      module.exports(rig, values[3], values[4], 0, values, frame, samples,
        samples.at(-1).frame, samples[0].frame, events, false, 16.67, handedness);
    },
  };
}

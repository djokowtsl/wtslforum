import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as THREE from 'three';

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

const lightingApi = await loadTs('../components/DmoBroadcastLighting.ts', { three: THREE });

test('day, evening, and night update outdoor sky, clouds, sunlight, and floodlights', () => {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xffffff, 82, 205);
  const renderer = { toneMappingExposure: 1 };
  const lighting = lightingApi.createDmoBroadcastLighting(scene, renderer, false);
  const sky = scene.getObjectByName('wtsl-broadcast-sky');
  const sun = scene.getObjectByName('wtsl-broadcast-sun');
  const clouds = scene.getObjectByName('wtsl-broadcast-cloud-cover');
  const spotlights = scene.children.filter(child => child.isSpotLight);

  assert.ok(sky && sun && clouds);
  assert.equal(spotlights.length, 4);

  lighting.apply('day');
  assert.equal(scene.userData.wtslBroadcastTimeOfDay, 'day');
  assert.equal(sun.visible, true);
  assert.equal(clouds.children.filter(cluster => cluster.visible).length, 4);
  assert.equal(spotlights[0].intensity, 0);

  lighting.apply('evening');
  assert.equal(scene.userData.wtslBroadcastTimeOfDay, 'evening');
  assert.equal(clouds.children.filter(cluster => cluster.visible).length, 6);
  assert.ok(sun.position.y < 30, 'the evening sun sits near the horizon');
  assert.ok(spotlights[0].intensity > 0, 'floodlights start warming up at dusk');

  lighting.apply('night');
  assert.equal(scene.userData.wtslBroadcastTimeOfDay, 'night');
  assert.equal(sun.visible, false);
  assert.equal(clouds.children.filter(cluster => cluster.visible).length, 2);
  assert.ok(spotlights.every(light => light.intensity === 300));
  assert.equal(renderer.toneMappingExposure, 0.9);
});

test('indoor broadcasts keep the sky hidden but enable night court lighting', () => {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xffffff, 82, 205);
  const lighting = lightingApi.createDmoBroadcastLighting(scene, { toneMappingExposure: 1 }, true);
  lighting.apply('night');

  assert.equal(scene.getObjectByName('wtsl-broadcast-sky').visible, false);
  assert.equal(scene.getObjectByName('wtsl-broadcast-sun').visible, false);
  assert.equal(scene.getObjectByName('wtsl-broadcast-cloud-cover').visible, false);
  assert.equal(scene.children.filter(child => child.isSpotLight).every(light => light.intensity === 300), true);
});

test('the live and replay toolbar exposes the time-of-day selector', async () => {
  const source = await readFile(new URL('../components/DmoLiveCourt3D.tsx', import.meta.url), 'utf8');
  assert.match(source, /aria-label="Broadcast time of day"/);
  assert.match(source, /BROADCAST_TIME_OF_DAY_OPTIONS\.map/);
  assert.match(source, /broadcastLightingRef\.current\?\.apply\(timeOfDay\)/);
});

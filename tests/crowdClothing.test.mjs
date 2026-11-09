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
  new Function('module', 'exports', 'require', code)(
    module,
    module.exports,
    (name) => overrides[name] ?? require(name),
  );
  return module.exports;
}

const architectureApi = await loadTs('../components/DmoStadiumArchitecture.ts');
const sceneApi = await loadTs('../components/DmoLiveCourt3DScene.ts', {
  './DmoStadiumArchitecture': architectureApi,
  '../lib/dmoVenue': await loadTs('../lib/dmoVenue.ts'),
  '@/lib/te4DmoSurface': await loadTs('../lib/te4DmoSurface.ts'),
  '@/lib/dmoCrowdDensity': await loadTs('../lib/dmoCrowdDensity.ts'),
});
const clothingApi = await loadTs('../lib/dmoCrowdClothing.ts');

test('all occupied spectator seats keep instanced shoes and clothed hips through density updates', () => {
  const scene = new THREE.Scene();
  const crowd = sceneApi.buildCrowd(scene);
  const shoes = scene.getObjectByName('wtsl-unified-crowd-footwear');
  const hips = scene.getObjectByName('wtsl-unified-crowd-fallback-hips');
  const torsos = scene.getObjectByName('wtsl-unified-crowd-clothing-torsos');

  assert.ok(shoes?.isInstancedMesh);
  assert.ok(hips?.isInstancedMesh);
  assert.ok(torsos?.isInstancedMesh);
  assert.equal(shoes.count, crowd.seats.filter((seat) => seat.occupied).length * 2);
  assert.equal(hips.count, crowd.seats.filter((seat) => seat.occupied).length);
  assert.equal(torsos.count, crowd.seats.filter((seat) => seat.occupied).length);
  assert.equal(shoes.material.transparent, false);
  assert.equal(torsos.material.transparent, false);
  assert.equal(torsos.material.opacity, 1);
  assert.equal(torsos.userData.opaqueGarmentCoverage, 'front-back-sides');
  torsos.geometry.computeBoundingBox();
  assert.ok(torsos.geometry.boundingBox.max.z > 0.15);
  assert.ok(torsos.geometry.boundingBox.min.z < -0.15,
    'the instanced garment geometry wraps the torso rather than covering only its front');
  shoes.geometry.computeBoundingBox();
  assert.ok(shoes.geometry.boundingBox.max.z - shoes.geometry.boundingBox.min.z > 0.24
    && shoes.geometry.boundingBox.max.z - shoes.geometry.boundingBox.min.z < 0.27,
  'shoe length should be human-sized, not padded into a boot');
  const shoeMatrix = new THREE.Matrix4();
  const shoeScale = new THREE.Vector3();
  shoes.getMatrixAt(0, shoeMatrix);
  shoeMatrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), shoeScale);
  assert.ok(shoeScale.z <= 1.01, 'shoe length must not be enlarged after fitting the ankle-to-toe targets');
  assert.ok(shoeScale.y <= 0.96, 'shoe sole height stays low-profile');

  crowd.setDensity(0);
  assert.equal(shoes.count, 0);
  assert.equal(hips.count, 0);
  assert.equal(torsos.count, 0);
  crowd.setDensity(1);
  assert.equal(shoes.count, crowd.seats.length * 2);
  assert.equal(hips.count, crowd.seats.length);
  assert.equal(torsos.count, crowd.seats.length);
});

test('fitted spectators replace all capsule and duplicate-shoe fallback layers', () => {
  const scene = new THREE.Scene();
  const crowd = sceneApi.buildCrowd(scene);
  const fallbackNames = [
    'wtsl-unified-crowd-fallback-bodies',
    'wtsl-unified-crowd-clothing-torsos',
    'wtsl-unified-crowd-fallback-hips',
    'wtsl-unified-crowd-footwear',
  ];
  for (const name of fallbackNames) assert.equal(scene.getObjectByName(name)?.visible, true);
  crowd.replacePeople(() => {});
  for (const name of fallbackNames) {
    assert.equal(scene.getObjectByName(name)?.visible, false, `${name} must not cover fitted human models`);
  }
});

test('detailed crowd clothing is forced opaque without losing its texture', async () => {
  const texture = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    transparent: true,
    opacity: 0.2,
    alphaTest: 0.4,
    depthWrite: false,
  });

  assert.equal(clothingApi.makeCrowdClothingOpaque(material), material);
  assert.equal(material.map, texture);
  assert.equal(material.transparent, false);
  assert.equal(material.opacity, 1);
  assert.equal(material.alphaTest, 0);
  assert.equal(material.depthWrite, true);
  assert.equal(material.side, THREE.DoubleSide);
  assert.equal(clothingApi.isCrowdSkinPixel(228, 176, 145), true);
  assert.equal(clothingApi.isCrowdSkinPixel(142, 137, 130), false,
    'neutral fabric is not treated as skin');
  assert.equal(clothingApi.isCrowdSkinPixel(63, 39, 28), false,
    'dark hair is not treated as skin');

  const [source, models, scene] = await Promise.all([
    readFile(new URL('../components/DmoHumanCrowd.ts', import.meta.url), 'utf8'),
    readFile(new URL('../components/DmoHumanModels.ts', import.meta.url), 'utf8'),
    readFile(new URL('../components/DmoLiveCourt3DScene.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(source, /makeCrowdClothingOpaque/);
  assert.match(source, /wtsl-detailed-crowd-shoes/);
  assert.match(source, /new THREE\.CapsuleGeometry\(0\.045,\s*0\.12/);
  assert.match(source, /shoeMesh\.count = shoeInstance/);
  assert.match(source, /appearance\.wardrobe \* 6 \+ bucket/);
  assert.match(source, /tintKit\(object, tint, skinTone\)/);
  assert.match(models, /isCrowdSkinPixel/);
  assert.match(scene, /const appearance = \(hash >>> 12\) % 8/);
  assert.match(scene, /ankle: \[sideSign \* 0\.14, 0\.16, 0\.14\]/);
  assert.match(source, /instanceColor\.setRGB\(1,\s*1,\s*1\)/);
});

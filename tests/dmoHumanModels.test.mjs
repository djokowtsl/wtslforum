import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BVHLoader } from 'three/examples/jsm/loaders/BVHLoader.js';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');
async function loadTs(file, overrides = {}) {
  const source = await readFile(new URL(file, import.meta.url), 'utf8');
  const { code } = transformSync(source, {
    jsc: { parser: { syntax: 'typescript' }, target: 'es2022' }, module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', code)(module, module.exports, (name) => overrides[name] ?? require(name));
  return module.exports;
}
const stadiumArchitectureApi = await loadTs('../components/DmoStadiumArchitecture.ts');
const venueApi = await loadTs('../lib/dmoVenue.ts');
const surfaceApi = await loadTs('../lib/te4DmoSurface.ts');
const crowdDensityApi = await loadTs('../lib/dmoCrowdDensity.ts');
const crowdClothingApi = await loadTs('../lib/dmoCrowdClothing.ts');
const crowdBrandingApi = await loadTs('../lib/dmoCrowdBranding.ts');
const sceneApi = await loadTs('../components/DmoLiveCourt3DScene.ts', {
  './DmoStadiumArchitecture': stadiumArchitectureApi,
  '../lib/dmoVenue': venueApi,
  '@/lib/te4DmoSurface': surfaceApi,
  '@/lib/dmoCrowdDensity': crowdDensityApi,
  '@/lib/dmoCrowdClothing': crowdClothingApi,
});
const racketPose = await loadTs('../components/DmoRacketOrientation.ts');
const articulated = await loadTs('../components/DmoArticulatedHands.ts', { './DmoRacketOrientation': racketPose });
const nativeGrip = await loadTs('../components/DmoNativeGrip.ts');
const capturedGroundstroke = await import('../components/DmoCapturedGroundstroke.ts');
const capturedLocomotion = await import('../components/DmoCapturedLocomotion.ts');
const nativeKit = await loadTs('../components/DmoNativeKit.ts');
const nativeTwist = await loadTs('../components/DmoNativeTwist.ts');
const nativePlayer = await loadTs('../components/DmoNativePlayer.ts', {
  './DmoRacketOrientation': racketPose, './DmoNativeGrip': nativeGrip, './DmoNativeKit': nativeKit,
  './DmoNativeTwist': nativeTwist,
  './DmoCapturedGroundstroke': capturedGroundstroke,
  './DmoCapturedLocomotion': capturedLocomotion,
});
const claudeNativePlayer = await loadTs('../components/DmoNativePlayerClaude.ts', {
  './DmoRacketOrientation': racketPose, './DmoNativeGrip': nativeGrip, './DmoNativeKit': nativeKit,
  './DmoNativeTwist': nativeTwist,
  './DmoCapturedGroundstroke': capturedGroundstroke,
  './DmoCapturedLocomotion': capturedLocomotion,
});
const humans = await loadTs('../components/DmoHumanModels.ts', {
  './DmoRacketOrientation': racketPose, './DmoArticulatedHands': articulated,
  './DmoNativePlayer': nativePlayer, './DmoNativePlayerClaude': claudeNativePlayer,
  './DmoNativeKit': nativeKit,
  '@/lib/dmoCrowdClothing': crowdClothingApi,
});
const crowdLodApi = await loadTs('../lib/dmoCrowdLod.ts');
const crowds = await loadTs('../components/DmoHumanCrowd.ts', {
  './DmoHumanModels': humans,
  './DmoLiveCourt3DScene': sceneApi,
  '../lib/dmoCrowdLod': crowdLodApi,
  '../lib/dmoCrowdClothing': crowdClothingApi,
  '../lib/dmoCrowdBranding': crowdBrandingApi,
});

// Parse the real rig and geometry in Node, omitting image decoding (verified in browser).
async function asset(gender, detail = 'player') {
  const source = await readFile(new URL(`../public/models/dmo-humans/${gender}-${detail}.glb`, import.meta.url));
  const n = source.readUInt32LE(12);
  const g = JSON.parse(source.toString('utf8', 20, 20 + n));
  assert.equal(g.skins.length, 1);
  assert.ok(g.skins[0].joints.length >= 24);
  assert.ok(source.length < 1_000_000);
  g.images = []; g.textures = []; g.materials = [];
  delete g.meshes[0].primitives[0].material;
  let json = Buffer.from(JSON.stringify(g));
  json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)]);
  const header = Buffer.alloc(20);
  header.write('glTF'); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + json.length + source.length - 20 - n, 8);
  header.writeUInt32LE(json.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  const buffer = Buffer.concat([header, json, source.subarray(20 + n)]);
  const gltf = await new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '');
  return gltf.scene;
}

async function nativePlayerTemplate(gender) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const name = new URL(String(input), 'https://forum.test').pathname.split('/').pop();
    const filename = name === 'native-player.glb' || name?.endsWith('.bvh')
      ? name
      : null;
    if (!filename) throw new Error(`Unexpected native player asset: ${String(input)}`);
    const bytes = await readFile(new URL(`../public/models/dmo-humans/${filename}`, import.meta.url));
    return new Response(bytes);
  };
  try {
    return await humans.loadHumanModel(gender, 'player', new AbortController().signal);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function articulatedHandAsset() {
  const bytes = await readFile(new URL('../public/models/dmo-humans/articulated-hand.glb', import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '',
  );
  return gltf.scene;
}

const close = (actual, expected) => assert.ok(actual.distanceTo(expected) < 0.00001,
  `${actual.toArray()} differs from ${expected.toArray()}`);
// Joint locations alone miss stretched skinned feet and toes beyond the targets.
function skinnedRegionBounds(model, space, bonePattern) {
  const bounds = new THREE.Box3();
  let count = 0;
  model.updateMatrixWorld(true);
  model.traverse((object) => {
    if (!object.isSkinnedMesh) return;
    object.skeleton.update();
    const { position, skinWeight, skinIndex } = object.geometry.attributes;
    for (let i = 0; i < position.count; i++) {
      let dominant = 0;
      for (let j = 1; j < 4; j++) {
        if (skinWeight.getComponent(i, j) > skinWeight.getComponent(i, dominant)) dominant = j;
      }
      if (!bonePattern.test(object.skeleton.bones[skinIndex.getComponent(i, dominant)].name)) continue;
      const point = object.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(object.matrixWorld);
      bounds.expandByPoint(space.worldToLocal(point));
      count++;
    }
  });
  assert.ok(count > 20, 'check a real skinned surface, not an empty or mocked joint set');
  return bounds;
}
const handCanonical = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
  new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, 0, 0),
));

test('recorded volley clips are compact, parsed, and attributed share-alike derivatives', async () => {
  const manifest = JSON.parse(await readFile(
    new URL('../public/models/dmo-humans/provenance.json', import.meta.url),
  ));
  for (const filename of ['tennis-volley-forehand.bvh', 'tennis-volley-backhand.bvh']) {
    const bytes = await readFile(new URL(`../public/models/dmo-humans/${filename}`, import.meta.url));
    const parsed = new BVHLoader().parse(bytes.toString('utf8'));
    const provenance = manifest.find(entry => entry.filename === filename);
    assert.ok(provenance, `${filename} has no provenance entry`);
    assert.equal(provenance.bytes, bytes.byteLength);
    assert.equal(provenance.license, 'CC BY-SA 3.0');
    assert.match(provenance.source, /jdpulgarin\/Tennis-MoCap/);
    assert.equal(parsed.clip.tracks[0].times.length, 51);
    assert.ok(Math.abs(parsed.clip.tracks[0].times[23] - 0.92) < 1e-6,
      'the existing excerpt retains its 25 Hz sample spacing');
    assert.equal(parsed.skeleton.bones.find(bone => bone.name === 'RightWrist')?.name, 'RightWrist');
    assert.ok(bytes.byteLength < 50_000, 'only the selected motion excerpt is shipped');
  }
});

test('seated spectator leg bones scale to their seat targets instead of hanging below them', async () => {
  const model = await asset('male', 'crowd');
  const space = new THREE.Group();
  space.add(model);
  const pose = new humans.HumanPose(model, space);
  const upperLeg = model.getObjectByName('LeftUpLeg');
  const lowerLeg = model.getObjectByName('LeftLeg');
  assert.ok(upperLeg && lowerLeg);
  const upperBone = upperLeg.children.find((child) => child instanceof THREE.Bone);
  const lowerBone = lowerLeg.children.find((child) => child instanceof THREE.Bone);
  assert.ok(upperBone && lowerBone);
  const targets = sceneApi.getSeatedCrowdLegTargets(1);
  const vector = (point) => new THREE.Vector3(...point);
  const hip = vector(targets.hip);
  const knee = vector(targets.knee);
  const ankle = vector(targets.ankle);
  const toe = vector(targets.toe);
  const placedSegmentLength = (parent, child) => {
    const first = parent.getWorldPosition(new THREE.Vector3());
    const second = child.getWorldPosition(new THREE.Vector3());
    space.worldToLocal(first);
    space.worldToLocal(second);
    return first.distanceTo(second);
  };
  pose.begin();
  pose.place('Hips', hip);
  pose.place('LeftUpLeg', hip, knee);
  pose.place('LeftLeg', knee, ankle);
  pose.place('LeftFoot', ankle, toe);
  pose.finish();
  const fittedUpperLength = placedSegmentLength(upperLeg, upperBone);
  const fittedLowerLength = placedSegmentLength(lowerLeg, lowerBone);
  assert.ok(Math.abs(fittedUpperLength - hip.distanceTo(knee)) < 1e-4,
    `upper leg ${fittedUpperLength} vs ${hip.distanceTo(knee)}; scale ${upperLeg.scale.toArray()}, source ${upperBone.position.toArray()}`);
  assert.ok(Math.abs(fittedLowerLength - knee.distanceTo(ankle)) < 1e-4,
    `lower leg ${fittedLowerLength} vs ${knee.distanceTo(ankle)}; scale ${lowerLeg.scale.toArray()}, source ${lowerBone.position.toArray()}`);
});

for (const gender of ['male', 'female']) for (const detail of ['crowd', 'player']) {
  test(`${gender} ${detail}: seated staff skin stays compact and umpire soles fit the footrest`, async () => {
    const scene = new THREE.Scene();
    const fixtures = sceneApi.buildCourtFixtures(scene);
    const crowd = sceneApi.buildCrowd(scene);
    const template = await asset(gender, detail);
    crowds.attachHumanCourtStaff(scene, fixtures, [template, template], crowd, template);
    const chair = scene.getObjectByName('wtsl-umpire-chair');
    const umpire = scene.getObjectByName('wtsl-detailed-umpire');
    const bar = scene.getObjectByName('wtsl-umpire-foot-bar');
    const barTop = bar.position.y + bar.geometry.parameters.height / 2;
    const feet = skinnedRegionBounds(umpire, chair, /Foot|ToeBase/);
    assert.ok(feet.min.y >= barTop - 0.025 && feet.min.y <= barTop + 0.025,
      `actual soles (${feet.min.y}) must meet the bar (${barTop}), not just the toe bones`);
    assert.ok(feet.max.z < 0.55 && feet.max.z - feet.min.z < 0.35,
      `umpire feet/toes must not stretch forward like extra shins: ${feet.min.z}..${feet.max.z}`);
    const umpireLegs = skinnedRegionBounds(umpire, chair, /Leg|Foot|ToeBase/);
    assert.ok(1.34 - umpireLegs.min.y < 0.44, 'actual leg surfaces stay near the seat');
    for (const index of [1, 2]) {
      const coach = scene.getObjectByName(`wtsl-court-coach-${index}`);
      const space = scene.getObjectByName(`wtsl-coach-space-${index}`);
      const legs = skinnedRegionBounds(coach, space, /Leg|Foot|ToeBase/);
      assert.ok(legs.min.y > -0.07 && 0.4 - legs.min.y < 0.47,
        `front-row coach ${index} must not dangle below its row: lowest skin ${legs.min.y}`);
      const coachFeet = skinnedRegionBounds(coach, space, /Foot|ToeBase/);
      assert.ok(coachFeet.max.z - coachFeet.min.z < 0.35, 'coach feet retain normal proportions');
    }
  });
}

test('one-handed backhand clip is loadable and carries its share-alike attribution', async () => {
  const manifest = JSON.parse(await readFile(
    new URL('../public/models/dmo-humans/provenance.json', import.meta.url),
  ));
  const bytes = await readFile(new URL(
    '../public/models/dmo-humans/tennis-backhand-one.bvh',
    import.meta.url,
  ));
  const parsed = new BVHLoader().parse(bytes.toString('utf8'));
  const provenance = manifest.find(entry => entry.filename === 'tennis-backhand-one.bvh');
  assert.ok(provenance);
  assert.equal(provenance.bytes, bytes.byteLength);
  assert.equal(provenance.license, 'CC-BY-SA-3.0');
  assert.match(provenance.source, /astrejos_Reves\.bvh/);
  assert.equal(parsed.skeleton.bones.find(bone => bone.name === 'RightWrist')?.name, 'RightWrist');
  assert.ok(parsed.clip.duration > 5.66, 'the inferred contact time must be inside the recording');
});

for (const gender of ['male', 'female']) test(`${gender}: continuous native body retains wrists, clothes and segment lengths`, async () => {
    const template = await nativePlayerTemplate(gender);
    const bytes = await readFile(new URL('../public/models/dmo-humans/native-player.glb', import.meta.url));
    assert.ok(bytes.length < 1_200_000);
  let source;
  template.traverse(o => { if (o instanceof THREE.SkinnedMesh) source = o.geometry.getAttribute('position').array.slice(); });
  const rig = sceneApi.makePlayer(0x275c77, 0x333333, gender === 'female');
  rig.root.position.set(2, 0, -3); rig.root.rotation.y = 0.7;
  sceneApi.poseLimb(rig.leftArm, new THREE.Vector3(0.23, 1.44, 0), new THREE.Vector3(0.3, 1.18, 0.05));
  sceneApi.poseLimb(rig.leftForearm, new THREE.Vector3(0.3, 1.18, 0.05), new THREE.Vector3(0.39, 1.1, 0.06));
  sceneApi.poseLimb(rig.rightArm, new THREE.Vector3(-0.23, 1.44, 0), new THREE.Vector3(-0.2, 1.18, 0.05));
  sceneApi.poseLimb(rig.rightForearm, new THREE.Vector3(-0.2, 1.18, 0.05), new THREE.Vector3(-0.39, 1.1, 0.06));
  for (const [thigh, calf, x] of [[rig.leftLeg, rig.leftCalf, -0.13], [rig.rightLeg, rig.rightCalf, 0.13]]) {
    sceneApi.poseLimb(thigh, new THREE.Vector3(x, 0.9, 0), new THREE.Vector3(x, 0.5, 0.04));
    sceneApi.poseLimb(calf, new THREE.Vector3(x, 0.5, 0.04), new THREE.Vector3(x, 0.13, 0));
  }
  const attached = humans.attachHumanPlayer(template, rig, 0x275c77);
  const { pose, grips } = attached;
  assert.equal(attached.model.getObjectByName('native-tour-mark-1').userData.inventedLabel, 'COURTLINE');
  assert.ok(attached.model.getObjectByName('native-player-headband-1'));
  assert.ok(attached.model.getObjectByName('native-player-swept-hair-1'));
  const apparelPatch = attached.model.getObjectByName('native-apparel-patch');
  assert.ok(apparelPatch?.geometry.parameters.width >= 0.16,
    'fictional tour marks are apparel-sized patches rather than tiny unreadable emblems');
  assert.equal(attached.model.getObjectByName('native-tennis-sweatband-1').parent.parent.name, 'hand_r');
  assert.equal(attached.model.getObjectByName('native-sports-watch-face-1').parent.parent.name, 'hand_l');
  const alternateKitRig = sceneApi.makePlayer(0xc7baa2, 0x35413d);
  const alternateKit = humans.attachHumanPlayer(
    template, alternateKitRig, 0xc7baa2, undefined, undefined, nativeKit.BROADCAST_PLAYER_KITS[1], 1,
  );
  assert.equal(alternateKit.model.getObjectByName('native-tour-mark-2').userData.inventedLabel, 'MERIDIAN');
  if (gender === 'female') {
    assert.ok(alternateKit.model.getObjectByName('native-player-ponytail-2'));
    assert.ok(alternateKit.model.getObjectByName('native-player-hair-tie-2'));
    assert.equal(alternateKit.model.getObjectByName('native-player-neat-beard-2'), undefined,
      'WTA styling must never inherit the ATP beard option');
  } else {
    assert.ok(alternateKit.model.getObjectByName('native-player-neat-beard-2'));
    assert.ok(alternateKit.model.getObjectByName('native-player-stubble-2'));
    assert.equal(alternateKit.model.getObjectByName('native-player-ponytail-2'), undefined);
  }
  assert.ok(alternateKit.model.getObjectByName('native-tennis-sweatband-2'));
  assert.ok(alternateKit.model.getObjectByName('native-sports-watch-face-2'));
  // 53 native joints plus one roll-helper per upper arm, forearm and thigh.
  assert.equal([...pose.bones.keys()].filter(name => !name.includes('_twist_')).length, 53);
  assert.equal([...pose.bones.keys()].filter(name => name.includes('_twist_')).length, 6);
  assert.ok(pose.rest.get('spine_03').direction.y > 0.9,
    'upper spine must aim through the neck, not its first clavicle child');
  assert.equal(rig.root.getObjectByName('articulated-right-hand'), undefined);
  const nativeBody = attached.model.getObjectByName('Avery_|_anatomical_body');
  assert.deepEqual(nativeBody.geometry.getAttribute('position').array, source, 'body and hand surface must not be cut, grafted or curled');
  assert.ok(attached.model.getObjectByName('native-tennis-shirt').geometry.index.count > 100);
  assert.ok(attached.model.getObjectByName('native-tennis-shorts').geometry.index.count > 100);
  if (gender === 'female') assert.ok(attached.model.getObjectByName('native-tennis-skirt'));
  {
    // Regression: the shirt must cover the shoulder tops (bind y 1.38-1.43 m)
    // and must stop at the neck base (never the face).
    const shirt = attached.model.getObjectByName('native-tennis-shirt').geometry.getAttribute('position');
    let shoulderTop = 0, aboveNeck = 0;
    for (let i = 0; i < shirt.count; i++) {
      const x = Math.abs(shirt.getX(i)), y = shirt.getY(i);
      if (x > 0.1 && x < 0.2 && y > 1.39) shoulderTop++;
      if (y > 1.47) aboveNeck++;
    }
    assert.ok(shoulderTop > 20, 'shirt leaves the shoulder tops bare');
    assert.equal(aboveNeck, 0, 'shirt climbs above the neck base');
  }
  attached.model.traverse(o => {
    if (!(o instanceof THREE.SkinnedMesh)) return;
    assert.equal(o.skeleton, nativeBody.skeleton, 'garments share the complete body skeleton');
    const weights = o.geometry.getAttribute('skinWeight');
    for (let i = 0; i < weights.count; i += 17) {
      assert.ok(Math.abs(weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i) - 1) < 1e-4,
        'clipped garment edges must retain normalized skin weights');
    }
  });
  const offsets = new Map([...pose.bones].map(([name, bone]) => [name, bone.position.clone()]));
  for (const handedness of ['right', 'left']) for (const twoHanded of [false, true]) for (const angle of [0, 0.6, -0.8, 1.4]) {
    rig.root.userData.dominantHandedness = handedness;
    rig.root.userData.twoHandedGrip = twoHanded;
    const side = handedness === 'right' ? 'r' : 'l';
    rig.racket.position.set(side === 'r' ? -0.39 : 0.39, 1.12 + Math.sin(angle) * 0.2, 0.06);
    rig.racket.quaternion.setFromEuler(new THREE.Euler(0.42 + angle, angle * 0.2, 0.12));
    const requestedGrip = rig.racket.position.clone();
    attached.update();
    const actualGrip = rig.root.worldToLocal(grips[side].hand.localToWorld(grips[side].centre.clone()));
    // The racket is carried by the hand, and the hand still reaches the requested grip.
    close(actualGrip, rig.racket.position);
    // (one test pose sits 0.21 m from the shoulder, tighter than an elbow can fold around a held racket)
    assert.ok(actualGrip.distanceTo(requestedGrip) < 0.05, `${handedness} grip missed the requested racket position`);
    for (const [name, bone] of pose.bones) {
      assert.ok(bone.position.distanceTo(offsets.get(name)) < 1e-8, `${name}: native segment was stretched`);
      assert.ok(bone.matrixWorld.elements.every(Number.isFinite));
    }
  }
  for (const crouch of [0, 0.15, 0.3]) {
    rig.hip.position.y = 0.9 - crouch;
    rig.head.position.y = 1.73 - crouch * 1.7;
    attached.update();
    assert.ok(pose.point('head').y > pose.point('spine_03').y + 0.05,
      'serving and crouching must not fold the neck back into the shirt');
  }
  rig.body.rotation.set(0.28, -0.42, 0.2);
  attached.update();
  const bodyWorld = rig.root.getWorldQuaternion(new THREE.Quaternion());
  for (const name of ['spine_01', 'spine_02', 'spine_03']) {
    const expected = bodyWorld.clone().multiply(rig.body.quaternion).multiply(pose.rest.get(name).rotation);
    const actual = pose.bones.get(name).getWorldQuaternion(new THREE.Quaternion());
    assert.ok(actual.angleTo(expected) < 1e-5,
      `${name}: native torso must retain the DMO full-body lean and turn`);
  }
  for (const side of ['l', 'r']) for (const finger of ['index', 'middle', 'ring', 'pinky']) {
    grips[side].setClosed(true);
    const points = [1, 2, 3].map(i =>
      grips[side].hand.worldToLocal(pose.bones.get(`${finger}_0${i}_${side}`).getWorldPosition(new THREE.Vector3())));
    for (let i = 0; i < 2; i++) for (const t of [0.25, 0.5, 0.75, 1]) {
      const delta = points[i].clone().lerp(points[i + 1], t).sub(grips[side].centre);
      const radius = delta.addScaledVector(grips[side].shaft,
        -THREE.MathUtils.clamp(delta.dot(grips[side].shaft), -0.045, 0.135)).length();
      assert.ok(radius >= 0.019, `${side} ${finger}: finger bone crosses the handle`);
    }
  }
});

test('retargeted limb directions match the capture rather than its first-frame deltas', async () => {
  const template = await nativePlayerTemplate('male');
  const rig = sceneApi.makePlayer(0x275c77, 0x333333);
  const attached = humans.attachHumanPlayer(template, rig, 0x275c77);
  const sources = Object.fromEntries(await Promise.all([
    'forehand', 'backhand', 'serve', 'smash', 'volley-forehand', 'volley-backhand',
  ].map(async stroke => {
    const filename = stroke === 'smash' ? 'tennis-smash-jarua.bvh' : `tennis-${stroke}.bvh`;
    return [stroke, await readFile(new URL(`../public/models/dmo-humans/${filename}`, import.meta.url), 'utf8')];
  })));
  attached.pose.reset();
  const capture = new capturedGroundstroke.DmoCapturedGroundstroke(attached.model, rig.root, attached.pose.rest, sources);
  const contact = {
    forehand: 13.4,
    backhand: 9.28,
    serve: 2.56,
    'volley-forehand': 0.92,
    'volley-backhand': 0.90,
  };
  for (const stroke of ['forehand', 'backhand', 'serve', 'volley-forehand', 'volley-backhand']) {
    const source = new BVHLoader().parse(sources[stroke]);
    const mixer = new THREE.AnimationMixer(source.skeleton.bones[0]);
    mixer.clipAction(source.clip).play();
    for (const handedness of ['right', 'left']) for (const deltaSeconds of [-0.3, 0, 0.3]) {
      attached.pose.reset();
      capture.apply({ stroke, deltaSeconds, weight: 1, handedness, rootOffset: false });
      mixer.setTime(contact[stroke] + deltaSeconds);
      source.skeleton.bones[0].updateMatrixWorld(true);
      for (const [a, b, c, d] of [
        ['upperarm_l', 'lowerarm_l', 'LeftShoulder', 'LeftElbow'],
        ['lowerarm_r', 'hand_r', 'RightElbow', 'RightWrist'],
        ['thigh_l', 'calf_l', 'LeftHip', 'LeftKnee'],
        ['calf_r', 'foot_r', 'RightKnee', 'RightAnkle'],
        ['neck_01', 'head', 'Neck', 'Head'],
      ]) {
        const name = n => handedness === 'left' ? n.replace(/Left|Right/g, s => s === 'Left' ? 'Right' : 'Left') : n;
        const position = n => source.skeleton.bones.find(bone => bone.name === name(n))
          .getWorldPosition(new THREE.Vector3());
        const expected = position(d).sub(position(c)).normalize();
        if (handedness === 'left') expected.x *= -1;
        const actual = attached.pose.point(b).sub(attached.pose.point(a)).normalize();
        assert.ok(actual.dot(expected) > 0.999, `${stroke}/${handedness}/${deltaSeconds}: ${a} must follow capture axes`);
      }
    }
  }
});

test('the default live player uses the corrected free-arm plane instead of legacy elbow hints', async () => {
  const template = await nativePlayerTemplate('male');
  for (const handedness of ['right', 'left']) {
    const rig = sceneApi.makePlayer(0x275c77, 0x203d48);
    rig.root.userData.dominantHandedness = handedness;
    rig.root.userData.relaxedCarry = 1;
    const attached = humans.attachHumanPlayer(template, rig, 0x275c77);
    const support = handedness === 'right' ? 'l' : 'r';
    const sign = support === 'l' ? 1 : -1;
    const arm = support === 'l' ? rig.leftArm : rig.rightArm;
    const forearm = support === 'l' ? rig.leftForearm : rig.rightForearm;
    const shoulder = new THREE.Vector3(sign * 0.23, 1.44, 0);
    const wrist = new THREE.Vector3(sign * 0.22, 0.78, 0.05);
    const results = [];
    for (const legacyElbow of [
      new THREE.Vector3(sign * 0.6, 1.35, 0.2),
      new THREE.Vector3(sign * 0.25, 1.1, -0.1),
    ]) {
      sceneApi.poseLimb(arm, shoulder, legacyElbow);
      sceneApi.poseLimb(forearm, legacyElbow, wrist);
      attached.update();
      results.push(attached.pose.point(`lowerarm_${support}`).clone());
    }
    assert.ok(results[0].distanceTo(results[1]) < 1e-6,
      `${handedness}: the production default must ignore the old flared elbow hint`);
  }
});

test('the default live player applies recorded ready and locomotion arms', async () => {
  assert.equal(claudeNativePlayer.serveTossTuckWeight(42, 1), 1);
  assert.ok(claudeNativePlayer.serveTossTuckWeight(53, 1) > 0.2);
  assert.equal(claudeNativePlayer.serveTossTuckWeight(62, 1), 0);
  const template = await nativePlayerTemplate('male');
  const rig = sceneApi.makePlayer(0x275c77, 0x203d48);
  rig.root.userData.dominantHandedness = 'right';
  rig.root.userData.twoHandedGrip = false;
  rig.root.userData.supportHoldWeight = 0;
  const attached = humans.attachHumanPlayer(template, rig, 0x275c77);
  const armNames = ['clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l',
    'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r'];
  const rotations = () => new Map(armNames.map(name => [
    name, attached.pose.bones.get(name).quaternion.clone(),
  ]));

  rig.root.userData.readyArms = 1;
  rig.root.userData.readyTime = 0.3;
  attached.update();
  const readyPose = rotations();

  rig.root.userData.readyArms = 0;
  rig.root.userData.locomotionArms = 1;
  rig.root.userData.locomotionArmsSpeed = 1.3;
  rig.root.userData.locomotionPhase = 0.1;
  attached.update();
  const walkPoseA = rotations();
  rig.root.userData.locomotionPhase = 0.55;
  attached.update();
  const walkPoseB = rotations();

  assert.ok(armNames.some(name => readyPose.get(name).angleTo(walkPoseA.get(name)) > 0.02),
    'the default Claude player must use the recorded ready stance');
  assert.ok(armNames.some(name => walkPoseA.get(name).angleTo(walkPoseB.get(name)) > 0.02),
    'the default Claude player must follow the recorded step cycle');

  rig.root.userData.dominantHandedness = 'left';
  rig.root.userData.locomotionArms = 0;
  rig.root.userData.readyArms = 1;
  attached.update();
  const leftReadyPose = rotations();
  assert.ok(armNames.some(name => readyPose.get(name).angleTo(leftReadyPose.get(name)) > 0.02),
    'left-handed players must use the mirrored ready recording');
  rig.root.userData.readyArms = 0;
  rig.root.userData.locomotionArms = 1;
  rig.root.userData.locomotionPhase = 0.1;
  attached.update();
  const leftWalkPoseA = rotations();
  rig.root.userData.locomotionPhase = 0.55;
  attached.update();
  const leftWalkPoseB = rotations();
  assert.ok(armNames.some(name => leftWalkPoseA.get(name).angleTo(leftWalkPoseB.get(name)) > 0.02),
    'left-handed players must follow the mirrored recorded step cycle');
});

test('native grip survives repeated full-body resets and shoes use bind-relative axes', async () => {
  const template = await nativePlayerTemplate('male');
  for (const handedness of ['right', 'left']) {
    const rig = sceneApi.makePlayer(0x275c77, 0x333333);
    rig.root.userData.dominantHandedness = handedness;
    const attached = humans.attachHumanPlayer(template, rig, 0x275c77);
    const side = handedness === 'right' ? 'r' : 'l';
    const names = [...attached.pose.bones.keys()].filter(name =>
      /^(index|middle|ring|pinky|thumb)_/.test(name) && name.endsWith(`_${side}`));
    attached.grips[side].setClosed(true);
    const closed = names.map(name => attached.pose.bones.get(name).quaternion.clone());
    assert.ok(names.some((name, i) =>
      closed[i].angleTo(attached.pose.rest.get(name).local) > 0.1),
    'closed fingers must differ from the open bind pose');
    for (const stroke of [null, 'forehand', 'backhand', 'serve', null]) {
      rig.root.userData.groundstrokePlayback = stroke
        ? { stroke, deltaSeconds: 0, weight: 1, handedness, rootOffset: false }
        : undefined;
      for (let frame = 0; frame < 3; frame++) {
        attached.update();
        names.forEach((name, i) => assert.ok(
          attached.pose.bones.get(name).quaternion.toArray().every((value, j) =>
            Math.abs(value - closed[i].toArray()[j]) < 1e-9),
          `${stroke}/${handedness}/${frame}: pose reset must not reopen ${name}`,
        ));
        for (const [shoe, name] of [[rig.leftShoe, 'foot_r'], [rig.rightShoe, 'foot_l']]) {
          const expected = rig.root.getWorldQuaternion(new THREE.Quaternion()).invert()
            .multiply(attached.pose.bones.get(name).getWorldQuaternion(new THREE.Quaternion()))
            .multiply(attached.pose.rest.get(name).rotation.clone().invert()).normalize();
          assert.ok(shoe.quaternion.angleTo(expected) < 1e-6, 'shoes must remove the foot bind rotation');
          if (!stroke) assert.ok(shoe.quaternion.angleTo(new THREE.Quaternion()) < 1e-6,
            'neutral feet must leave the horizontal shoe geometry flat');
        }
      }
    }
  }
});

test('captured strokes and volleys animate the full body for either handedness', async () => {
  const template = await nativePlayerTemplate('male');
  const rig = sceneApi.makePlayer(0x275c77, 0x333333);
  const attached = humans.attachHumanPlayer(template, rig, 0x275c77);
  const inspected = ['spine_03', 'neck_01', 'upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r',
    'thigh_l', 'thigh_r', 'calf_l', 'calf_r', 'foot_l', 'foot_r'];
  for (const stroke of [
    'forehand', 'backhand', 'serve', 'volley-forehand', 'volley-backhand',
  ]) {
    for (const handedness of ['right', 'left']) {
      rig.root.userData.dominantHandedness = handedness;
      rig.root.userData.groundstrokePlayback = {
        stroke, deltaSeconds: 0, weight: 1, handedness, rootOffset: false,
      };
      const before = new Map(inspected.map((name) => {
        const bone = attached.pose.bones.get(name);
        return [name, {
          position: attached.pose.point(name),
          rotation: bone.getWorldQuaternion(new THREE.Quaternion()),
        }];
      }));
      attached.update();
      const changed = inspected.filter((name) => {
        const bone = attached.pose.bones.get(name);
        return attached.pose.point(name).distanceTo(before.get(name).position) > 0.005
          || bone.getWorldQuaternion(new THREE.Quaternion()).angleTo(before.get(name).rotation) > 0.005;
      });
      assert.ok(changed.includes('neck_01'), `${stroke}/${handedness}: recorded motion must reach the neck`);
      assert.ok(changed.some((name) => name.startsWith('upperarm_') || name.startsWith('lowerarm_')),
        `${stroke}/${handedness}: recorded motion must guide the arm chains`);
      assert.ok(changed.some((name) => name.startsWith('thigh_') || name.startsWith('calf_') || name.startsWith('foot_')),
        `${stroke}/${handedness}: recorded motion must move the lower body`);
      for (const [shoe, foot] of [[rig.leftShoe, 'foot_r'], [rig.rightShoe, 'foot_l']]) {
        const shoePosition = rig.root.worldToLocal(shoe.getWorldPosition(new THREE.Vector3()));
        assert.ok(shoePosition.distanceTo(attached.pose.point(foot)) < 0.1,
          `${stroke}/${handedness}: shoes must stay attached to animated feet`);
        assert.ok(shoe.quaternion.toArray().every(Number.isFinite));
      }
      for (const name of inspected) {
        assert.ok(attached.pose.bones.get(name).matrixWorld.elements.every(Number.isFinite));
      }
    }
  }
});

test('captured recovery compresses quick take-backs, limits trunk lean, and drives a wide lunge', async () => {
  const template = await nativePlayerTemplate('male');
  const rig = sceneApi.makePlayer(0x275c77, 0x333333);
  // Omit the variant argument: this is the player used by live broadcasts.
  const attached = humans.attachHumanPlayer(template, rig, 0x275c77);

  const playback = {
    stroke: 'forehand', handedness: 'right', deltaSeconds: -0.2, weight: 1,
    rootOffset: false, hands: 'one',
  };
  rig.root.userData.groundstrokePlayback = { ...playback, leadScale: 1 };
  attached.update();
  const ordinaryTakeBack = attached.pose.bones.get('hand_r').quaternion.clone();
  rig.root.userData.groundstrokePlayback = { ...playback, leadScale: 1.7 };
  attached.update();
  const quickTakeBack = attached.pose.bones.get('hand_r').quaternion.clone();
  assert.ok(ordinaryTakeBack.angleTo(quickTakeBack) > 0.02,
    'a compressed lead should sample a later recorded preparation pose');

  rig.root.userData.groundstrokePlayback = { ...playback, deltaSeconds: 0, leadScale: undefined };
  attached.update();
  const trunk = attached.pose.point('neck_01').sub(attached.pose.point('pelvis'));
  const lean = trunk.angleTo(new THREE.Vector3(0, 1, 0));
  assert.ok(lean <= THREE.MathUtils.degToRad(24.5),
    `captured trunk lean ${THREE.MathUtils.radToDeg(lean)}°`);

  rig.root.userData.groundstrokePlayback = undefined;
  delete rig.root.userData.lunge;
  attached.update();
  const neutralLeadingKnee = attached.pose.point('calf_l').x;
  rig.root.userData.lunge = { weight: 1, side: 1 };
  attached.update();
  assert.ok(attached.pose.point('calf_l').x > neutralLeadingKnee + 0.05,
    'the leading knee should move out over the foot on the ball side');
});

test('the production native player selects the one-handed clip only for one-handed backhands', async () => {
  const template = await nativePlayerTemplate('male');
  const rig = sceneApi.makePlayer(0x275c77, 0x333333);
  const attached = humans.attachHumanPlayer(template, rig, 0x275c77);
  const sample = (stroke, hands) => {
    rig.root.userData.groundstrokePlayback = {
      stroke,
      deltaSeconds: 0.15,
      weight: 1,
      handedness: 'right',
      hands,
      rootOffset: false,
    };
    attached.update();
    return ['hand_l', 'hand_r'].map(name => attached.pose.point(name));
  };
  const oneHandedBackhand = sample('backhand', 'one');
  const twoHandedBackhand = sample('backhand', 'two');
  assert.ok(oneHandedBackhand[0].distanceTo(twoHandedBackhand[0]) > 0.05
    || oneHandedBackhand[1].distanceTo(twoHandedBackhand[1]) > 0.05,
  'the Claude production player must select the new backhand motion when requested');
});

test('the captured one-handed clip changes ground backhands, not forehands', async () => {
  const template = await nativePlayerTemplate('male');
  const rig = sceneApi.makePlayer(0x275c77, 0x333333);
  const attached = humans.attachHumanPlayer(template, rig, 0x275c77);
  const sources = Object.fromEntries(await Promise.all([
    'forehand', 'backhand', 'serve', 'smash', 'volley-forehand', 'volley-backhand',
  ].map(async stroke => {
    const filename = stroke === 'smash' ? 'tennis-smash-jarua.bvh' : `tennis-${stroke}.bvh`;
    return [stroke, await readFile(new URL(`../public/models/dmo-humans/${filename}`, import.meta.url), 'utf8')];
  })));
  sources.backhandOne = await readFile(
    new URL('../public/models/dmo-humans/tennis-backhand-one.bvh', import.meta.url),
    'utf8',
  );
  const capture = new capturedGroundstroke.DmoCapturedGroundstroke(
    attached.model, rig.root, attached.pose.rest, sources,
  );
  const sample = (stroke, oneHanded, handedness = 'right') => {
    attached.pose.reset();
    capture.apply({
      stroke,
      deltaSeconds: 0.15,
      weight: 1,
      handedness,
      rootOffset: false,
      oneHanded,
    });
    return ['hand_l', 'hand_r'].map(name => attached.pose.point(name));
  };
  for (const handedness of ['right', 'left']) {
    const oneHandedBackhand = sample('backhand', true, handedness);
    const twoHandedBackhand = sample('backhand', false, handedness);
    assert.ok(oneHandedBackhand[0].distanceTo(twoHandedBackhand[0]) > 0.05
      || oneHandedBackhand[1].distanceTo(twoHandedBackhand[1]) > 0.05,
    `${handedness}-handed player must use the one-handed backhand sample`);
  }
  const oneHandedForehand = sample('forehand', true);
  const twoHandedForehand = sample('forehand', false);
  assert.ok(oneHandedForehand[0].distanceTo(twoHandedForehand[0]) < 1e-6
    && oneHandedForehand[1].distanceTo(twoHandedForehand[1]) < 1e-6,
  'the one-handed backhand option must not alter forehand motion');
});

test('the Jarua smash is a one-handed overhead and mirrors to left-handed players', async () => {
  const template = await nativePlayerTemplate('male');
  const rig = sceneApi.makePlayer(0x275c77, 0x333333);
  const attached = humans.attachHumanPlayer(template, rig, 0x275c77);
  const read = (filename) => readFile(
    new URL(`../public/models/dmo-humans/${filename}`, import.meta.url), 'utf8',
  );
  const sources = {
    forehand: await read('tennis-forehand.bvh'),
    backhand: await read('tennis-backhand.bvh'),
    serve: await read('tennis-serve.bvh'),
    smash: await read('tennis-smash-jarua.bvh'),
    'volley-forehand': await read('tennis-volley-forehand.bvh'),
    'volley-backhand': await read('tennis-volley-backhand.bvh'),
  };
  const capture = new capturedGroundstroke.DmoCapturedGroundstroke(
    attached.model, rig.root, attached.pose.rest, sources,
  );
  assert.equal(capture.hasSmash, true);
  for (const [handedness, side] of [['right', 'r'], ['left', 'l']]) {
    attached.pose.reset();
    capture.apply({
      stroke: 'forehand',
      deltaSeconds: 0,
      weight: 1,
      handedness,
      rootOffset: false,
      smash: true,
    });
    assert.ok(attached.pose.point(`hand_${side}`).y > attached.pose.point('head').y,
      `${handedness}: racket hand should be above the head at smash contact`);
    attached.pose.reset();
    capture.apply({
      stroke: 'forehand',
      deltaSeconds: 0,
      weight: 1,
      handedness,
      rootOffset: false,
    });
    assert.ok(attached.pose.point(`hand_${side}`).y < attached.pose.point('head').y,
      `${handedness}: ordinary forehand contact should remain below the head`);
  }
});

test('missing optional clips retain normal stroke behavior and keep the player loading', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const filename = new URL(String(input), 'https://forum.test').pathname.split('/').pop();
    if (filename === 'tennis-backhand-one.bvh' || filename === 'tennis-smash-jarua.bvh') {
      return new Response('missing', { status: 404 });
    }
    const bytes = await readFile(new URL(`../public/models/dmo-humans/${filename}`, import.meta.url));
    return new Response(bytes);
  };
  try {
    const template = await humans.loadHumanModel('male', 'player', new AbortController().signal);
    const rig = sceneApi.makePlayer(0x275c77, 0x333333);
    const attached = humans.attachHumanPlayer(template, rig, 0x275c77);
    assert.equal(rig.root.userData.capturedSmash, false);
    rig.root.userData.groundstrokePlayback = {
      stroke: 'forehand',
      deltaSeconds: 0,
      weight: 1,
      handedness: 'right',
      smash: true,
      rootOffset: false,
    };
    assert.doesNotThrow(() => attached.update(), 'missing Jarua motion must leave the player usable');
    const smashFallback = ['hand_l', 'hand_r'].map(name => attached.pose.point(name).clone());
    rig.root.userData.groundstrokePlayback = {
      stroke: 'forehand',
      deltaSeconds: 0,
      weight: 1,
      handedness: 'right',
      rootOffset: false,
    };
    attached.update();
    for (const [index, name] of ['hand_l', 'hand_r'].entries()) {
      assert.ok(smashFallback[index].distanceTo(attached.pose.point(name)) < 1e-6,
        `missing smash asset falls back to the existing ${name} forehand pose`);
    }
    rig.root.userData.groundstrokePlayback = {
      stroke: 'backhand',
      deltaSeconds: 0,
      weight: 1,
      handedness: 'right',
      hands: 'one',
      rootOffset: false,
    };
    assert.doesNotThrow(() => attached.update());
  } finally {
    globalThis.fetch = originalFetch;
  }
});

for (const gender of ['male', 'female']) {
  test(`${gender} model is a bounded, textured CC0 skeletal asset`, async () => {
    const model = await asset(gender);
    const box = new THREE.Box3().setFromObject(model);
    assert.ok(box.max.y > 1.5 && box.max.y < 1.9);
    let mesh;
    model.traverse((object) => { if (object instanceof THREE.SkinnedMesh) mesh = object; });
    assert.ok(mesh);
    assert.ok(mesh.geometry.index.count / 3 <= 14000);
    const weights = mesh.geometry.getAttribute('skinWeight');
    for (let i = 0; i < weights.count; i += 37) {
      assert.ok(Math.abs(weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i) - 1) < 0.001);
    }
    const manifest = JSON.parse(await readFile(new URL('../public/models/dmo-humans/provenance.json', import.meta.url)));
    assert.equal(manifest.find((entry) => entry.filename === `${gender}-player.glb`).license, 'CC0-1.0');
  });

  test(`${gender} skeleton follows DMO joints after court rotation and translation`, async () => {
    const rig = sceneApi.makePlayer(0xffffff, 0x000000, gender === 'female');
    rig.root.position.set(-11.8, 0, 2.1);
    rig.root.rotation.y = Math.PI / 2;
    const template = await asset(gender);
    let sourceHandMesh;
    template.traverse((object) => {
      if (object instanceof THREE.SkinnedMesh) sourceHandMesh = object.geometry.getAttribute('position').array.slice();
    });
    const attached = humans.attachHumanPlayer(template, rig, 0x5979a0);
    attached.model.traverse((object) => {
      if (!(object instanceof THREE.SkinnedMesh)) return;
      assert.deepEqual(object.geometry.getAttribute('position').array, sourceHandMesh,
        'unarticulated fingers must retain their original surface');
    });
    for (const handY of [0.9, 1.45, 2.1, 0.6]) {
      sceneApi.poseLimb(rig.leftArm, new THREE.Vector3(0.21, 1.4, 0), new THREE.Vector3(0.31, 1.15, 0.1));
      sceneApi.poseLimb(rig.leftForearm, new THREE.Vector3(0.31, 1.15, 0.1), new THREE.Vector3(0.4, 1.0, 0.25));
      sceneApi.poseLimb(rig.rightArm, new THREE.Vector3(-0.21, 1.4, 0), new THREE.Vector3(-0.32, 1.25, 0.15));
      sceneApi.poseLimb(rig.rightForearm, new THREE.Vector3(-0.32, 1.25, 0.15), new THREE.Vector3(-0.4, handY, 0.3));
      for (const [side, sign] of [['left', -1], ['right', 1]]) {
        sceneApi.poseLimb(rig[`${side}Leg`], new THREE.Vector3(sign * 0.13, 0.9, 0), new THREE.Vector3(sign * 0.2, 0.45, 0.08));
        sceneApi.poseLimb(rig[`${side}Calf`], new THREE.Vector3(sign * 0.2, 0.45, 0.08), new THREE.Vector3(sign * 0.25, 0.1, 0.02));
      }
      rig.racket.position.set(-0.4, handY, 0.3);
      attached.update();
      const hand = attached.model.getObjectByName('RightHand');
      close(rig.root.worldToLocal(hand.getWorldPosition(new THREE.Vector3())), new THREE.Vector3(-0.4, handY, 0.3));
      attached.model.traverse((object) => {
        if (object instanceof THREE.Bone) assert.ok(object.matrixWorld.elements.every(Number.isFinite));
      });
    }
    rig.root.userData.dominantHandedness = 'left';
    attached.update();
    const leftHand = attached.model.getObjectByName('LeftHand');
    assert.ok(leftHand.matrixWorld.elements.every(Number.isFinite));
    assert.equal(rig.body.visible, false);
    assert.equal(rig.racket.visible, true);
    assert.equal(rig.leftShoe.visible, true);
    assert.ok(rig.leftShoe.getObjectByName('tennis-sock'));
    attached.model.traverse((object) => {
      if (!(object instanceof THREE.SkinnedMesh)) return;
      const indices = object.geometry.index, positions = object.geometry.getAttribute('position');
      for (let i = 0; i < indices.count; i += 3) {
        assert.ok(Math.max(...[0, 1, 2].map((j) => positions.getY(indices.getX(i + j)))) >= 0.115);
      }
    });
    assert.equal(attached.model.visible, true);
    humans.disposeHumanModel(attached.model);
  });
}

test('tennis handle crosses the palm while the ready palm faces down', () => {
  const racket = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, -0.25, 0.3));
  const shaft = new THREE.Vector3(0, 1, 0).applyQuaternion(racket);
  const right = racketPose.racketHandFrame(racket, false);
  const left = racketPose.racketHandFrame(racket, true);
  close(racketPose.HAND_GRIP_SHAFT.clone().applyQuaternion(right), shaft);
  const mirroredShaft = racketPose.HAND_GRIP_SHAFT.clone(); mirroredShaft.x *= -1;
  close(mirroredShaft.applyQuaternion(left), shaft);
  const rightPalm = new THREE.Vector3(0, 0, -1).applyQuaternion(right);
  const leftPalm = new THREE.Vector3(0, 0, -1).applyQuaternion(left);
  const racketFace = new THREE.Vector3(0, 0, 1).applyQuaternion(racket);
  assert.ok(rightPalm.dot(racketFace) > 0.999);
  assert.ok(leftPalm.dot(racketFace) > 0.999);
  const fingerDirection = new THREE.Vector3(0, 1, 0).applyQuaternion(right);
  assert.ok(Math.abs(fingerDirection.dot(shaft)) < 0.4, 'fingers must wrap across, not run along, the shaft');
  const ready = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.42, 0, 0));
  for (const left of [false, true]) {
    const palm = new THREE.Vector3(0, 0, -1).applyQuaternion(racketPose.racketHandFrame(ready, left));
    assert.ok(palm.y < -0.4, 'the ready palm must cover the handle from above');
  }
});

test('ready grip bends the arm instead of forcing a right-angle wrist', () => {
  for (const left of [false, true]) {
    const side = left ? 1 : -1;
    const shoulder = new THREE.Vector3(side * 0.39 * 0.59, 1.44, 0);
    const grip = new THREE.Vector3(side * 0.39, 1.12, 0.06);
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.42, 0, -side * 0.12));
    const wrist = racketPose.racketGripWrist(grip, rotation, left);
    const elbow = racketPose.racketGripElbow(shoulder, wrist, rotation, left);
    assert.ok(Math.abs(elbow.distanceTo(shoulder) - 0.31) < 1e-6);
    assert.ok(Math.abs(elbow.distanceTo(wrist) - 0.29) < 1e-6);
    const forearm = wrist.clone().sub(elbow).normalize();
    const handDirection = new THREE.Vector3(0, 1, 0).applyQuaternion(racketPose.racketHandFrame(rotation, left));
    assert.ok(forearm.dot(handDirection) > 0.85, 'the hand must continue the forearm without a sharp wrist bend');
  }
});

test('finger-jointed hands wrap the actual shaft and oppose it with the thumb', async () => {
    const template = await articulatedHandAsset();
    const center = racketPose.HAND_GRIP_CENTER.clone();
    const shaft = racketPose.HAND_GRIP_SHAFT.clone();
    const radius = 0.019;
    const point = (hand, name) => hand.joints.get(name).bone.position.clone()
      .sub(hand.joints.get('wrist').bone.position).applyQuaternion(handCanonical);
    const radialDistance = value => {
      const offset = value.clone().sub(center);
      return offset.addScaledVector(shaft, -offset.dot(shaft)).length();
    };
    for (const left of [false, true]) {
      const hand = articulated.makeArticulatedHand(template, left);
      assert.equal(hand.joints.size, 25);
      const tip = hand.joints.get('middle-finger-tip'), before = tip.bone.position.clone();
      let vertices;
      hand.model.traverse(o => { if (o instanceof THREE.SkinnedMesh) vertices = o.geometry.getAttribute('position').array.slice(); });
      hand.setGrip(true, { center, shaft, radius });
      assert.ok(tip.bone.position.distanceTo(before) > 0.015,
        'the grip pose must flex the finger chain around the handle');
      hand.joints.forEach(j => assert.ok([...j.bone.position.toArray(), ...j.bone.quaternion.toArray()].every(Number.isFinite)));
      hand.model.traverse(o => { if (o instanceof THREE.SkinnedMesh) assert.deepEqual(o.geometry.getAttribute('position').array, vertices); });
      let nearHandleSamples = 0;
      for (const prefix of ['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger']) {
        const names = ['phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip']
          .map(part => `${prefix}-${part}`);
        for (let segment = 0; segment < 3; segment++) {
          const from = point(hand, names[segment]);
          const to = point(hand, names[segment + 1]);
          for (const fraction of [0.25, 0.5, 0.75, 1]) {
            const distance = radialDistance(from.clone().lerp(to, fraction));
            assert.ok(distance >= radius - 0.001, `${prefix} must not penetrate the handle`);
            if (distance <= radius + 0.018) nearHandleSamples++;
          }
        }
      }
      assert.ok(nearHandleSamples >= 8, 'multiple finger segments must follow the handle surface');
      const thumbDistance = radialDistance(point(hand, 'thumb-tip'));
      assert.ok(Math.abs(thumbDistance - (radius + 0.006)) < 0.014,
        `thumb must oppose the fingers on the handle (${thumbDistance.toFixed(3)} m)`);
      const closedTip = tip.bone.position.clone();
      hand.setGrip(false);
      close(tip.bone.position, before);
      hand.setGrip(true, { center, shaft, radius });
      close(tip.bone.position, closedTip);
      hand.setGrip(false);
      close(tip.bone.position, before);
    }
});

test('attached dominant hand tracks the transformed racket grip', async () => {
  const rig = sceneApi.makePlayer(0xffffff, 0x000000, false);
  rig.root.position.set(-11.8, 0, 2.1);
  rig.root.rotation.y = Math.PI / 2;
  rig.root.userData.dominantHandedness = 'right';
  rig.root.userData.twoHandedGrip = false;
  rig.racket.position.set(0.39, 1.1, 0.04);
  rig.racket.quaternion.setFromEuler(new THREE.Euler(0.35, -0.2, 0.4));

  const body = new THREE.Group();
  const leftWrist = new THREE.Bone();
  leftWrist.name = 'LeftHand';
  body.add(leftWrist);
  const rightWrist = new THREE.Bone();
  rightWrist.name = 'RightHand';
  rightWrist.position.copy(racketPose.racketGripWrist(
    rig.racket.position, rig.racket.quaternion, false,
  ));
  rightWrist.quaternion.copy(racketPose.racketHandFrame(rig.racket.quaternion, false));
  body.add(rightWrist);
  rig.root.add(body);

  const updateHands = articulated.attachArticulatedHands(
    await articulatedHandAsset(), rig, body,
  );
  updateHands();
  rig.root.updateMatrixWorld(true);

  const hand = rig.root.getObjectByName('articulated-right-hand');
  assert.ok(hand, 'dominant articulated hand should be attached');
  const gripWorld = rig.racket.getWorldPosition(new THREE.Vector3());
  const localGrip = hand.worldToLocal(gripWorld.clone());
  close(localGrip, racketPose.HAND_GRIP_CENTER);
  const racketRotation = rig.racket.getWorldQuaternion(new THREE.Quaternion());
  const shaft = new THREE.Vector3(0, 1, 0).applyQuaternion(racketRotation).normalize();
  const shaftEnd = hand.worldToLocal(gripWorld.clone().add(shaft));
  const localShaft = shaftEnd.sub(localGrip).normalize();
  close(localShaft, racketPose.HAND_GRIP_SHAFT);

  const center = gripWorld;
  const radialDistance = point => {
    const offset = point.clone().sub(center);
    return offset.addScaledVector(shaft, -offset.dot(shaft)).length();
  };
  const contacts = [];
  for (const prefix of ['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger']) {
    for (const part of ['phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip']) {
      const joint = hand.getObjectByName(`${prefix}-${part}`);
      assert.ok(joint, `missing ${prefix}-${part}`);
      contacts.push(radialDistance(joint.getWorldPosition(new THREE.Vector3())));
    }
  }
  assert.ok(Math.min(...contacts) >= 0.018, 'attached fingers must not pass through the racket handle');
  assert.ok(Math.min(...contacts) <= 0.04, 'attached fingers must remain close enough to grip the handle');
  const thumb = hand.getObjectByName('thumb-tip');
  assert.ok(Math.abs(radialDistance(thumb.getWorldPosition(new THREE.Vector3())) - 0.025) < 0.014);
});

test('racket face follows ball flight while retaining the contact shaft axis', () => {
  for (const sign of [-1, 1]) {
    const shaft = new THREE.Vector3(sign * 0.9, 0.35, 0).normalize();
    const flight = new THREE.Vector3(0, 0.08, 1).normalize();
    const rotation = racketPose.racketContactOrientation(shaft, flight);
    close(new THREE.Vector3(0, 1, 0).applyQuaternion(rotation), shaft);
    const expectedNormal = flight.clone().addScaledVector(shaft, -flight.dot(shaft)).normalize();
    close(new THREE.Vector3(0, 0, 1).applyQuaternion(rotation), expectedNormal);
  }
  for (const flight of [new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]) {
    const rotation = racketPose.racketContactOrientation(new THREE.Vector3(0, 1, 0), flight);
    assert.ok(rotation.toArray().every(Number.isFinite));
  }
});

test('crowd uses seated textured instancing and retains gaze/applause updates', async () => {
  const scene = new THREE.Scene();
  const oldCrowd = sceneApi.buildCrowd(scene);
  const batches = crowds.attachHumanCrowd(scene, oldCrowd, [await asset('male', 'crowd'), await asset('female', 'crowd')]);
  const occupiedSeats = oldCrowd.seats.filter((seat) => seat.occupied);
  assert.equal(batches.length, 96, 'eight appearance variants cover both body models and six poses');
  assert.ok(occupiedSeats.length < oldCrowd.seats.length, 'some seats remain empty');
  assert.ok(batches.every((mesh) => mesh.instanceMatrix.count <= Math.max(
    16, Math.ceil(oldCrowd.seats.length / 4),
  )), 'appearance batches avoid allocating full-capacity crowd buffers each');
  assert.equal(batches.reduce((sum, mesh) => sum + mesh.count, 0), occupiedSeats.length);
  const shoes = scene.getObjectByName('wtsl-detailed-crowd-shoes');
  assert.ok(shoes?.isInstancedMesh);
  assert.equal(shoes.count, occupiedSeats.length * 2);
  assert.equal(scene.getObjectByName('wtsl-spectator-heads').visible, false);
  oldCrowd.update(2, true, new THREE.Vector3(11, 0.5, 5));
  assert.ok(batches.some((mesh, index) => index % 6 >= 3 && mesh.count > 0));
  assert.equal(batches.reduce((sum, mesh) => sum + mesh.count, 0), occupiedSeats.length);
  for (const mesh of batches) {
    assert.ok(mesh.geometry.boundingBox.max.y > 1.2);
    assert.ok(mesh.geometry.boundingBox.max.y < 1.7);
    assert.equal(mesh.castShadow, false);
  }
  const caps = scene.getObjectByName('wtsl-crowd-caps');
  assert.ok(caps, 'some spectators wear caps');
  assert.equal(caps.count,
    oldCrowd.seats.filter((seat) => seat.occupied && seat.sourceIndex % 17 === 7).length,
    'empty seats do not receive floating caps');
  oldCrowd.setDensity(0);
  oldCrowd.update(2.2, false);
  assert.equal(shoes.count, 0, 'detailed footwear follows an empty crowd');
  oldCrowd.setDensity(1);
  oldCrowd.update(2.4, false);
  assert.equal(shoes.count, oldCrowd.seats.length * 2, 'every detailed spectator keeps both shoes');
});

test('coaches occupy reserved lower-stand seats and the seated umpire tracks the ball', async () => {
  const scene = new THREE.Scene();
  const fixtures = sceneApi.buildCourtFixtures(scene);
  const crowd = sceneApi.buildCrowd(scene);
  const male = await asset('male', 'crowd');
  const female = await asset('female', 'crowd');
  crowds.attachHumanCourtStaff(scene, fixtures, [male, female], crowd);
  assert.ok(scene.getObjectByName('wtsl-court-coach-1'));
  assert.ok(scene.getObjectByName('wtsl-court-coach-2'));
  for (const index of [1, 2]) {
    const space = scene.getObjectByName(`wtsl-coach-space-${index}`);
    assert.equal(space.userData.offCourt, true);
    assert.equal(space.userData.seatRow, 1);
    assert.ok(Math.abs(space.position.z) > 13);
  }
  assert.equal(scene.getObjectByName('wtsl-player-bench-left').getObjectByName('wtsl-court-coach-1'), undefined);
  assert.equal(scene.getObjectByName('wtsl-player-bench-right').getObjectByName('wtsl-court-coach-2'), undefined);
  assert.equal(scene.getObjectByName('wtsl-umpire-placeholder').visible, false);
  const umpire = scene.getObjectByName('wtsl-detailed-umpire');
  assert.equal(umpire.userData.role, 'chair-umpire');
  assert.equal(scene.getObjectByName('wtsl-umpire-badge').userData.role, 'chair-umpire-identification');
  const posedBones = new Map();
  umpire.traverse((object) => {
    if (object.isBone) posedBones.set(object.name, object);
  });
  const foot = posedBones.get('LeftFoot').getWorldPosition(new THREE.Vector3());
  const knee = posedBones.get('LeftLeg').getWorldPosition(new THREE.Vector3());
  const hip = posedBones.get('Hips').getWorldPosition(new THREE.Vector3());
  assert.ok(foot.y >= 1.0 && foot.y <= 1.04, `umpire foot should rest near the raised chair footrest, got ${foot.y}`);
  assert.ok(
    knee.y > foot.y + 0.25 && knee.y < foot.y + 0.30 && knee.y < hip.y - 0.04,
    `umpire legs should stay tucked between the seated hip and raised footrest (foot=${foot.y}, knee=${knee.y}, hip=${hip.y})`,
  );
  const head = umpire.getObjectByName('Head');
  const before = head.quaternion.clone();
  fixtures.update(new THREE.Vector3(7, 2, -10));
  assert.ok(head.quaternion.angleTo(before) > 0.01);
});

test('native player model supports the same landmark pose used for a detailed umpire', async () => {
  const template = await asset('male', 'player');
  const space = new THREE.Group();
  space.add(template);
  assert.doesNotThrow(() => new humans.HumanPose(template, space));
});

test('limb roll is spread along helper twist bones without changing hand or forearm orientation', async () => {
  const template = await nativePlayerTemplate('male');
  const rig = sceneApi.makePlayer(0x275c77, 0x333333);
  const attached = humans.attachHumanPlayer(template, rig, 0x275c77);
  const { pose } = attached;
  const twist = await loadTs('../components/DmoNativeTwist.ts');
  attached.update();
  const roll = new THREE.Quaternion().setFromAxisAngle(
    pose.bones.get('hand_r').position.clone().normalize(), 1.4);
  pose.bones.get('lowerarm_r').quaternion.multiply(roll);
  pose.model.updateMatrixWorld(true);
  const before = ['lowerarm_r', 'hand_r', 'calf_r'].map(n => pose.bones.get(n).getWorldQuaternion(new THREE.Quaternion()));
  const positions = ['lowerarm_r', 'hand_r', 'middle_01_r'].map(n => pose.point(n));
  twist.distributeNativeTwist(pose.bones, pose.rest);
  pose.model.updateMatrixWorld(true);
['hand_r', 'calf_r'].forEach((n, i) => assert.ok(
    pose.bones.get(n).getWorldQuaternion(new THREE.Quaternion()).angleTo(before[i + 1]) < 1e-3, `${n} orientation changed`));
  ['lowerarm_r', 'hand_r', 'middle_01_r'].forEach((n, i) => assert.ok(pose.point(n).distanceTo(positions[i]) < 1e-6, `${n} moved`));
  // The forearm bone becomes a pure hinge; its helper now carries the roll.
  const helper = pose.bones.get('lowerarm_twist_r');
  assert.ok(2 * Math.acos(Math.min(1, Math.abs(helper.quaternion.w))) > 0.8, 'forearm roll was not moved to its helper');
  const lowerNow = pose.bones.get('lowerarm_r').getWorldQuaternion(new THREE.Quaternion());
  assert.ok(lowerNow.angleTo(before[0]) > 0.8, 'forearm bone still carries the roll');
});

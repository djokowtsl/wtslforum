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
const sceneApi = await loadTs('../components/DmoLiveCourt3DScene.ts', {
  './DmoStadiumArchitecture': stadiumArchitectureApi,
});
const racketPose = await loadTs('../components/DmoRacketOrientation.ts');
const articulated = await loadTs('../components/DmoArticulatedHands.ts', { './DmoRacketOrientation': racketPose });
const nativeGrip = await loadTs('../components/DmoNativeGrip.ts');
const nativeTwist = await loadTs('../components/DmoNativeTwist.ts');
const capturedGroundstroke = await import('../components/DmoCapturedGroundstroke.ts');
const nativeKit = await loadTs('../components/DmoNativeKit.ts');
const groundstrokeRig = await loadTs('../components/DmoGroundstrokeRig.ts', { './DmoRacketOrientation': racketPose });
const nativePlayer = await loadTs('../components/DmoNativePlayer.ts', {
  './DmoRacketOrientation': racketPose, './DmoNativeGrip': nativeGrip, './DmoNativeKit': nativeKit,
  './DmoNativeTwist': nativeTwist,
  './DmoCapturedGroundstroke': capturedGroundstroke,
  './DmoGroundstrokeRig': groundstrokeRig,
});
const claudeNativePlayer = await loadTs('../components/DmoNativePlayerClaude.ts', {
  './DmoRacketOrientation': racketPose, './DmoNativeGrip': nativeGrip, './DmoNativeKit': nativeKit,
  './DmoNativeTwist': nativeTwist,
  './DmoCapturedGroundstroke': capturedGroundstroke,
});
const humans = await loadTs('../components/DmoHumanModels.ts', {
  './DmoRacketOrientation': racketPose, './DmoArticulatedHands': articulated, './DmoNativePlayer': nativePlayer,
  './DmoNativePlayerClaude': claudeNativePlayer,
});
const crowdLodApi = await loadTs('../lib/dmoCrowdLod.ts');
const crowds = await loadTs('../components/DmoHumanCrowd.ts', {
  './DmoHumanModels': humans, '../lib/dmoCrowdLod': crowdLodApi,
});

test('high-detail spectators use the clothed CC0 player assets', () => {
  assert.equal(humans.humanModelAssetFilename('male', 'crowd-high'), 'male-player.glb');
  assert.equal(humans.humanModelAssetFilename('female', 'crowd-high'), 'female-player.glb');
  assert.equal(humans.humanModelAssetFilename('male', 'crowd'), 'male-crowd.glb');
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

test('Claude full-body rewrite is the default production player', async () => {
  const template = await nativePlayerTemplate('male');
  const rig = sceneApi.makePlayer(0x275c77, 0x333333);
  const attached = humans.attachHumanPlayer(template, rig, 0x275c77);
  assert.equal(attached.model.name, 'wtsl-continuous-player-claude');
  assert.equal(typeof attached.update, 'function');
  attached.update();
  assert.ok([...attached.pose.bones.values()].every((bone) =>
    bone.matrixWorld.elements.every(Number.isFinite)));
});

test('serve tossing arm blends from the lift into a front tuck through landing', () => {
  const tuck = claudeNativePlayer.serveTossTuckWeight;
  assert.equal(tuck(-11, 1), 0);
  assert.equal(tuck(-1, 1), 1);
  assert.equal(tuck(0, 1), 1);
  assert.ok(tuck(25, 1) > 0 && tuck(25, 1) < 1);
  assert.equal(tuck(34, 1), 0);
  assert.equal(tuck(0, 0.4), 0.4);
});

test('Claude support hand chooses a low-strain, continuous throat cradle', async () => {
  const template = await nativePlayerTemplate('male');
  for (const handedness of ['right', 'left']) {
    const rig = sceneApi.makePlayer(0x275c77, 0x333333);
    rig.root.userData.dominantHandedness = handedness;
    rig.root.userData.waitingPose = true;
    rig.root.userData.twoHandedGrip = false;
    rig.root.userData.supportHoldWeight = 1;
    rig.root.userData.supportGripOffset = 0.11;
    rig.racket.position.set(handedness === 'right' ? -0.22 : 0.22, 1, 0.32);
    const shaft = new THREE.Vector3(handedness === 'right' ? 0.18 : -0.18, 0.32, 0.93).normalize();
    rig.racket.quaternion.copy(racketPose.racketContactOrientation(
      shaft, new THREE.Vector3(0, 1, 0).cross(shaft),
    ));
    const attached = humans.attachHumanPlayer(template, rig, 0x275c77);
    const support = handedness === 'right' ? 'l' : 'r';
    let previous;
    let finalRoll = 0;
    for (let frame = 0; frame < 36; frame += 1) {
      attached.update();
      const hand = attached.pose.rotation(`hand_${support}`);
      if (previous) assert.ok(hand.angleTo(previous) < 0.4, 'cradle orientation must not jump between frames');
      previous = hand.clone();
      const neutral = attached.pose.rotation(`lowerarm_${support}`)
        .multiply(attached.pose.rest.get(`lowerarm_${support}`).rotation.clone().invert())
        .multiply(attached.pose.rest.get(`hand_${support}`).rotation);
      const forearm = attached.pose.point(`hand_${support}`)
        .sub(attached.pose.point(`lowerarm_${support}`)).normalize();
      finalRoll = Math.abs(nativeTwist.twistAngle(
        hand.clone().multiply(neutral.clone().invert()), forearm,
      ));
    }
    assert.ok(finalRoll < 1.4, `${handedness}: free forearm roll should stay below ${finalRoll.toFixed(2)} radians`);
  }
});

test('Claude stroke hand selection overrides stale grip state and wrist roll stays continuous', async () => {
  const template = await nativePlayerTemplate('male');
  const rig = sceneApi.makePlayer(0x275c77, 0x333333);
  rig.root.userData.dominantHandedness = 'right';
  rig.racket.position.set(-0.39, 1.18, 0.06);
  const attached = humans.attachHumanPlayer(template, rig, 0x275c77);
  const support = 'l';

  rig.root.userData.twoHandedGrip = true;
  rig.root.userData.groundstrokePlayback = {
    stroke: 'backhand', handedness: 'right', deltaSeconds: 0, weight: 1,
    rootOffset: false, hands: 'one',
  };
  attached.update();
  for (const name of attached.pose.bones.keys()) {
    if (/^(index|middle|ring|pinky|thumb)_/.test(name) && name.endsWith(`_${support}`)) {
      const roll = attached.pose.bones.get(name).quaternion.angleTo(attached.pose.rest.get(name).local);
      assert.ok(roll < 1e-3,
        `${name}: explicit one-handed playback must release the support fingers (angle ${roll})`);
    }
  }

  delete rig.root.userData.groundstrokePlayback;
  rig.root.userData.twoHandedGrip = false;
  rig.racket.quaternion.identity();
  attached.update();
  const side = 'r';
  const axis = attached.pose.point(`hand_${side}`)
    .sub(attached.pose.point(`lowerarm_${side}`)).normalize();
  const neutral = attached.pose.rotation(`lowerarm_${side}`)
    .multiply(attached.pose.rest.get(`lowerarm_${side}`).rotation.clone().invert())
    .multiply(attached.pose.rest.get(`hand_${side}`).rotation);
  const localRacket = racketPose.racketContactOrientation(
    attached.grips[side].shaft, attached.grips[side].palm,
  );
  const handFrames = [];
  for (const roll of [3.05, -3.05]) {
    const desired = new THREE.Quaternion().setFromAxisAngle(axis, roll).multiply(neutral);
    rig.racket.quaternion.copy(desired.multiply(localRacket));
    attached.update();
    handFrames.push(attached.pose.rotation(`hand_${side}`));
  }
  assert.ok(handFrames[0].angleTo(handFrames[1]) < 0.2,
    'equivalent wrist orientations across the ±π boundary should not flip');
});

async function articulatedHandAsset() {
  const bytes = await readFile(new URL('../public/models/dmo-humans/articulated-hand.glb', import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '',
  );
  return gltf.scene;
}

const close = (actual, expected) => assert.ok(actual.distanceTo(expected) < 0.00001,
  `${actual.toArray()} differs from ${expected.toArray()}`);
const handCanonical = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
  new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, 0, 0),
));

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
  const shirt = attached.model.getObjectByName('native-tennis-shirt').geometry.getAttribute('position');
  let shoulderTop = 0, aboveNeck = 0;
  for (let i = 0; i < shirt.count; i++) {
    const x = Math.abs(shirt.getX(i)), y = shirt.getY(i);
    if (x > 0.1 && x < 0.2 && y > 1.39) shoulderTop++;
    if (y > 1.47) aboveNeck++;
  }
  assert.ok(shoulderTop > 20, 'shirt should cover shoulder tops');
  assert.equal(aboveNeck, 0, 'shirt should stop at the neck base');
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
    const waitingPose = !twoHanded && angle === 0;
    rig.root.userData.dominantHandedness = handedness;
    rig.root.userData.twoHandedGrip = twoHanded;
    rig.root.userData.waitingPose = waitingPose;
    rig.root.userData.supportGripOffset = twoHanded || waitingPose ? 0.2 : undefined;
    rig.root.userData.supportHoldWeight = waitingPose ? 1 : 0;
    const side = handedness === 'right' ? 'r' : 'l';
    rig.racket.position.set(side === 'r' ? -0.39 : 0.39, 1.12 + Math.sin(angle) * 0.2, 0.06);
    rig.racket.quaternion.setFromEuler(new THREE.Euler(0.42 + angle, angle * 0.2, 0.12));
    const requestedGrip = rig.racket.position.clone();
    attached.update();
    const actualGrip = rig.root.worldToLocal(grips[side].hand.localToWorld(grips[side].centre.clone()));
    close(actualGrip, rig.racket.position);
    assert.ok(actualGrip.distanceTo(requestedGrip) < 0.05,
      `${handedness} grip missed the requested racket position`);
    if ((twoHanded || waitingPose) && angle === 0) {
      const support = side === 'r' ? 'l' : 'r';
      const target = rig.racket.position.clone().add(
        new THREE.Vector3(0, 0.2, 0).applyQuaternion(rig.racket.quaternion),
      );
      const actualSupport = rig.root.worldToLocal(
        grips[support].hand.localToWorld(grips[support].centre.clone()),
      );
      assert.ok(actualSupport.distanceTo(target) < 0.05,
        `${handedness} support hand missed the racket throat`);
    }
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
  const sources = Object.fromEntries(await Promise.all(['forehand', 'backhand', 'serve'].map(async stroke =>
    [stroke, await readFile(new URL(`../public/models/dmo-humans/tennis-${stroke}.bvh`, import.meta.url), 'utf8')])));
  attached.pose.reset();
  const capture = new capturedGroundstroke.DmoCapturedGroundstroke(attached.model, rig.root, attached.pose.rest, sources);
  const contact = { forehand: 13.4, backhand: 9.28, serve: 2.56 };
  for (const stroke of Object.keys(sources)) {
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

test('captured forehands, backhands, and serves animate the full body for either handedness', async () => {
  const template = await nativePlayerTemplate('male');
  const rig = sceneApi.makePlayer(0x275c77, 0x333333);
  const attached = humans.attachHumanPlayer(template, rig, 0x275c77);
  const inspected = ['spine_03', 'neck_01', 'upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r',
    'thigh_l', 'thigh_r', 'calf_l', 'calf_r', 'foot_l', 'foot_r'];
  for (const stroke of ['forehand', 'backhand', 'serve']) {
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
  oldCrowd.setHighDetailEnabled(false);
  const batches = crowds.attachHumanCrowd(scene, oldCrowd, [
    await asset('male', 'crowd'), await asset('female', 'crowd'),
  ]);
  assert.equal(batches.length, 12);
  assert.equal(batches.reduce((sum, mesh) => sum + mesh.count, 0), oldCrowd.seats.length);
  oldCrowd.setHighDetailModel(await asset('male', 'player'), 0);
  const highDetailBatches = scene.children.filter((object) => object.name.includes('high-detail'));
  oldCrowd.update(0.1, false);
  const totalInstances = () => [...batches, ...highDetailBatches]
    .reduce((sum, mesh) => sum + mesh.count, 0);
  assert.equal(highDetailBatches.reduce((sum, mesh) => sum + mesh.count, 0), 0);
  assert.ok(highDetailBatches.every((mesh) => !mesh.visible));
  assert.equal(totalInstances(), oldCrowd.seats.length);
  oldCrowd.setHighDetailEnabled(true);
  oldCrowd.update(0.2, false);
  assert.equal(highDetailBatches.reduce((sum, mesh) => sum + mesh.count, 0), 24);
  assert.equal(totalInstances(), oldCrowd.seats.length);
  assert.equal(scene.getObjectByName('wtsl-spectator-heads').visible, false);
  oldCrowd.update(2, true, new THREE.Vector3(11, 0.5, 5));
  assert.ok(batches.some((mesh, index) => index % 6 >= 3 && mesh.count > 0));
  assert.equal(totalInstances(), oldCrowd.seats.length);
  oldCrowd.setHighDetailEnabled(false);
  oldCrowd.update(2.2, true, new THREE.Vector3(11, 0.5, 5));
  assert.equal(highDetailBatches.reduce((sum, mesh) => sum + mesh.count, 0), 0);
  assert.ok(highDetailBatches.every((mesh) => !mesh.visible));
  assert.equal(totalInstances(), oldCrowd.seats.length);
  oldCrowd.setHighDetailEnabled(true);
  oldCrowd.update(2.4, true, new THREE.Vector3(11, 0.5, 5));
  assert.equal(highDetailBatches.reduce((sum, mesh) => sum + mesh.count, 0), 24);
  for (const mesh of [...batches, ...highDetailBatches]) {
    assert.ok(mesh.geometry.boundingBox.max.y > 1.2);
    assert.ok(mesh.geometry.boundingBox.max.y < 1.7);
    assert.equal(mesh.castShadow, false);
  }
});

test('twist helpers distribute forearm roll without moving the hand or calf', async () => {
  const template = await nativePlayerTemplate('male');
  const rig = sceneApi.makePlayer(0x275c77, 0x333333);
  const attached = humans.attachHumanPlayer(template, rig, 0x275c77);
  const { pose } = attached;
  attached.update();
  pose.reset();
  pose.model.updateMatrixWorld(true);
  const roll = new THREE.Quaternion().setFromAxisAngle(
    pose.bones.get('hand_r').position.clone().normalize(), 1.4,
  );
  pose.bones.get('lowerarm_r').quaternion.multiply(roll);
  pose.model.updateMatrixWorld(true);
  const before = ['lowerarm_r', 'hand_r', 'calf_r'].map(name =>
    pose.bones.get(name).getWorldQuaternion(new THREE.Quaternion()));
  const positions = ['lowerarm_r', 'hand_r', 'middle_01_r'].map(name => pose.point(name));
  nativeTwist.distributeNativeTwist(pose.bones, pose.rest);
  pose.model.updateMatrixWorld(true);
  for (const [i, name] of ['hand_r', 'calf_r'].entries()) {
    assert.ok(pose.bones.get(name).getWorldQuaternion(new THREE.Quaternion())
      .angleTo(before[i + 1]) < 1e-3, `${name} orientation changed`);
  }
  for (const [i, name] of ['lowerarm_r', 'hand_r', 'middle_01_r'].entries()) {
    assert.ok(pose.point(name).distanceTo(positions[i]) < 1e-6, `${name} moved`);
  }
  const helper = pose.bones.get('lowerarm_twist_r');
  assert.ok(2 * Math.acos(Math.min(1, Math.abs(helper.quaternion.w))) > 0.8,
    'forearm roll was not moved to its helper');
  const lowerNow = pose.bones.get('lowerarm_r').getWorldQuaternion(new THREE.Quaternion());
  assert.ok(lowerNow.angleTo(before[0]) > 0.8, 'forearm bone still carries the roll');
});

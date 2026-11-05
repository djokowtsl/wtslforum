import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

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
const sceneApi = await loadTs('../components/DmoLiveCourt3DScene.ts');
const racketPose = await loadTs('../components/DmoRacketOrientation.ts');
const articulated = await loadTs('../components/DmoArticulatedHands.ts', { './DmoRacketOrientation': racketPose });
const nativeGrip = await loadTs('../components/DmoNativeGrip.ts');
const nativeKit = await loadTs('../components/DmoNativeKit.ts');
const nativePlayer = await loadTs('../components/DmoNativePlayer.ts', {
  './DmoRacketOrientation': racketPose, './DmoNativeGrip': nativeGrip, './DmoNativeKit': nativeKit,
});
const humans = await loadTs('../components/DmoHumanModels.ts', {
  './DmoRacketOrientation': racketPose, './DmoArticulatedHands': articulated, './DmoNativePlayer': nativePlayer,
});
const crowds = await loadTs('../components/DmoHumanCrowd.ts', { './DmoHumanModels': humans });

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
  const bytes = await readFile(new URL('../public/models/dmo-humans/native-player.glb', import.meta.url));
  assert.ok(bytes.length < 1_200_000);
  const template = (await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')).scene;
  Object.assign(template.userData, { continuousPlayer: true, gender });
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
  assert.equal(pose.bones.size, 53);
  assert.ok(pose.rest.get('spine_03').direction.y > 0.9,
    'upper spine must aim through the neck, not its first clavicle child');
  assert.equal(rig.root.getObjectByName('articulated-right-hand'), undefined);
  const nativeBody = attached.model.getObjectByName('Avery_|_anatomical_body');
  assert.deepEqual(nativeBody.geometry.getAttribute('position').array, source, 'body and hand surface must not be cut, grafted or curled');
  assert.ok(attached.model.getObjectByName('native-tennis-shirt').geometry.index.count > 100);
  assert.ok(attached.model.getObjectByName('native-tennis-shorts').geometry.index.count > 100);
  if (gender === 'female') assert.ok(attached.model.getObjectByName('native-tennis-skirt'));
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
    attached.update();
    const actualGrip = rig.root.worldToLocal(grips[side].hand.localToWorld(grips[side].centre.clone()));
    close(actualGrip, rig.racket.position);
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
  assert.equal(batches.length, 12);
  assert.equal(batches.reduce((sum, mesh) => sum + mesh.count, 0), oldCrowd.seats.length);
  assert.equal(scene.getObjectByName('wtsl-spectator-heads').visible, false);
  oldCrowd.update(2, true, new THREE.Vector3(11, 0.5, 5));
  assert.ok(batches.some((mesh, index) => index % 6 >= 3 && mesh.count > 0));
  assert.equal(batches.reduce((sum, mesh) => sum + mesh.count, 0), oldCrowd.seats.length);
  for (const mesh of batches) {
    assert.ok(mesh.geometry.boundingBox.max.y > 1.2);
    assert.ok(mesh.geometry.boundingBox.max.y < 1.7);
    assert.equal(mesh.castShadow, false);
  }
});

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { PlayerRig } from './DmoLiveCourt3DScene';
import { racketHandFrame } from './DmoRacketOrientation';
import { attachArticulatedHands } from './DmoArticulatedHands';
import { attachNativePlayer } from './DmoNativePlayer';
import { attachNativePlayer as attachClaudeNativePlayer } from './DmoNativePlayerClaude';
import type { GroundstrokeMotionSources } from './DmoCapturedGroundstroke';
import { BROADCAST_PLAYER_KITS, type NativePlayerKit } from './DmoNativeKit';

type Gender = 'male' | 'female';
type HumanModelDetail = 'player' | 'crowd' | 'crowd-high';
export type NativePlayerVariant = 'current' | 'claude';
const UP = new THREE.Vector3(0, 1, 0);
const nativeMotionSources = new WeakMap<THREE.Group, GroundstrokeMotionSources>();

async function loadGroundstrokeMotionSources(base: string, signal: AbortSignal): Promise<GroundstrokeMotionSources> {
  const load = async (stroke: 'forehand' | 'backhand' | 'serve') => {
    const response = await fetch(`${base}/tennis-${stroke}.bvh`, { signal });
    if (!response.ok) throw new Error(`Captured ${stroke} motion request failed (${response.status}).`);
    return response.text();
  };
  const [forehand, backhand, serve] = await Promise.all([
    load('forehand'), load('backhand'), load('serve'),
  ]);
  return { forehand, backhand, serve };
}

export function humanModelAssetFilename(gender: Gender, detail: HumanModelDetail) {
  if (detail === 'player') return 'native-player.glb';
  return `${gender}-${detail === 'crowd-high' ? 'player' : 'crowd'}.glb`;
}

export async function loadHumanModel(gender: Gender, detail: HumanModelDetail, signal: AbortSignal, base = '/models/dmo-humans') {
  const filename = humanModelAssetFilename(gender, detail);
  const [response, motionSources] = await Promise.all([
    fetch(`${base}/${filename}`, { signal }),
    detail === 'player' ? loadGroundstrokeMotionSources(base, signal) : Promise.resolve(undefined),
  ]);
  if (!response.ok) throw new Error(`Character model request failed (${response.status}).`);
  const gltf = await new GLTFLoader().parseAsync(await response.arrayBuffer(), '');
  if (signal.aborted) {
    disposeHumanModel(gltf.scene);
    throw new DOMException('Character load cancelled.', 'AbortError');
  }
  if (detail === 'player') {
    Object.assign(gltf.scene.userData, { continuousPlayer: true, gender });
    nativeMotionSources.set(gltf.scene, motionSources!);
  }
  return gltf.scene;
}

export function disposeHumanModel(model: THREE.Object3D, textures = true) {
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (textures) for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose();
      material.dispose();
    }
    if (object instanceof THREE.SkinnedMesh) object.skeleton.dispose();
  });
}

/** Absolute joint targets reuse the DMO rig's contact/footwork rather than a canned run clip. */
export class HumanPose {
  private bones = new Map<string, { bone: THREE.Bone; bind: THREE.Quaternion; direction: THREE.Vector3 }>();
  private spaceRotation = new THREE.Quaternion();
  private parentRotation = new THREE.Quaternion();
  private target = new THREE.Vector3();
  private direction = new THREE.Vector3();
  private rotation = new THREE.Quaternion();

  constructor(readonly model: THREE.Group, readonly space: THREE.Group) {
    space.updateWorldMatrix(true, true);
    const inverseSpace = space.getWorldQuaternion(new THREE.Quaternion()).invert();
    model.traverse((object) => {
      if (!(object instanceof THREE.Bone)) return;
      const bind = inverseSpace.clone().multiply(object.getWorldQuaternion(new THREE.Quaternion()));
      this.bones.set(object.name, { bone: object, bind, direction: UP.clone().applyQuaternion(bind) });
    });
    for (const required of ['Hips', 'Spine02', 'Spine01', 'Spine', 'Head', 'LeftHand', 'RightHand']) {
      if (!this.bones.has(required)) throw new Error(`Missing character joint: ${required}`);
    }
  }

  begin() {
    this.space.updateWorldMatrix(true, false);
    this.space.getWorldQuaternion(this.spaceRotation);
  }

  place(name: string, from: THREE.Vector3, to?: THREE.Vector3, turn?: THREE.Quaternion) {
    const joint = this.bones.get(name);
    if (!joint) return;
    const { bone, bind, direction } = joint;
    const parent = bone.parent;
    if (!parent) return;
    parent.updateWorldMatrix(true, false);
    this.target.copy(from);
    this.space.localToWorld(this.target);
    bone.position.copy(parent.worldToLocal(this.target));
    this.rotation.identity();
    if (to && this.direction.subVectors(to, from).lengthSq() > 0.000001) {
      this.rotation.setFromUnitVectors(direction, this.direction.normalize());
    }
    if (turn) this.rotation.premultiply(turn);
    this.rotation.multiply(bind).premultiply(this.spaceRotation);
    parent.getWorldQuaternion(this.parentRotation).invert();
    bone.quaternion.copy(this.parentRotation.multiply(this.rotation));
    bone.updateMatrixWorld(true);
  }

  /** Rigid anatomical wrist frame; this does not alter any hand vertices. */
  placeFrame(name: string, from: THREE.Vector3, orientation: THREE.Quaternion) {
    const joint = this.bones.get(name);
    if (!joint?.bone.parent) return;
    const { bone } = joint;
    const parent = bone.parent!;
    parent.updateWorldMatrix(true, false);
    this.target.copy(from);
    this.space.localToWorld(this.target);
    bone.position.copy(parent.worldToLocal(this.target));
    this.rotation.copy(orientation).premultiply(this.spaceRotation);
    parent.getWorldQuaternion(this.parentRotation).invert();
    bone.quaternion.copy(this.parentRotation.multiply(this.rotation));
    bone.updateMatrixWorld(true);
  }

  finish() {
    // SkinnedMesh overrides updateMatrixWorld (not updateWorldMatrix) to refresh
    // bindMatrixInverse. This matters when baking cloned centimetre-scale rigs.
    this.model.updateMatrixWorld(true);
    this.model.traverse((object) => { if (object instanceof THREE.SkinnedMesh) object.skeleton.update(); });
  }
}

function limbEnds(mesh: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3) {
  const half = UP.clone().applyQuaternion(mesh.quaternion).multiplyScalar(mesh.scale.y * 0.5);
  from.copy(mesh.position).sub(half);
  to.copy(mesh.position).add(half);
}

/** Tint only the desaturated fabric, not skin, hair or facial features. */
export function tintKit(mesh: THREE.SkinnedMesh, tint: number) {
  const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
  const image = material.map?.image as CanvasImageSource & { width: number; height: number };
  if (!image?.width || typeof document === 'undefined') return;
  const canvas = document.createElement('canvas');
  canvas.width = image.width; canvas.height = image.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return;
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const uv = mesh.geometry.getAttribute('uv'), positions = mesh.geometry.getAttribute('position');
  const colors = new Float32Array(positions.count * 3);
  const shirt = new THREE.Color(tint);
  for (let i = 0; i < positions.count; i++) {
    const x = THREE.MathUtils.clamp(Math.floor(uv.getX(i) * canvas.width), 0, canvas.width - 1);
    // GLTF textures have flipY=false; UV zero addresses the image's top edge.
    const y = THREE.MathUtils.clamp(Math.floor(uv.getY(i) * canvas.height), 0, canvas.height - 1);
    const offset = (y * canvas.width + x) * 4;
    const rgb = [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
    const max = Math.max(...rgb), min = Math.min(...rgb);
    const fabric = positions.getY(i) > 1.0 && positions.getY(i) < 1.48 && max > 60 && (max - min) / Math.max(1, max) < 0.18;
    colors.set(fabric ? [shirt.r, shirt.g, shirt.b] : [1, 1, 1], i * 3);
  }
  mesh.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  material.vertexColors = true;
}

export function attachHumanPlayer(
  template: THREE.Group,
  rig: PlayerRig,
  shirtColor: number,
  handTemplate?: THREE.Group,
  nativePlayerVariant: NativePlayerVariant = 'claude',
  kit: NativePlayerKit = BROADCAST_PLAYER_KITS[0],
  kitIndex = 0,
) {
  if (template.userData.continuousPlayer) {
    const motions = nativeMotionSources.get(template);
    if (!motions) throw new Error('Captured forehand, backhand, and serve motion data was not loaded.');
    const attach = nativePlayerVariant === 'claude' ? attachClaudeNativePlayer : attachNativePlayer;
    return attach(template, rig, shirtColor, motions, kit, kitIndex);
  }
  const model = clone(template) as THREE.Group;
  model.name = 'wtsl-textured-rigged-player';
  model.traverse((object) => {
    if (!(object instanceof THREE.SkinnedMesh)) return;
    object.geometry = object.geometry.clone();
    // The free base meshes are barefoot. Remove the hidden foot surface rather
    // than letting textured toes protrude through the separate tennis shoes.
    const positions = object.geometry.getAttribute('position');
    const skinIndex = object.geometry.getAttribute('skinIndex');
    const skinWeight = object.geometry.getAttribute('skinWeight');
    const handBones = new Set(object.skeleton.bones.map((bone, i) =>
      bone.name === 'LeftHand' || bone.name === 'RightHand' ? i : -1).filter(i => i >= 0));
    const replaced = (vertex: number) => {
      if (!handTemplate) return false;
      let weight = 0;
      for (let j = 0; j < 4; j++) if (handBones.has(skinIndex.getComponent(vertex, j))) weight += skinWeight.getComponent(vertex, j);
      return weight > 0.35;
    };
    const index = object.geometry.index;
    if (index) {
      const visible: number[] = [];
      for (let i = 0; i < index.count; i += 3) {
        const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
        if (Math.max(positions.getY(a), positions.getY(b), positions.getY(c)) >= 0.115
          && ![a, b, c].some(replaced)) visible.push(a, b, c);
      }
      object.geometry.setIndex(visible);
    }
    object.material = (Array.isArray(object.material) ? object.material[0] : object.material).clone();
    object.castShadow = true; object.receiveShadow = true;
    object.frustumCulled = false; // Bind-pose bounds do not contain serves and slides.
    tintKit(object, shirtColor);
  });
  rig.root.add(model);
  for (const shoe of [rig.leftShoe, rig.rightShoe]) {
    const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.043, 0.046, 0.11, 16),
      new THREE.MeshStandardMaterial({ color: 0xe9e9e1, roughness: 0.87 }));
    sock.name = 'tennis-sock'; sock.position.set(0, 0.075, -0.04); sock.castShadow = true;
    shoe.add(sock);
    for (let i = 0; i < 4; i++) {
      const lace = new THREE.Mesh(new THREE.BoxGeometry(0.067, 0.003, 0.005),
        new THREE.MeshStandardMaterial({ color: 0xb6b8ad, roughness: 0.8 }));
      lace.position.set(0, 0.044, 0.005 + i * 0.018); lace.rotation.y = (i % 2 ? 1 : -1) * 0.16;
      shoe.add(lace);
    }
  }
  const pose = new HumanPose(model, rig.root);
  const hidden = rig.root.children.filter((child) => ![model, rig.racket, rig.leftShoe, rig.rightShoe].includes(child as THREE.Group));
  hidden.forEach((child) => { child.visible = false; });
  const updateHands = handTemplate ? attachArticulatedHands(handTemplate, rig, model) : undefined;
  const hip = new THREE.Vector3(), chest = new THREE.Vector3(), neck = new THREE.Vector3(), head = new THREE.Vector3();
  const start = new THREE.Vector3(), end = new THREE.Vector3(), axis = new THREE.Vector3();
  const spine = new THREE.Vector3();
  const update = () => {
    pose.begin();
    hip.copy(rig.hip.position);
    limbEnds(rig.leftArm, start, end);
    chest.copy(start);
    limbEnds(rig.rightArm, start, end);
    chest.add(start).multiplyScalar(0.5);
    head.copy(rig.head.position); head.y -= 0.15;
    neck.copy(head); neck.y -= 0.08;
    pose.place('Hips', hip, undefined, rig.hip.quaternion);
    for (const [name, fraction] of [['Spine02', 0.25], ['Spine01', 0.5], ['Spine', 0.82]] as const) {
      spine.copy(hip).lerp(chest, fraction);
      pose.place(name, spine, neck, rig.body.quaternion);
    }
    pose.place('neck', neck, head);
    pose.place('Head', head, undefined, rig.head.quaternion);
    for (const side of ['Left', 'Right'] as const) {
      const left = side === 'Left';
      const arm = left ? rig.leftArm : rig.rightArm;
      const forearm = left ? rig.leftForearm : rig.rightForearm;
      limbEnds(arm, start, end);
      spine.copy(chest).lerp(start, 0.2);
      pose.place(`${side}Shoulder`, spine, start);
      pose.place(`${side}Arm`, start, end);
      limbEnds(forearm, start, end);
      pose.place(`${side}ForeArm`, start, end);
      const hand = left ? rig.leftHand : rig.rightHand;
      axis.copy(UP).applyQuaternion(hand.quaternion).multiplyScalar(0.12);
      // Forearm ends at the wrist; the hand frame follows the grip axis.
      const holding = left === (rig.root.userData.dominantHandedness === 'left') || !!rig.root.userData.twoHandedGrip;
      if (holding) {
        pose.placeFrame(`${side}Hand`, end, racketHandFrame(rig.racket.quaternion, left));
      } else {
        start.copy(end); end.add(axis);
        pose.place(`${side}Hand`, start, end);
      }
      // Legacy leg labels are screen-space; asset names are anatomical (+X left).
      const upper = left ? rig.rightLeg : rig.leftLeg;
      const calf = left ? rig.rightCalf : rig.leftCalf;
      limbEnds(upper, start, end);
      pose.place(`${side}UpLeg`, start, end);
      limbEnds(calf, start, end);
      pose.place(`${side}Leg`, start, end);
      start.copy(end); end.z += 0.14; end.y -= 0.04;
      pose.place(`${side}Foot`, start, end);
      pose.place(`${side}ToeBase`, end, undefined);
    }
    pose.finish();
    updateHands?.();
  };
  rig.detailed = { update };
  return { model, pose, update };
}

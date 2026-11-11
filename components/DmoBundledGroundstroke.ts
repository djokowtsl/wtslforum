import * as THREE from 'three';
import {
  bundledMotionFrame,
  type BundledMotionClip,
  type BundledRigSchema,
} from '@/lib/dmoBundledMotion.mjs';
import type {
  CapturedBodyHints,
  GroundstrokeName,
  GroundstrokePlayback,
  CapturedClipTiming,
} from './DmoCapturedGroundstroke';

export type BundledStrokeName = GroundstrokeName | 'slice-forehand' | 'slice-backhand';
export interface BundledClipBinding {
  clip: BundledMotionClip;
  contactTime: number;
  sourceHandedness: 'left' | 'right';
}
export interface BundledMotionSource {
  schema: BundledRigSchema;
  clips: Partial<Record<BundledStrokeName, BundledClipBinding>>;
}

const BODY = new Set([
  'pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'head',
  ...['l', 'r'].flatMap(side => [
    'clavicle', 'upperarm', 'lowerarm', 'hand', 'thigh', 'calf', 'foot', 'ball',
  ].map(name => `${name}_${side}`)),
]);
const UPPER = new Set([...BODY].filter(name => !/^(pelvis|thigh_|calf_|foot_|ball_)/.test(name)));
const mirrorName = (name: string) => name.endsWith('_l') ? `${name.slice(0, -2)}_r`
  : name.endsWith('_r') ? `${name.slice(0, -2)}_l` : name;
const reflect = (q: THREE.Quaternion) => new THREE.Quaternion(q.x, -q.y, -q.z, q.w).normalize();

type StrokeChoice = Pick<GroundstrokePlayback, 'stroke' | 'slice' | 'smash' | 'readyPose'>;
function strokeKey(playback: StrokeChoice): BundledStrokeName {
  if (playback.smash && playback.stroke !== 'serve') return 'smash';
  if (playback.slice && (playback.stroke === 'forehand' || playback.stroke === 'backhand')) {
    return `slice-${playback.stroke}`;
  }
  return playback.stroke;
}

/** Canonical 60 Hz replay timing, measured from this clip's actual hit marker. */
export function bundledCaptureTiming(
  source: BundledMotionSource | null | undefined,
  playback: StrokeChoice,
): CapturedClipTiming | undefined {
  const binding = !playback.readyPose && source?.clips[strokeKey(playback)];
  if (!binding) return undefined;
  const recoveryFrames = Math.max(12, Math.ceil((binding.clip.duration - binding.contactTime) * 60));
  return {
    leadFrames: Math.max(1, Math.ceil(binding.contactTime * 60)),
    recoveryFadeStart: Math.max(0, recoveryFrames - 18),
    recoveryFrames,
  };
}

function depth(object: THREE.Object3D) {
  let value = 0;
  for (let parent = object.parent; parent; parent = parent.parent) value++;
  return value;
}

/** Already retargeted on this exact rig: never pass these clips through BVH again. */
export class DmoBundledGroundstroke {
  private readonly targets = new Map<string, THREE.Bone>();
  private readonly shadow: THREE.Object3D;
  private readonly shadows = new Map<string, THREE.Bone>();
  private readonly bindWorld = new Map<string, THREE.Quaternion>();
  private readonly ordered: THREE.Bone[];
  private readonly contacts = new WeakMap<BundledClipBinding, THREE.Vector3>();
  private readonly bindModelToSpace: THREE.Matrix4;

  constructor(
    private readonly model: THREE.Group,
    private readonly space: THREE.Group,
    private readonly source: BundledMotionSource,
  ) {
    if (!source.schema.modelHash
      || model.userData.bundledMotionModelHash !== source.schema.modelHash) {
      throw new Error('The player recording requires a verified matching player model.');
    }
    space.updateWorldMatrix(true, true);
    model.updateWorldMatrix(true, true);
    this.bindModelToSpace = space.matrixWorld.clone().invert().multiply(model.matrixWorld);
    model.traverse(node => {
      if (node instanceof THREE.Bone) this.targets.set(node.name, node);
    });
    this.shadow = model.clone(true);
    this.shadow.position.set(0, 0, 0);
    this.shadow.quaternion.identity();
    this.shadow.scale.set(1, 1, 1);
    const meshes: THREE.Object3D[] = [];
    this.shadow.traverse(node => {
      if (node instanceof THREE.Bone) this.shadows.set(node.name, node);
      if (node instanceof THREE.Mesh) meshes.push(node);
    });
    meshes.forEach(mesh => mesh.removeFromParent());
    this.shadow.updateMatrixWorld(true);
    const { schema } = source;
    schema.bones.forEach((name, index) => {
      const bone = this.shadows.get(name);
      if (!bone || !this.targets.has(name)) throw new Error(`The player model is missing joint ${name}.`);
      const fixed = schema.fixedPose[index]?.p;
      if (!fixed || bone.position.distanceTo(new THREE.Vector3(fixed.x, fixed.y, fixed.z)) > .0001) {
        throw new Error(`The player model bind pose does not match recording joint ${name}.`);
      }
      this.bindWorld.set(name, bone.getWorldQuaternion(new THREE.Quaternion()));
    });
    this.ordered = [...this.targets.values()].filter(bone => BODY.has(bone.name))
      .sort((a, b) => depth(a) - depth(b));
    for (const binding of Object.values(source.clips)) {
      if (!binding) continue;
      if (binding.clip.rigHash !== schema.rigHash || !Number.isFinite(binding.contactTime)
        || binding.contactTime < 0 || binding.contactTime > binding.clip.duration
        || !['left', 'right'].includes(binding.sourceHandedness)) {
        throw new Error('The selected player recording has invalid contact or rig metadata.');
      }
    }
  }

  private key(playback: GroundstrokePlayback): BundledStrokeName {
    return strokeKey(playback);
  }

  has(playback: GroundstrokePlayback) {
    return !playback.readyPose && Boolean(this.source.clips[this.key(playback)]);
  }

  private sample(clip: BundledMotionClip, time: number) {
    const frame = bundledMotionFrame(clip, time);
    this.source.schema.bones.forEach((name, index) => {
      const bone = this.shadows.get(name)!;
      const a = (frame.first * clip.boneCount + index) * 4;
      const b = (frame.second * clip.boneCount + index) * 4;
      bone.quaternion.fromArray(clip.rotations, a)
        .slerp(new THREE.Quaternion().fromArray(clip.rotations, b), frame.blend);
      const fixed = this.source.schema.fixedPose[index].p;
      bone.position.set(fixed.x, fixed.y, fixed.z);
      if (index === clip.pelvisIndex) {
        bone.position.fromArray(clip.positions, frame.first * 3)
          .lerp(new THREE.Vector3().fromArray(clip.positions, frame.second * 3), frame.blend);
      }
    });
    this.shadow.updateMatrixWorld(true);
  }

  apply(playback: GroundstrokePlayback): CapturedBodyHints | null {
    if (playback.readyPose) return null;
    const binding = this.source.clips[this.key(playback)];
    if (!binding || !Number.isFinite(playback.deltaSeconds) || !Number.isFinite(playback.weight)) return null;
    const weight = THREE.MathUtils.clamp(playback.weight, 0, 1);
    if (weight <= 0) return null;
    let contact = this.contacts.get(binding);
    if (!contact) {
      this.sample(binding.clip, binding.contactTime);
      contact = this.shadows.get('pelvis')!.getWorldPosition(new THREE.Vector3());
      this.contacts.set(binding, contact);
    }
    const lead = playback.deltaSeconds < 0
      ? THREE.MathUtils.clamp(playback.leadScale ?? 1, 1, 4) : 1;
    const time = THREE.MathUtils.clamp(
      binding.contactTime + playback.deltaSeconds * lead, 0, binding.clip.duration,
    );
    this.sample(binding.clip, time);
    const mirrored = playback.handedness !== binding.sourceHandedness;
    const selected = playback.scope === 'upper' ? UPPER : BODY;
    const base = this.ordered.map(bone => ({
      bone, position: bone.position.clone(), rotation: bone.quaternion.clone(),
    }));
    this.model.updateWorldMatrix(true, true);
    const modelRotation = this.model.getWorldQuaternion(new THREE.Quaternion());
    for (const bone of this.ordered) {
      const sourceName = mirrored ? mirrorName(bone.name) : bone.name;
      let rotation = this.shadows.get(sourceName)!.getWorldQuaternion(new THREE.Quaternion());
      if (mirrored) {
        // Mirror the motion away from bind, then restore the opposite bone's
        // own bind axes. Simply reflecting local quaternions twists the wrist.
        rotation.multiply(this.bindWorld.get(sourceName)!.clone().invert());
        rotation = reflect(rotation).multiply(this.bindWorld.get(bone.name)!);
      }
      bone.parent!.updateWorldMatrix(true, false);
      bone.quaternion.copy(bone.parent!.getWorldQuaternion(new THREE.Quaternion()).invert()
        .multiply(modelRotation).multiply(rotation)).normalize();
      if (bone.name === 'pelvis') {
        const position = this.shadows.get('pelvis')!.getWorldPosition(new THREE.Vector3());
        position.x -= contact.x;
        position.z -= contact.z;
        if (mirrored) position.x *= -1;
        position.applyMatrix4(this.bindModelToSpace);
        if (playback.rootOffset === false) {
          // Court tracking owns horizontal placement; the native recording
          // owns crouching/jumping height, not the old procedural serve lift.
          const current = this.space.worldToLocal(bone.getWorldPosition(new THREE.Vector3()));
          position.x = current.x;
          position.z = current.z;
        }
        bone.position.copy(bone.parent!.worldToLocal(this.space.localToWorld(position)));
      }
      bone.updateMatrixWorld(true);
    }
    this.model.updateMatrixWorld(true);
    const hints = (part: 'lowerarm' | 'hand') => Object.fromEntries(['l', 'r'].map(side => [
      side, this.space.worldToLocal(this.targets.get(`${part}_${side}`)!
        .getWorldPosition(new THREE.Vector3())),
    ])) as Record<'l' | 'r', THREE.Vector3>;
    const result: CapturedBodyHints = { elbows: hints('lowerarm'), wrists: hints('hand'), nativeRecording: true };
    const sampled = this.ordered.map(bone => ({ position: bone.position.clone(), rotation: bone.quaternion.clone() }));
    base.forEach(({ bone, position, rotation }, index) => {
      bone.position.copy(position);
      bone.quaternion.copy(rotation);
      if (!selected.has(bone.name)) return;
      bone.quaternion.slerp(sampled[index].rotation, weight);
      if (bone.name === 'pelvis') bone.position.lerp(sampled[index].position, weight);
    });
    this.model.updateMatrixWorld(true);
    return result;
  }
}

import * as THREE from 'three';
import { BVHLoader } from 'three/examples/jsm/loaders/BVHLoader.js';

export type GroundstrokeName = 'forehand' | 'backhand' | 'serve';
export type DominantHandedness = 'left' | 'right';

export interface GroundstrokeMotionSources {
  forehand: string;
  backhand: string;
  serve: string;
}

export interface GroundstrokePlayback {
  stroke: GroundstrokeName;
  deltaSeconds: number;
  weight: number;
  handedness: DominantHandedness;
  scope?: 'full' | 'upper';
  rootOffset?: boolean;
}

export interface CapturedBodyHints {
  elbows: Record<'l' | 'r', THREE.Vector3>;
  wrists: Record<'l' | 'r', THREE.Vector3>;
}

type NativeRest = {
  rotation: THREE.Quaternion;
  direction: THREE.Vector3;
};

type RetargetPair = {
  target: THREE.Bone;
  source: THREE.Bone;
  targetRest: THREE.Quaternion;
};

type MotionClip = {
  root: THREE.Bone;
  mixer: THREE.AnimationMixer;
  duration: number;
  contactTime: number;
  contactRoot: THREE.Vector3;
  scale: number;
  rightPairs: RetargetPair[];
  leftPairs: RetargetPair[];
};

const CONTACT_SECONDS: Record<GroundstrokeName, number> = {
  // The serve time is the repeated right-wrist speed/height peak in the source
  // clip; the source has no ball-contact marker, so this remains inferred.
  forehand: 13.4,
  backhand: 9.28,
  serve: 2.56,
};

const READY_POSE_SECONDS = 0.5;

const SOURCE_BONE_BY_TARGET: Record<string, string> = {
  pelvis: 'Hips',
  spine_01: 'Chest',
  spine_02: 'Chest',
  spine_03: 'Chest',
  neck_01: 'Neck',
  head: 'Head',
  clavicle_l: 'LeftCollar',
  upperarm_l: 'LeftShoulder',
  lowerarm_l: 'LeftElbow',
  hand_l: 'LeftWrist',
  clavicle_r: 'RightCollar',
  upperarm_r: 'RightShoulder',
  lowerarm_r: 'RightElbow',
  hand_r: 'RightWrist',
  thigh_l: 'LeftHip',
  calf_l: 'LeftKnee',
  foot_l: 'LeftAnkle',
  thigh_r: 'RightHip',
  calf_r: 'RightKnee',
  foot_r: 'RightAnkle',
};

const BODY_BONES = [
  'pelvis',
  'spine_01', 'spine_02', 'spine_03',
  'neck_01', 'head',
  'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l',
  'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r',
  'thigh_l', 'calf_l', 'foot_l',
  'thigh_r', 'calf_r', 'foot_r',
];

const UPPER_BODY_BONES = [
  'spine_01', 'spine_02', 'spine_03',
  'neck_01', 'head',
  'clavicle_l', 'clavicle_r',
];

export function groundstrokeCaptureWeight(frameDelta: number) {
  if (!Number.isFinite(frameDelta)) return 0;
  const smooth = THREE.MathUtils.smoothstep;
  const backswing = smooth(frameDelta, -22, -15) * (1 - smooth(frameDelta, -8, -3));
  const impact = smooth(frameDelta, -8, -2) * (1 - smooth(frameDelta, 2, 8));
  const followThrough = smooth(frameDelta, -1, 5) * (1 - smooth(frameDelta, 16, 22));
  return Math.max(backswing, impact, followThrough);
}

export function serveCaptureWeight(frameDelta: number) {
  if (!Number.isFinite(frameDelta)) return 0;
  const smooth = THREE.MathUtils.smoothstep;
  const preparation = smooth(frameDelta, -64, -48) * (1 - smooth(frameDelta, -20, -6));
  const contact = smooth(frameDelta, -6, -2) * (1 - smooth(frameDelta, 2, 8));
  const recovery = smooth(frameDelta, -1, 5) * (1 - smooth(frameDelta, 16, 22));
  return Math.max(preparation, contact, recovery);
}

export function readyPosePlayback(
  handedness: DominantHandedness,
  scope: 'full' | 'upper',
): GroundstrokePlayback {
  return {
    stroke: 'serve',
    deltaSeconds: READY_POSE_SECONDS - CONTACT_SECONDS.serve,
    weight: 1,
    handedness,
    scope,
    rootOffset: false,
  };
}

function mirrorSide(name: string) {
  return name.replace(/Left|Right/g, (side) => side === 'Left' ? 'Right' : 'Left');
}

function mirrorVectorX(vector: THREE.Vector3) {
  return new THREE.Vector3(-vector.x, vector.y, vector.z);
}

function mirrorQuaternionX(quaternion: THREE.Quaternion) {
  return new THREE.Quaternion(quaternion.x, -quaternion.y, -quaternion.z, quaternion.w).normalize();
}

export class DmoCapturedGroundstroke {
  private readonly targets = new Map<string, THREE.Bone>();
  private readonly motions: Record<GroundstrokeName, MotionClip>;
  private readonly model: THREE.Group;
  private readonly space: THREE.Group;

  constructor(
    model: THREE.Group,
    space: THREE.Group,
    rest: Map<string, NativeRest>,
    sources: GroundstrokeMotionSources,
  ) {
    this.model = model;
    this.space = space;
    model.updateMatrixWorld(true);
    space.updateWorldMatrix(true, true);
    model.traverse((object) => {
      if (object instanceof THREE.Bone) this.targets.set(object.name, object);
    });

    this.motions = {
      forehand: this.prepare('forehand', sources.forehand, rest),
      backhand: this.prepare('backhand', sources.backhand, rest),
      serve: this.prepare('serve', sources.serve, rest),
    };
  }

  private prepare(stroke: GroundstrokeName, text: string, rest: Map<string, NativeRest>): MotionClip {
    const data = new BVHLoader().parse(text);
    const root = data.skeleton.bones[0];
    const mixer = new THREE.AnimationMixer(root);
    mixer.clipAction(data.clip).play();
    const contactTime = CONTACT_SECONDS[stroke];
    if (contactTime >= data.clip.duration) {
      throw new Error(`Captured ${stroke} contact time exceeds its BVH clip.`);
    }
    mixer.setTime(contactTime);
    root.updateMatrixWorld(true);
    const contactRoot = root.position.clone();
    const targetPelvis = this.targets.get('pelvis');
    if (!targetPelvis) throw new Error('Captured groundstroke retarget requires a pelvis joint.');
    const targetPelvisPosition = this.space.worldToLocal(targetPelvis.getWorldPosition(new THREE.Vector3()));
    const scale = targetPelvisPosition.y / contactRoot.y;
    if (!Number.isFinite(scale) || scale <= 0) {
      throw new Error(`Captured ${stroke} BVH has an invalid height scale.`);
    }
    const sourceBones = new Map(data.skeleton.bones.map((bone) => [bone.name, bone]));
    return {
      root,
      mixer,
      duration: data.clip.duration,
      contactTime,
      contactRoot,
      scale,
      rightPairs: this.buildPairs(sourceBones, rest, false),
      leftPairs: this.buildPairs(sourceBones, rest, true),
    };
  }

  private buildPairs(
    sourceBones: Map<string, THREE.Bone>,
    rest: Map<string, NativeRest>,
    mirrored: boolean,
  ): RetargetPair[] {
    const pairs: RetargetPair[] = [];
    for (const [name, sourceName] of Object.entries(SOURCE_BONE_BY_TARGET)) {
      const target = this.targets.get(name);
      const source = sourceBones.get(mirrored ? mirrorSide(sourceName) : sourceName);
      const targetRest = rest.get(name);
      if (!target || !source || !targetRest) continue;
      // BVH offsets describe the source bind axes. Its first animated frame
      // is an arbitrary tennis pose, not a rest pose to subtract from a swing.
      const child = source.children.find(object => object instanceof THREE.Bone);
      const sourceDirection = child?.position.clone().normalize() ?? new THREE.Vector3(0, 1, 0);
      if (mirrored) sourceDirection.x *= -1;
      const bindAlignment = new THREE.Quaternion()
        .setFromUnitVectors(targetRest.direction.clone().normalize(), sourceDirection);
      pairs.push({ target, source, targetRest: bindAlignment.multiply(targetRest.rotation) });
    }
    return pairs;
  }

  apply(playback: GroundstrokePlayback): CapturedBodyHints | null {
    const weight = THREE.MathUtils.clamp(playback.weight, 0, 1);
    if (weight <= 0 || !Number.isFinite(playback.deltaSeconds)) return null;
    const motion = this.motions[playback.stroke];
    const mirrored = playback.handedness === 'left';
    const pairs = mirrored ? motion.leftPairs : motion.rightPairs;
    const time = THREE.MathUtils.clamp(
      motion.contactTime + playback.deltaSeconds,
      0,
      motion.duration,
    );
    const base = [...this.targets.values()].map((bone) => ({
      bone,
      position: bone.position.clone(),
      rotation: bone.quaternion.clone(),
    }));

    motion.mixer.setTime(time);
    motion.root.updateMatrixWorld(true);
    const sourceRootPosition = mirrored ? mirrorVectorX(motion.root.position) : motion.root.position.clone();
    const contactRoot = mirrored ? mirrorVectorX(motion.contactRoot) : motion.contactRoot;
    const rootOffset = playback.rootOffset === false
      ? new THREE.Vector3()
      : sourceRootPosition.sub(contactRoot).multiplyScalar(motion.scale);
    const pelvis = this.targets.get('pelvis')!;
    const pelvisSpacePosition = this.space.worldToLocal(pelvis.getWorldPosition(new THREE.Vector3()));
    pelvisSpacePosition.add(rootOffset);
    pelvis.position.copy(pelvis.parent!.worldToLocal(this.space.localToWorld(pelvisSpacePosition)));

    const spaceRotation = this.space.getWorldQuaternion(new THREE.Quaternion());
    for (const { target, source, targetRest } of pairs) {
      target.parent!.updateWorldMatrix(true, false);
      const sourceRotation = source.getWorldQuaternion(new THREE.Quaternion());
      if (mirrored) {
        sourceRotation.copy(mirrorQuaternionX(sourceRotation));
      }
      const desiredWorld = spaceRotation.clone().multiply(sourceRotation).multiply(targetRest);
      target.quaternion.copy(
        target.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(desiredWorld),
      );
      target.updateMatrixWorld(true);
    }
    this.model.updateMatrixWorld(true);

    const sampled = new Map([...this.targets.entries()].map(([name, bone]) => [
      name,
      { position: bone.position.clone(), rotation: bone.quaternion.clone() },
    ]));
    const elbowHints = {
      l: this.space.worldToLocal(this.targets.get('lowerarm_l')!.getWorldPosition(new THREE.Vector3())),
      r: this.space.worldToLocal(this.targets.get('lowerarm_r')!.getWorldPosition(new THREE.Vector3())),
    };
    const wristHints = {
      l: this.space.worldToLocal(this.targets.get('hand_l')!.getWorldPosition(new THREE.Vector3())),
      r: this.space.worldToLocal(this.targets.get('hand_r')!.getWorldPosition(new THREE.Vector3())),
    };
    for (const entry of base) {
      entry.bone.position.copy(entry.position);
      entry.bone.quaternion.copy(entry.rotation);
    }
    this.model.updateMatrixWorld(true);

    const bodyBones = playback.scope === 'upper' ? UPPER_BODY_BONES : BODY_BONES;
    for (const name of bodyBones) {
      const target = this.targets.get(name);
      const sample = sampled.get(name);
      if (!target || !sample) continue;
      target.quaternion.slerp(sample.rotation, weight);
      if (name === 'pelvis') target.position.lerp(sample.position, weight);
    }
    this.model.updateMatrixWorld(true);
    return { elbows: elbowHints, wrists: wristHints };
  }
}

import * as THREE from 'three';
import { BVHLoader } from 'three/examples/jsm/loaders/BVHLoader.js';

export type GroundstrokeName =
  | 'forehand'
  | 'backhand'
  | 'serve'
  | 'smash'
  | 'volley-forehand'
  | 'volley-backhand';
export type DominantHandedness = 'left' | 'right';
export type PlayerStrokeHands = 'one' | 'two';

/** The caller must establish a volley flight; net proximity alone is insufficient. */
export function recordedStrokeForSide(side: 'forehand' | 'backhand', isVolley: boolean): GroundstrokeName {
  if (!isVolley) return side;
  return side === 'forehand' ? 'volley-forehand' : 'volley-backhand';
}

export function isRecordedBackhand(stroke: GroundstrokeName | undefined) {
  return stroke === 'backhand' || stroke === 'volley-backhand';
}

export function isRecordedVolley(stroke: GroundstrokeName | undefined) {
  return stroke === 'volley-forehand' || stroke === 'volley-backhand';
}

/** Only a topspin groundstroke drive uses the compact, faster take-back. */
export function shouldCompressGroundstrokeTakeBack(
  stroke: GroundstrokeName,
  sliceOrTouch = false,
) {
  return (stroke === 'forehand' || stroke === 'backhand') && !sliceOrTouch;
}

/** The volley uses a continental grip, not the ground backhand regrip. */
export function recordedBackhandFaceRoll(
  stroke: GroundstrokeName | undefined,
  oneHanded: boolean,
  slice = false,
) {
  if (slice || stroke === 'volley-backhand') return 35 * Math.PI / 180;
  return stroke === 'backhand' && oneHanded ? 72 * Math.PI / 180 : 0;
}

export function recordedStrokeUsesTwoHands(
  stroke: GroundstrokeName | undefined,
  style: { forehand?: PlayerStrokeHands; backhand?: PlayerStrokeHands } | undefined,
  fallback: boolean,
) {
  if (!stroke) return fallback;
  if (
    stroke === 'serve'
    || stroke === 'smash'
    || stroke === 'volley-forehand'
    || stroke === 'volley-backhand'
  ) return false;
  return (style?.[stroke] ?? (stroke === 'backhand' ? 'two' : 'one')) === 'two';
}

export type GroundstrokeMotionSources = {
  [stroke in Exclude<GroundstrokeName, 'smash'>]: string;
} & {
  /** Optional recorded smash; overheads fall back to their normal stroke. */
  smash?: string;
  /** Optional captured one-handed backhand; missing data keeps the prior clip. */
  backhandOne?: string;
  /** Recorded walk / jog / run for the arms between points (optional). */
  locomotion?: { walk: string; jog: string; run: string };
};

export interface GroundstrokePlayback {
  stroke: GroundstrokeName;
  deltaSeconds: number;
  weight: number;
  handedness: DominantHandedness;
  scope?: 'full' | 'upper';
  rootOffset?: boolean;
  hands?: 'one' | 'two';
  /** Select the one-handed recording for a ground backhand only. */
  oneHanded?: boolean;
  /** A detected slice uses the volley recording as a high-to-low stand-in. */
  slice?: boolean;
  /** A rally overhead uses the optional recorded smash, never a serve. */
  smash?: boolean;
  /** Speed up the take-back when a fast reply leaves too little preparation time. */
  leadScale?: number;
  /** Recorded contact ball position in the player's local court space. */
  contactTarget?: [number, number, number];
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
  wristCalibration?: THREE.Quaternion;
  rightPairs: RetargetPair[];
  leftPairs: RetargetPair[];
};

type MotionName = GroundstrokeName | 'backhandOne';

const CONTACT_SECONDS: Record<MotionName, number> = {
  // The serve time is the repeated right-wrist speed/height peak in the source
  // clip; the source has no ball-contact marker, so this remains inferred.
  forehand: 13.4,
  backhand: 9.28,
  serve: 2.56,
  // Jarua's recorded smash peaks near 7.6 s; the source has no ball marker.
  smash: 7.6,
  // Tennis-MoCap volley excerpts use a 25 Hz BVH and retain the selected
  // right-wrist speed peak near excerpt frame 23. The dataset has no ball marker.
  'volley-forehand': 0.92,
  // Round 17's 3.42 s contact, minus this excerpt's 2.52 s start.
  'volley-backhand': 0.90,
  // Inferred from the third recorded swing's right-wrist speed peak.
  backhandOne: 5.66,
};

/**
 * The source has no racket markers. This wrist-local correction compensates
 * for the one-handed recording's forearm roll so the racket is level at contact.
 */
const WRIST_CALIBRATION: Partial<Record<MotionName, [number, number, number, number]>> = {
  backhandOne: [0.2929, -0.6615, -0.0411, 0.6892],
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

/** Frames after contact by which the recorded stroke has handed back to the
 * neutral ready position (0.87 s). */
export const CAPTURE_RECOVERY_FRAMES = 52;

/** Frames after contact at which the hand-back starts (0.57 s). The recordings
 * finish with the arm wrapped round high (forehand, backhand) or across the body
 * (serve) until ~0.5 s and are back in front by ~0.6 s; handing back while the
 * arm was still wrapped round folded it through the chest. They then settle into
 * the recorded player's forehand- or backhand-side ready (the clips are repeated
 * forehands, repeated backhands), so handing back much later than this kept the
 * player turned as if about to hit again, rarely neutral. */
export const RECOVERY_FADE_START = 34;

/** Frames before contact at which a groundstroke's recorded preparation
 * starts to blend in (~0.65 s, so the take-back is not a few-frame whip). */
export const GROUNDSTROKE_LEAD_FRAMES = 40;

/** Shortest lead-in (frames): the take-back still eases in over ~0.33 s. */
export const GROUNDSTROKE_MIN_LEAD_FRAMES = 24;

/**
 * Frames before contact at which a groundstroke's take-back starts, given the
 * opponent's last contact: not before he has had ~0.4 s to read the ball (a
 * player is neutral, split-stepping, as the opponent hits), and no earlier than
 * GROUNDSTROKE_LEAD_FRAMES.
 */
export function groundstrokeLeadFrames(framesSinceOpponentContactAtOwnContact?: number) {
  if (framesSinceOpponentContactAtOwnContact === undefined
    || !Number.isFinite(framesSinceOpponentContactAtOwnContact)) {
    return GROUNDSTROKE_LEAD_FRAMES;
  }
  return THREE.MathUtils.clamp(
    framesSinceOpponentContactAtOwnContact - 24,
    GROUNDSTROKE_MIN_LEAD_FRAMES,
    GROUNDSTROKE_LEAD_FRAMES,
  );
}

export function groundstrokeCaptureWeight(
  frameDelta: number,
  leadFrames = GROUNDSTROKE_LEAD_FRAMES,
) {
  if (!Number.isFinite(frameDelta)) return 0;
  const smooth = THREE.MathUtils.smoothstep;
  const lead = THREE.MathUtils.clamp(leadFrames, GROUNDSTROKE_MIN_LEAD_FRAMES, GROUNDSTROKE_LEAD_FRAMES);
  // One continuous envelope. (Separate backswing/impact/follow-through lobes
  // crossed ~5 frames before contact, dipping the weight to ~0.5 and pulling
  // the arm halfway back to the procedural pose mid-swing.)
  return smooth(frameDelta, -lead, -lead + 20)
    * (1 - smooth(frameDelta, RECOVERY_FADE_START, CAPTURE_RECOVERY_FRAMES));
}

/** Frames before contact at which the recorded serve starts to blend in
 * (~1.8 s): the capture's own set-up, toss and take-back then play out. Starting
 * at 64 frames, already mid take-back, swung the arms from the carry into it
 * in about a quarter of a second. */
export const SERVE_LEAD_FRAMES = 110;

/** Short volley preparation/recovery, in canonical 60 Hz frames. */
export const VOLLEY_LEAD_FRAMES = 26;
/** Playback speed of the volley recording when it stands in for a slice. */
export const SLICE_TIME_SCALE = 0.75;
export const VOLLEY_RECOVERY_FRAMES = 44;

export function volleyCaptureWeight(frameDelta: number) {
  if (!Number.isFinite(frameDelta)) return 0;
  const smooth = THREE.MathUtils.smoothstep;
  return smooth(frameDelta, -VOLLEY_LEAD_FRAMES, -10)
    * (1 - smooth(frameDelta, 24, VOLLEY_RECOVERY_FRAMES));
}

export function serveCaptureWeight(frameDelta: number) {
  if (!Number.isFinite(frameDelta)) return 0;
  const smooth = THREE.MathUtils.smoothstep;
  // Continuous from the start of the service motion to the end of recovery.
  return smooth(frameDelta, -SERVE_LEAD_FRAMES, -80)
    * (1 - smooth(frameDelta, RECOVERY_FADE_START, CAPTURE_RECOVERY_FRAMES));
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
  private readonly motions: Omit<Record<GroundstrokeName, MotionClip>, 'smash'> & {
    smash?: MotionClip;
    backhandOne?: MotionClip;
  };
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
      'volley-forehand': this.prepare('volley-forehand', sources['volley-forehand'], rest),
      'volley-backhand': this.prepare('volley-backhand', sources['volley-backhand'], rest),
    };
    if (sources.smash) {
      try {
        this.motions.smash = this.prepare('smash', sources.smash, rest);
      } catch (error) {
        console.warn('Captured smash could not be prepared; overheads keep the existing stroke.', error);
      }
    }
    if (sources.backhandOne) {
      try {
        this.motions.backhandOne = this.prepare('backhandOne', sources.backhandOne, rest);
      } catch (error) {
        console.warn('Captured one-handed backhand could not be prepared; using the existing recording.', error);
      }
    }
  }

  get hasOneHandedBackhand() {
    return Boolean(this.motions.backhandOne);
  }

  get hasSmash() {
    return Boolean(this.motions.smash);
  }

  private prepare(stroke: MotionName, text: string, rest: Map<string, NativeRest>): MotionClip {
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
      wristCalibration: WRIST_CALIBRATION[stroke]
        ? new THREE.Quaternion(...WRIST_CALIBRATION[stroke]!).normalize()
        : undefined,
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
    const isVolley = playback.stroke === 'volley-forehand' || playback.stroke === 'volley-backhand';
    const useSmash = playback.stroke === 'smash'
      || (playback.smash === true && playback.stroke !== 'serve');
    const smash = useSmash ? this.motions.smash : undefined;
    const volley = !smash && playback.stroke !== 'serve' && (isVolley || playback.slice)
      ? this.motions[playback.stroke === 'forehand' || playback.stroke === 'volley-forehand'
        ? 'volley-forehand'
        : 'volley-backhand']
      : undefined;
    const timeScale = playback.slice && !isVolley ? SLICE_TIME_SCALE : 1;
    const fallbackStroke = playback.stroke === 'smash' ? 'forehand' : playback.stroke;
    const motion = volley
      || smash
      || (playback.stroke === 'backhand' && playback.oneHanded && this.motions.backhandOne
      ? this.motions.backhandOne
      : this.motions[fallbackStroke]);
    const mirrored = playback.handedness === 'left';
    const pairs = mirrored ? motion.leftPairs : motion.rightPairs;
    const leadScale = playback.deltaSeconds < 0
      ? THREE.MathUtils.clamp(playback.leadScale ?? 1, 1, 2)
      : 1;
    const time = THREE.MathUtils.clamp(
      motion.contactTime + playback.deltaSeconds * timeScale * leadScale,
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
      if (motion.wristCalibration && source.name === 'RightWrist') {
        sourceRotation.multiply(motion.wristCalibration);
      }
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

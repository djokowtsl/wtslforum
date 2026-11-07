import * as THREE from 'three';
import { BVHLoader } from 'three/examples/jsm/loaders/BVHLoader.js';

/**
 * Captured arm motion between shots.
 *
 * Between shots the arms used to be built by code: target positions for the
 * hands each frame, an IK solve for the elbows, and blends between several
 * hand-tuned carries. Blends between poses that don't fit together folded and
 * flared the elbows and squashed the upper arm into the chest. The arms now
 * follow recorded human motion:
 *
 * - walking, jogging and running between points: CMU Graphics Lab Motion
 *   Capture Database clips (see NATIVE-RIG-AND-MOTION.md), in time with the
 *   steps. Each clip is exactly one step cycle, starting as the right foot
 *   lands, so a gait phase in [0, 1) maps straight onto it;
 * - standing, waiting and the ready position: the tennis player's own recorded
 *   ready position (the first second of the Tennis-MoCap backhand recording,
 *   before the first stroke), both hands on the racket in front.
 *
 * Arms are re-based onto the player's own chest, so they follow his lean and
 * turn. The legs are never taken from these clips: the ground-locked stepping
 * stays in charge of the feet.
 */
export interface LocomotionMotionSources {
  walk: string;
  jog: string;
  run: string;
}

export type LocomotionName = keyof LocomotionMotionSources;

/** Speeds (m/s) at which each clip is used on its own. The recordings are a
 * relaxed walk (~1.2 m/s), a jog (~3.0) and a run (~3.3) of one subject; the
 * jog/run split is by style as much as speed. */
export const LOCOMOTION_CLIP_SPEED: Record<LocomotionName, number> = { walk: 1.3, jog: 2.6, run: 3.8 };

/** The steady ready position in the Tennis-MoCap backhand recording (seconds). */
export const READY_POSE_WINDOW = { start: 0.1, end: 1.0 } as const;

export interface LocomotionPlayback {
  /** Step-cycle phase in [0, 1); 0 = right foot landing in front. */
  phase: number;
  /** Ground speed in m/s (chooses walk / jog / run). */
  speed: number;
  /** 0..1 how much the recorded arms replace the current arm pose. */
  weight: number;
}

export interface ReadyPlayback {
  /** Replay time (s); the recorded ready second plays slowly back and forth. */
  time: number;
  weight: number;
  /** Left-handed player: the right-hander's recording, mirrored. */
  mirrored: boolean;
}

interface PoseAccess {
  rotation(name: string): THREE.Quaternion;
  orient(name: string, orientation: THREE.Quaternion): void;
}

type NativeRest = { rotation: THREE.Quaternion; direction: THREE.Vector3 };

/** Target bones, chest first, then each arm from the clavicle out. */
const TARGETS = [
  'spine_03',
  'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l',
  'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r',
] as const;

/** Source joint names in the CMU (cgspeed BVH) skeleton. */
const CMU_SOURCES = [
  'Spine1',
  'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
  'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
];

/** Source joint names in the Tennis-MoCap skeleton. */
const TENNIS_SOURCES = [
  'Chest',
  'LeftCollar', 'LeftShoulder', 'LeftElbow', 'LeftWrist',
  'RightCollar', 'RightShoulder', 'RightElbow', 'RightWrist',
];

type Pair = { target: string; source: THREE.Bone; alignment: THREE.Quaternion; loopError: THREE.Quaternion };

type Clip = {
  root: THREE.Bone;
  mixer: THREE.AnimationMixer;
  duration: number;
  pairs: Pair[];
  mirrored: boolean;
};

function mirrorSide(name: string) {
  return name.replace(/Left|Right/g, side => side === 'Left' ? 'Right' : 'Left');
}

function mirrorQuaternionX(q: THREE.Quaternion) {
  return new THREE.Quaternion(q.x, -q.y, -q.z, q.w).normalize();
}

/** Weights for walk / jog / run at a speed (they sum to 1). */
export function locomotionClipWeights(speed: number): Record<LocomotionName, number> {
  const s = Number.isFinite(speed) ? speed : 0;
  const { walk, jog, run } = LOCOMOTION_CLIP_SPEED;
  if (s <= walk) return { walk: 1, jog: 0, run: 0 };
  if (s <= jog) { const t = (s - walk) / (jog - walk); return { walk: 1 - t, jog: t, run: 0 }; }
  if (s <= run) { const t = (s - jog) / (run - jog); return { walk: 0, jog: 1 - t, run: t }; }
  return { walk: 0, jog: 0, run: 1 };
}

/** Recording time for the ready position: its steady second played slowly
 * forwards and back (a ping-pong at a third of real speed), so the player is
 * never frozen and the loop has no seam. */
export function readyPoseTime(time: number) {
  const { start, end } = READY_POSE_WINDOW;
  const span = end - start;
  const t = Number.isFinite(time) ? Math.abs(time / 3) % (2 * span) : 0;
  return start + (t <= span ? t : 2 * span - t);
}

function prepareClip(
  name: string, text: string, sources: string[], rest: Map<string, NativeRest>, mirrored: boolean,
  loop: boolean,
): Clip {
  const data = new BVHLoader().parse(text);
  const root = data.skeleton.bones[0];
  const mixer = new THREE.AnimationMixer(root);
  mixer.clipAction(data.clip).play();
  const bones = new Map(data.skeleton.bones.map(bone => [bone.name, bone]));
  const pairs: Pair[] = [];
  TARGETS.forEach((target, i) => {
    const sourceName = mirrored ? mirrorSide(sources[i]) : sources[i];
    const source = bones.get(sourceName);
    const targetRest = rest.get(target);
    if (!source || !targetRest) throw new Error(`Captured ${name} motion is missing ${sourceName}.`);
    // Same bind alignment as the stroke captures: the source bone's direction
    // in its bind pose (toward its first child) onto the target's. (Follow the
    // first-child chain past zero-length joints: in the CMU skeleton the neck
    // sits exactly on the chest joint, which left the chest's direction
    // undefined and threw every re-based arm off.)
    const sourceDirection = new THREE.Vector3();
    let child = source.children.find(object => object instanceof THREE.Bone) as THREE.Bone | undefined;
    while (child && sourceDirection.add(child.position).lengthSq() < 1e-8) {
      child = child.children.find(object => object instanceof THREE.Bone) as THREE.Bone | undefined;
    }
    if (sourceDirection.lengthSq() < 1e-8) sourceDirection.set(0, 1, 0);
    sourceDirection.normalize();
    if (mirrored) sourceDirection.x *= -1;
    const alignment = new THREE.Quaternion()
      .setFromUnitVectors(targetRest.direction.clone().normalize(), sourceDirection)
      .multiply(targetRest.rotation);
    pairs.push({ target, source, alignment, loopError: new THREE.Quaternion() });
  });
  if (!(data.clip.duration > 0)) throw new Error(`Captured ${name} motion is empty.`);
  const clip: Clip = { root, mixer, duration: data.clip.duration, pairs, mirrored };
  if (loop) {
    // A recorded cycle never ends exactly where it began (up to ~8 degrees in
    // an arm). Spread that difference over the cycle so the loop has no pop.
    const start = worldOrientations(clip, 0);
    const end = worldOrientations(clip, data.clip.duration - 1e-4); // (at the duration itself the action wraps to 0)
    pairs.forEach((pair, i) => pair.loopError.copy(start[i]).multiply(end[i].invert()));
  }
  return clip;
}

function worldOrientations(clip: Clip, time: number) {
  clip.mixer.setTime(time);
  clip.root.updateMatrixWorld(true);
  return clip.pairs.map(pair => {
    const q = pair.source.getWorldQuaternion(new THREE.Quaternion());
    return clip.mirrored ? mirrorQuaternionX(q) : q;
  });
}

/** Recorded orientations (in the player's space) of the chain at a time. */
function sampleClip(clip: Clip, time: number, loopFraction = 0) {
  const world = worldOrientations(clip, time);
  const out = new Map<string, THREE.Quaternion>();
  clip.pairs.forEach(({ target, alignment, loopError }, i) => {
    const correction = new THREE.Quaternion().slerp(loopError, loopFraction);
    out.set(target, correction.multiply(world[i]).multiply(alignment));
  });
  return out;
}

/** Share of the chest's lean (as opposed to its turn) that the arms follow. A
 * player leaning into the return stance keeps his arms reaching forward; taking
 * the whole lean swung them down between the knees. */
const LEAN_FOLLOW = 0.1;

/** Re-base recorded arms onto the player's chest and blend them in. */
function applyArms(pose: PoseAccess, sampled: Map<string, THREE.Quaternion>, weight: number) {
  const chestNow = pose.rotation('spine_03');
  const full = chestNow.clone().multiply(sampled.get('spine_03')!.clone().invert());
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(full);
  const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(forward.x, forward.z));
  const rebase = turn.slerp(full, LEAN_FOLLOW);
  for (const target of TARGETS) {
    // (Clavicles stay at rest: the recorded clavicles, set onto this
    // skeleton, raised the shoulders ~5 cm, a hunched look when walking.)
    if (target === 'spine_03' || target.startsWith('clavicle_')) continue;
    const desired = rebase.clone().multiply(sampled.get(target)!);
    pose.orient(target, pose.rotation(target).slerp(desired, weight));
  }
}

export class DmoCapturedLocomotion {
  private readonly clips: Record<LocomotionName, Clip> | null;
  private readonly ready: Record<'right' | 'left', Clip> | null;

  constructor(
    rest: Map<string, NativeRest>,
    sources: Partial<LocomotionMotionSources> & { ready?: string },
  ) {
    this.clips = sources.walk && sources.jog && sources.run ? {
      walk: prepareClip('walk', sources.walk, CMU_SOURCES, rest, false, true),
      jog: prepareClip('jog', sources.jog, CMU_SOURCES, rest, false, true),
      run: prepareClip('run', sources.run, CMU_SOURCES, rest, false, true),
    } : null;
    this.ready = sources.ready ? {
      right: prepareClip('ready', sources.ready, TENNIS_SOURCES, rest, false, false),
      left: prepareClip('ready', sources.ready, TENNIS_SOURCES, rest, true, false),
    } : null;
  }

  get hasLocomotion() { return this.clips !== null; }
  get hasReady() { return this.ready !== null; }

  /** Walking / jogging / running arms. */
  apply(pose: PoseAccess, playback: LocomotionPlayback) {
    const weight = THREE.MathUtils.clamp(playback.weight, 0, 1);
    if (!this.clips || weight <= 0 || !Number.isFinite(playback.phase)) return;
    const phase = ((playback.phase % 1) + 1) % 1;
    const weights = locomotionClipWeights(playback.speed);
    let blended: Map<string, THREE.Quaternion> | undefined;
    let total = 0;
    for (const name of ['walk', 'jog', 'run'] as const) {
      const w = weights[name];
      if (w <= 0) continue;
      const clip = this.clips[name];
      const sampled = sampleClip(clip, phase * clip.duration, phase);
      if (!blended) { blended = sampled; total = w; continue; }
      total += w;
      blended.forEach((q, bone) => q.slerp(sampled.get(bone)!, w / total));
    }
    if (blended) applyArms(pose, blended, weight);
  }

  /**
   * The recorded ready position (standing, waiting, return stance). The
   * recording is a player waiting for a backhand, racket on that side; on its
   * own it read as always about to hit one. Averaging it with its mirror image
   * gives a neutral, centred ready position (the racket hand's own hold is then
   * set by the wrist adjustment and the free hand is nudged onto the throat).
   */
  applyReady(pose: PoseAccess, playback: ReadyPlayback) {
    const weight = THREE.MathUtils.clamp(playback.weight, 0, 1);
    if (!this.ready || weight <= 0) return;
    const time = readyPoseTime(playback.time);
    const own = sampleClip(playback.mirrored ? this.ready.left : this.ready.right, time);
    const mirror = sampleClip(playback.mirrored ? this.ready.right : this.ready.left, time);
    own.forEach((q, bone) => q.slerp(mirror.get(bone)!, 0.5));
    applyArms(pose, own, weight);
  }
}

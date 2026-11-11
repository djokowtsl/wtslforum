import type { BundledRigSchema } from './dmoBundledMotion.mjs';

export const NATIVE_MOTION_AUTOMATIC_PROFILE_KEY = '__automatic_stream_fallback__';
export const NATIVE_MOTION_STROKES = ['forehand', 'backhand', 'serve'] as const;

export type NativeMotionStroke = (typeof NATIVE_MOTION_STROKES)[number];
export type NativeMotionHand = 'left' | 'right';
export type NativeMotionPick = {
  clipId: string;
  sourceHandedness: NativeMotionHand;
};
export type NativeMotionPicks = Partial<Record<NativeMotionStroke, NativeMotionPick>>;

export type NativeMotionCatalogClip = {
  id: string;
  file: string;
  label: string;
  sourceBundle: string;
  originalClipName: string;
  author: string;
  frameCount: number;
  duration: number;
  hidden: boolean;
  acceleration: string;
  accelerationVariant: boolean;
  sourceHandedness: NativeMotionHand | null;
  events: {
    kind: 'strike' | 'serve' | 'serve-waiting';
    contactTime?: number;
    maxExtensionTime?: number;
    tossTime?: number;
  } | null;
};

export type NativeMotionCatalog = {
  format: 'WTMC1';
  rig: BundledRigSchema;
  clips: NativeMotionCatalogClip[];
};

export type NativeMotionProfile = {
  profileKey: string;
  characterName: string;
  automaticFallback: boolean;
  clips: NativeMotionPicks;
  updatedAt?: string;
};

export function nativeMotionProfileKey(name: string) {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-GB');
}

export function firstValidNativeMotionClip(
  catalog: NativeMotionCatalog,
  stroke: NativeMotionStroke,
) {
  return catalog.clips.find((clip) => (
    nativeMotionClipSupportsStroke(clip, stroke)
    && !clip.hidden
    && !clip.acceleration
    && !clip.accelerationVariant
  )) ?? null;
}

export function nativeMotionClipSupportsStroke(
  clip: NativeMotionCatalogClip | undefined,
  stroke: NativeMotionStroke,
) {
  const contactTime = clip?.events?.contactTime;
  return clip?.events?.kind === (stroke === 'serve' ? 'serve' : 'strike')
    && typeof contactTime === 'number'
    && Number.isFinite(contactTime)
    && contactTime >= 0
    && contactTime <= clip.duration;
}

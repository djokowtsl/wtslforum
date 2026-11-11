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

export type NativeMotionCharacterDefaults =
  Partial<Record<NativeMotionStroke, NativeMotionCatalogClip>>;

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

/** A match chooses exactly one clip per stroke; it never creates a variant rotation. */
export function mergeNativeMotionPicks(defaults: NativeMotionPicks = {}, overrides: NativeMotionPicks = {}): NativeMotionPicks {
  return Object.fromEntries(NATIVE_MOTION_STROKES.flatMap((stroke) => {
    const pick = overrides[stroke] ?? defaults[stroke];
    return pick ? [[stroke, pick]] : [];
  }));
}

export function deduplicateNativeMotionCharacterNames(names: readonly unknown[]) {
  const byProfileKey = new Map<string, string>();
  for (const value of names) {
    if (typeof value !== 'string') continue;
    const name = value.trim().replace(/\s+/g, ' ');
    const key = nativeMotionProfileKey(name);
    if (key && !byProfileKey.has(key)) byProfileKey.set(key, name);
  }
  return [...byProfileKey.values()].sort((a, b) => a.localeCompare(b, 'en-GB'));
}

export function firstValidNativeMotionClip(
  catalog: NativeMotionCatalog,
  stroke: NativeMotionStroke,
) {
  return catalog.clips.find((clip) => (
    nativeMotionClipSupportsStroke(clip, stroke)
    && !clip.hidden
    && !clip.accelerationVariant
  )) ?? null;
}

function words(value: string) {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('en-GB')
    .match(/[\p{L}\p{N}]+/gu) ?? [];
}

function isAccelerationClip(clip: NativeMotionCatalogClip) {
  return clip.accelerationVariant
    || words(`${clip.sourceBundle} ${clip.originalClipName} ${clip.label}`)
      .some((word) => word === 'acc' || word === 'acceleration');
}

function clipSupportsNamedStroke(clip: NativeMotionCatalogClip, stroke: NativeMotionStroke) {
  const clipWords = words(`${clip.sourceBundle} ${clip.originalClipName} ${clip.label}`);
  if (stroke === 'serve') {
    return clipWords.some((word) => word === 'serve' || word === 'service');
  }
  if (stroke === 'forehand') {
    return clipWords.some((word) => word === 'forehand' || word === 'fh');
  }
  return clipWords.some((word) => word === 'backhand' || word === 'bh');
}

/**
 * Suggest one character-specific, non-acceleration clip per available stroke.
 * The catalog's `acceleration` field links a regular clip to its faster
 * counterpart, so only `accelerationVariant` identifies the variant itself.
 */
export function nativeMotionCharacterDefaults(
  catalog: NativeMotionCatalog,
  characterName: string,
): NativeMotionCharacterDefaults {
  const identity = words(
    characterName
      .replace(/\([^)]*\)/g, ' ')
      .replace(/\b(classic|master|pro|retro|prime|custom)\b/gi, ' '),
  ).filter((word) => word.length >= 3);
  const surname = identity.at(-1);
  if (!surname) return {};

  const candidates = catalog.clips.flatMap((clip) => {
    if (clip.hidden || isAccelerationClip(clip)) return [];
    const clipWords = new Set(words(`${clip.sourceBundle} ${clip.originalClipName} ${clip.label}`));
    if (!clipWords.has(surname)) return [];
    const identityMatches = identity.filter((word) => clipWords.has(word)).length;
    const variantWords = new Set(words(`${clip.sourceBundle} ${clip.originalClipName} ${clip.label}`));
    const regularBonus = variantWords.has('reg') || variantWords.has('regular') ? -20 : 0;
    const slicePenalty = variantWords.has('slice') ? 12 : 0;
    const version = [...variantWords].map((word) => /^v(\d+)$/.exec(word))
      .filter((match): match is RegExpExecArray => Boolean(match))
      .map((match) => Number(match[1]))
      .sort((a, b) => a - b)[0] ?? 0;
    return [{
      clip,
      identityMatches,
      variantScore: regularBonus + slicePenalty + version,
    }];
  });

  const defaults: NativeMotionCharacterDefaults = {};
  for (const stroke of NATIVE_MOTION_STROKES) {
    const chosen = candidates
      .filter(({ clip }) => (
        nativeMotionClipSupportsStroke(clip, stroke)
        && clipSupportsNamedStroke(clip, stroke)
      ))
      .sort((a, b) => (
        b.identityMatches - a.identityMatches
        || a.variantScore - b.variantScore
        || a.clip.label.localeCompare(b.clip.label, 'en-GB')
        || a.clip.id.localeCompare(b.clip.id)
      ))[0]?.clip;
    if (chosen) defaults[stroke] = chosen;
  }
  return defaults;
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

import type { BundledRigSchema } from './dmoBundledMotion.mjs';

export const NATIVE_MOTION_AUTOMATIC_PROFILE_KEY = '__automatic_stream_fallback__';
export const NATIVE_MOTION_STROKES = ['forehand', 'backhand', 'serve', 'slice-forehand', 'slice-backhand'] as const;

export function nativeMotionStrokeLabel(stroke: NativeMotionStroke) {
  return ({
    forehand: 'Forehand', backhand: 'Backhand', serve: 'Serve',
    'slice-forehand': 'Forehand slice', 'slice-backhand': 'Backhand slice',
  })[stroke];
}

export type NativeMotionStroke = (typeof NATIVE_MOTION_STROKES)[number];
export type NativeMotionHand = 'left' | 'right';
export type NativeMotionPick = {
  clipId: string;
  sourceHandedness: NativeMotionHand;
};
export type NativeMotionPicks = Partial<Record<NativeMotionStroke, NativeMotionPick>>;
/**
 * The animations chosen for one gesture type. `clipId` is the first (older
 * code reads only that); `clipIds`, when present, is the whole set, which
 * the court plays in turn, one per gesture.
 */
export type NativeMotionGesturePick = { clipId: string; clipIds?: string[] };
export const NATIVE_MOTION_GESTURE_SET_LIMIT = 12;

/** Every animation in a gesture choice, in order, without repeats. */
export function nativeMotionGestureClipIds(pick: NativeMotionGesturePick | null | undefined): string[] {
  if (!pick) return [];
  const ids = Array.isArray(pick.clipIds) && pick.clipIds.length ? pick.clipIds : [pick.clipId];
  return [...new Set(ids.filter((id) => typeof id === 'string' && id))].slice(0, NATIVE_MOTION_GESTURE_SET_LIMIT);
}

/** A gesture choice from a list of animations (null when the list is empty). */
export function nativeMotionGesturePickFromIds(ids: readonly string[]): NativeMotionGesturePick | null {
  const unique = [...new Set(ids.filter((id) => typeof id === 'string' && id))].slice(0, NATIVE_MOTION_GESTURE_SET_LIMIT);
  if (!unique.length) return null;
  return unique.length === 1 ? { clipId: unique[0] } : { clipId: unique[0], clipIds: unique };
}
export type NativeMotionGesturePicks = Partial<Record<string, NativeMotionGesturePick>>;

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
    kind: 'strike' | 'serve' | 'serve-waiting' | 'gesture';
    contactTime?: number;
    maxExtensionTime?: number;
    tossTime?: number;
    /** For gestures: the Tennis Elbow gesture type, e.g. 'CheerFist'. */
    gesture?: string;
  } | null;
  /** For gestures from a gesture mod: the mod's name, e.g. 'MyGestures'. */
  gestureMod?: string | null;
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
    && (!stroke.startsWith('slice-') || clipSupportsNamedStroke(clip, stroke))
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
  if (stroke.startsWith('slice-')) {
    return nativeMotionClipSupportsStroke(clip, stroke)
      && clipWords.some((word) => (
        stroke === 'slice-forehand' ? /^(forehand|fh)\d*$/.test(word) : /^(backhand|bh)\d*$/.test(word)
      ));
  }
  if (clipWords.some((word) => /^slice\d*$/.test(word))) return false;
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

/**
 * Build replay defaults without storing them in the database. Character-named
 * clips win; otherwise use the first regular clip whose name identifies that stroke.
 */
export function nativeMotionAutomaticCharacterPicks(
  catalog: NativeMotionCatalog,
  characterName: string,
  sourceHandedness: NativeMotionHand = 'right',
): NativeMotionPicks {
  const named = nativeMotionCharacterDefaults(catalog, characterName);
  return Object.fromEntries(NATIVE_MOTION_STROKES.flatMap((stroke) => {
    const clip = named[stroke] ?? catalog.clips.find((candidate) => (
      nativeMotionClipSupportsStroke(candidate, stroke)
      && clipSupportsNamedStroke(candidate, stroke)
      && !candidate.hidden
      && !isAccelerationClip(candidate)
    ));
    return clip ? [[stroke, { clipId: clip.id, sourceHandedness }]] : [];
  })) as NativeMotionPicks;
}

export function nativeMotionClipSupportsStroke(
  clip: NativeMotionCatalogClip | undefined,
  stroke: NativeMotionStroke,
) {
  const contactTime = clip?.events?.contactTime;
  if (!clip) return false;
  if (stroke.startsWith('slice-')) {
    const clipWords = words(`${clip.sourceBundle} ${clip.originalClipName} ${clip.label}`);
    const isSlice = clipWords.some((word) => /^slice\d*$/.test(word));
    const forehand = clipWords.some((word) => /^(forehand|fh)\d*$/.test(word));
    const backhand = clipWords.some((word) => /^(backhand|bh)\d*$/.test(word));
    // Side-neutral slice names remain available for explicit admin assignment;
    // known opposite-side recordings must not be offered for the wrong side.
    if (!isSlice || (stroke === 'slice-forehand' ? backhand : forehand)) {
      return false;
    }
  }
  return clip?.events?.kind === (stroke === 'serve' ? 'serve' : 'strike')
    && typeof contactTime === 'number'
    && Number.isFinite(contactTime)
    && contactTime >= 0
    && contactTime <= clip.duration;
}

/**
 * The catalog's animations for one Tennis Elbow gesture type ('CheerFist',
 * 'Stupid' ...), e.g. a gesture mod's "siu" fist pump. Never strokes.
 */
export function nativeMotionGestureClips(catalog: NativeMotionCatalog | null | undefined, gesture: string) {
  return (catalog?.clips ?? []).filter((clip) => (
    clip.events?.kind === 'gesture' && clip.events.gesture === gesture && !clip.hidden
  ));
}

// Gesture libraries have many clips; cap automatic variants to keep replay startup light.
const AUTOMATIC_GESTURE_VARIANT_LIMIT = 3;

/** Use character-named gesture clips when present; otherwise choose a varied, bounded set. */
export function nativeMotionCharacterGestureDefaults(
  catalog: NativeMotionCatalog | null | undefined,
  characterName: string,
): NativeMotionGesturePicks {
  const identity = words(
    characterName
      .replace(/\([^)]*\)/g, ' ')
      .replace(/\b(classic|master|pro|retro|prime|custom)\b/gi, ' '),
  ).filter((word) => word.length >= 3);
  const surname: string | undefined = identity.at(-1);
  if (typeof surname !== 'string' || !surname) return {};

  const types = [...new Set((catalog?.clips ?? [])
    .filter((clip) => clip.events?.kind === 'gesture' && clip.events.gesture && !clip.hidden)
    .map((clip) => clip.events!.gesture!))]
    .sort((a, b) => a.localeCompare(b, 'en-GB'));
  const defaults: NativeMotionGesturePicks = {};
  for (const type of types) {
    const clips = nativeMotionGestureClips(catalog, type)
      .sort((a, b) => a.label.localeCompare(b.label, 'en-GB') || a.id.localeCompare(b.id));
    const named = clips.filter((clip) => (
      words(`${clip.sourceBundle} ${clip.originalClipName} ${clip.label}`)
        .some((word) => word === surname)
    ));
    const candidates = named.length ? named : clips;
    let offset = 0;
    for (const character of `${characterName}:${type}`) {
      offset = (offset * 31 + character.charCodeAt(0)) >>> 0;
    }
    const count = Math.min(AUTOMATIC_GESTURE_VARIANT_LIMIT, candidates.length);
    const selected = Array.from({ length: count }, (_, index) => (
      candidates[(offset + index) % candidates.length]
    ));
    const pick = nativeMotionGesturePickFromIds(selected.map((clip) => clip.id));
    if (pick) defaults[type] = pick;
  }
  return defaults;
}

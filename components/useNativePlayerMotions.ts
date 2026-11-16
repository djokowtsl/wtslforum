'use client';

import { useEffect, useState } from 'react';
import {
  decodeBundledMotion,
  type BundledMotionClip,
  type BundledRigSchema,
} from '@/lib/dmoBundledMotion.mjs';
import {
  NATIVE_MOTION_CATALOG_SHA256,
  NATIVE_MOTION_GESTURE_CATALOG_SHA256,
} from '@/lib/nativeMotionCatalog';
import {
  getDmoCharacterGruntSetting,
  type DmoCharacterGruntSetting,
} from '@/lib/dmoCharacterAppearance.mjs';
import {
  NATIVE_MOTION_STROKES,
  nativeMotionClipSupportsStroke,
  nativeMotionGestureClips,
  mergeNativeMotionPicks,
  type NativeMotionCatalog,
  type NativeMotionGesturePicks,
  type NativeMotionPicks,
  type NativeMotionProfile,
  type NativeMotionStroke,
} from '@/lib/nativeMotionCatalogData';
import type { BundledMotionSource } from './DmoBundledGroundstroke';

type SourcePair = readonly [BundledMotionSource | null, BundledMotionSource | null];
type GestureMotionSource = {
  schema: BundledMotionSource['schema'];
  clips: Readonly<Record<string, BundledMotionClip>>;
};
type GestureSourcePair = readonly [GestureMotionSource | null, GestureMotionSource | null];
type ProfileResponse = {
  playerProfileKeys: [string | null, string | null];
  profiles: NativeMotionProfile[];
  playerClipOverrides?: [NativeMotionPicks, NativeMotionPicks];
  playerGestureOverrides?: [NativeMotionGesturePicks, NativeMotionGesturePicks];
  playerGruntSettings?: [DmoCharacterGruntSetting, DmoCharacterGruntSetting];
};

const catalogPromises = new Map<string, Promise<NativeMotionCatalog>>();
const decodedClips = new Map<string, Promise<BundledMotionClip>>();

function loadCatalog(hash: string) {
  let promise = catalogPromises.get(hash);
  if (!promise) {
    promise = fetch(
      `/api/native-motion/${hash}/catalog.json`,
      { cache: 'force-cache' },
    ).then(async (response) => {
      if (!response.ok) throw new Error(`Catalog request returned ${response.status}.`);
      const catalog = await response.json() as NativeMotionCatalog;
      if (catalog.format !== 'WTMC1' || !catalog.rig?.modelHash || !Array.isArray(catalog.clips)) {
        throw new Error('The native animation catalog is invalid.');
      }
      return catalog;
    }).catch((error) => {
      catalogPromises.delete(hash);
      throw error;
    });
    catalogPromises.set(hash, promise);
  }
  return promise;
}

function loadClip(clipId: string, catalog: NativeMotionCatalog, hash: string) {
  const key = `${hash}:${clipId}`;
  let promise = decodedClips.get(key);
  if (!promise) {
    promise = fetch(
      `/api/native-motion/${hash}/${encodeURIComponent(`${clipId}.wtm`)}`,
      { cache: 'force-cache' },
    ).then(async (response) => {
      if (!response.ok) throw new Error(`Animation clip request returned ${response.status}.`);
      return decodeBundledMotion(await response.arrayBuffer(), catalog.rig as BundledRigSchema);
    }).catch((error) => {
      decodedClips.delete(key);
      throw error;
    });
    decodedClips.set(key, promise);
  }
  return promise;
}

export function useNativePlayerMotions({
  playerNames,
  broadcastId,
  submissionId,
  overridePlayerOrder = [0, 1],
  allowAutomaticFallback = false,
}: {
  playerNames: readonly [string | null | undefined, string | null | undefined];
  broadcastId?: string;
  submissionId?: string;
  overridePlayerOrder?: readonly [number, number];
  allowAutomaticFallback?: boolean;
}) {
  const [sources, setSources] = useState<SourcePair>([null, null]);
  const [gestureSources, setGestureSources] = useState<GestureSourcePair>([null, null]);
  const [playerGruntSettings, setPlayerGruntSettings] = useState<
    [DmoCharacterGruntSetting, DmoCharacterGruntSetting]
  >([
    getDmoCharacterGruntSetting(playerNames[0]),
    getDmoCharacterGruntSetting(playerNames[1]),
  ]);
  const [error, setError] = useState('');
  const [gestureError, setGestureError] = useState('');
  const playerOne = playerNames[0]?.trim() ?? '';
  const playerTwo = playerNames[1]?.trim() ?? '';
  const orderOne = overridePlayerOrder[0];
  const orderTwo = overridePlayerOrder[1];

  useEffect(() => {
    let active = true;
    let inFlight = false;
    let requestController: AbortController | null = null;
    // What was last handed to the court. Live broadcasts re-check every 10
    // seconds; the court rebuilds its whole 3D scene whenever `sources`
    // changes, so an unchanged answer must never produce a new value.
    let appliedPicks: string | null = null;
    let appliedGesturePicks: string | null = null;
    let appliedGrunts = '';
    const applyGrunts = (next: [DmoCharacterGruntSetting, DmoCharacterGruntSetting]) => {
      const key = JSON.stringify(next);
      if (key === appliedGrunts) return;
      appliedGrunts = key;
      setPlayerGruntSettings(next);
    };
    setSources([null, null]);
    setGestureSources([null, null]);
    setError('');
    setGestureError('');
    applyGrunts([
      getDmoCharacterGruntSetting(playerOne),
      getDmoCharacterGruntSetting(playerTwo),
    ]);

    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      const controller = new AbortController();
      requestController = controller;
      try {
        const params = new URLSearchParams({
          player1: playerOne,
          player2: playerTwo,
        });
        if (broadcastId) params.set('broadcastId', broadcastId);
        if (submissionId) params.set('submissionId', submissionId);
        if (submissionId) {
          params.set('playerIndex1', String(orderOne));
          params.set('playerIndex2', String(orderTwo));
        }
        if (allowAutomaticFallback) params.set('fallback', '1');
        const response = await fetch(`/api/native-motion/profiles?${params.toString()}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Profile request returned ${response.status}.`);
        const payload = await response.json() as ProfileResponse;
        if (!Array.isArray(payload.playerProfileKeys) || !Array.isArray(payload.profiles)) {
          throw new Error('The saved animation profile response is invalid.');
        }
        const resolvedGrunts = payload.playerGruntSettings
          ?? [getDmoCharacterGruntSetting(playerOne), getDmoCharacterGruntSetting(playerTwo)];
        if (active) applyGrunts(resolvedGrunts);
        const profiles = new Map(payload.profiles.map((profile) => [profile.profileKey, profile]));
        const selected = payload.playerProfileKeys.map((key) => key ? profiles.get(key) ?? null : null) as [
          NativeMotionProfile | null,
          NativeMotionProfile | null,
        ];
        const direct = payload.playerClipOverrides ?? [{}, {}];
        const chosenPicks: [NativeMotionPicks, NativeMotionPicks] = [
          mergeNativeMotionPicks(selected[0]?.clips, direct[orderOne]),
          mergeNativeMotionPicks(selected[1]?.clips, direct[orderTwo]),
        ];
        const directGestures = payload.playerGestureOverrides ?? [{}, {}];
        const gesturePicks: [NativeMotionGesturePicks, NativeMotionGesturePicks] = [
          directGestures[orderOne],
          directGestures[orderTwo],
        ];
        const picksKey = JSON.stringify(chosenPicks);
        const gesturePicksKey = JSON.stringify(gesturePicks);
        // Same choices as last time: nothing to load, nothing to change.
        if (picksKey !== appliedPicks) {
          if (!chosenPicks.some((picks) => Object.keys(picks).length)) {
            if (active) {
              appliedPicks = picksKey;
              setSources([null, null]);
            }
          } else {
            const catalog = await loadCatalog(NATIVE_MOTION_CATALOG_SHA256);
            const clipIds = [...new Set(chosenPicks.flatMap((picks) => (
              Object.values(picks).flatMap((pick) => pick ? [pick.clipId] : [])
            )))];
            const loadedClips = new Map(await Promise.all(clipIds.map(async (id) => (
              [id, await loadClip(id, catalog, NATIVE_MOTION_CATALOG_SHA256)] as const
            ))));
            const sourceFor = (picks: NativeMotionPicks): BundledMotionSource | null => {
              const clips: BundledMotionSource['clips'] = {};
              for (const stroke of NATIVE_MOTION_STROKES) {
                const pick = picks[stroke];
                if (!pick) continue;
                const metadata = catalog.clips.find((clip) => clip.id === pick.clipId);
                if (!nativeMotionClipSupportsStroke(metadata, stroke) || !metadata?.events) {
                  throw new Error(`The saved ${stroke} clip has no matching SDK event marker.`);
                }
                if (
                  !Number.isFinite(metadata.events.contactTime)
                  || metadata.events.contactTime! < 0
                  || metadata.events.contactTime! > metadata.duration
                  || !['left', 'right'].includes(pick.sourceHandedness)
                ) {
                  throw new Error(`The saved ${stroke} clip has invalid timing or source handedness.`);
                }
                const clip = loadedClips.get(pick.clipId);
                if (!clip) throw new Error('The saved animation clip was not loaded.');
                clips[stroke] = {
                  clip,
                  contactTime: metadata.events.contactTime!,
                  sourceHandedness: pick.sourceHandedness,
                };
              }
              return Object.keys(clips).length ? { schema: catalog.rig, clips } : null;
            };
            const next: SourcePair = [sourceFor(chosenPicks[0]), sourceFor(chosenPicks[1])];
            if (active) {
              appliedPicks = picksKey;
              setSources(next);
              setError('');
            }
          }
        }

        if (gesturePicksKey !== appliedGesturePicks) {
          if (!gesturePicks.some((picks) => Object.keys(picks).length)) {
            if (active) {
              appliedGesturePicks = gesturePicksKey;
              setGestureSources([null, null]);
              setGestureError('');
            }
          } else {
            try {
              const catalog = await loadCatalog(NATIVE_MOTION_GESTURE_CATALOG_SHA256);
              const clipIds = [...new Set(gesturePicks.flatMap((picks) => (
                Object.values(picks).flatMap((pick) => pick ? [pick.clipId] : [])
              )))];
              const loadedClips = new Map(await Promise.all(clipIds.map(async (id) => (
                [id, await loadClip(id, catalog, NATIVE_MOTION_GESTURE_CATALOG_SHA256)] as const
              ))));
              const sourceFor = (picks: NativeMotionGesturePicks): GestureMotionSource | null => {
                const clips: Record<string, BundledMotionClip> = {};
                for (const [type, pick] of Object.entries(picks)) {
                  if (!pick) continue;
                  const metadata = nativeMotionGestureClips(catalog, type)
                    .find((clip) => clip.id === pick.clipId);
                  const clip = loadedClips.get(pick.clipId);
                  if (!metadata || !clip || metadata.duration !== clip.duration
                    || clip.rigHash !== catalog.rig.rigHash) {
                    throw new Error(`The saved ${type} gesture clip is unavailable or invalid.`);
                  }
                  clips[type] = clip;
                }
                return Object.keys(clips).length ? { schema: catalog.rig, clips } : null;
              };
              const next: GestureSourcePair = [sourceFor(gesturePicks[0]), sourceFor(gesturePicks[1])];
              if (active) {
                appliedGesturePicks = gesturePicksKey;
                setGestureSources(next);
                setGestureError('');
              }
            } catch {
              if (active) {
                setGestureSources([null, null]);
                setGestureError('A selected gesture clip could not be loaded; standard motion remains active.');
              }
            }
          }
        }
      } catch (cause) {
        // A failed re-check during a broadcast keeps the animations already
        // showing; only a failed first load falls back to standard motion.
        if (appliedPicks !== null) return;
        if (active && !(cause instanceof DOMException && cause.name === 'AbortError')) {
          setError('Saved character animations could not be loaded; standard replay motion is active.');
          setSources([null, null]);
          applyGrunts([
            getDmoCharacterGruntSetting(playerOne),
            getDmoCharacterGruntSetting(playerTwo),
          ]);
        }
      } finally {
        inFlight = false;
        if (requestController === controller) requestController = null;
      }
    };

    void load();
    const poll = broadcastId ? window.setInterval(() => { void load(); }, 10_000) : undefined;
    return () => {
      active = false;
      requestController?.abort();
      if (poll) window.clearInterval(poll);
    };
  }, [playerOne, playerTwo, broadcastId, submissionId, orderOne, orderTwo, allowAutomaticFallback]);

  const combine = (index: 0 | 1): BundledMotionSource | null => {
    const motion = sources[index];
    const gestures = gestureSources[index];
    if (!motion && !gestures) return null;
    return {
      schema: motion?.schema ?? gestures!.schema,
      clips: motion?.clips ?? {},
      ...(gestures ? { gestures: gestures.clips } : {}),
    };
  };
  const combinedSources: SourcePair = [combine(0), combine(1)];
  return { sources: combinedSources, error, gestureError, playerGruntSettings };
}

'use client';

import { useEffect, useState } from 'react';
import {
  decodeBundledMotion,
  type BundledMotionClip,
  type BundledRigSchema,
} from '@/lib/dmoBundledMotion.mjs';
import { NATIVE_MOTION_CATALOG_SHA256 } from '@/lib/nativeMotionCatalog';
import {
  nativeMotionClipSupportsStroke,
  mergeNativeMotionPicks,
  type NativeMotionCatalog,
  type NativeMotionPicks,
  type NativeMotionProfile,
  type NativeMotionStroke,
} from '@/lib/nativeMotionCatalogData';
import type { BundledMotionSource } from './DmoBundledGroundstroke';

type SourcePair = readonly [BundledMotionSource | null, BundledMotionSource | null];
type ProfileResponse = {
  playerProfileKeys: [string | null, string | null];
  profiles: NativeMotionProfile[];
  playerClipOverrides?: [NativeMotionPicks, NativeMotionPicks];
};

let catalogPromise: Promise<NativeMotionCatalog> | null = null;
const decodedClips = new Map<string, Promise<BundledMotionClip>>();

function loadCatalog() {
  if (!catalogPromise) {
    catalogPromise = fetch(
      `/api/native-motion/${NATIVE_MOTION_CATALOG_SHA256}/catalog.json`,
      { cache: 'force-cache' },
    ).then(async (response) => {
      if (!response.ok) throw new Error(`Catalog request returned ${response.status}.`);
      const catalog = await response.json() as NativeMotionCatalog;
      if (catalog.format !== 'WTMC1' || !catalog.rig?.modelHash || !Array.isArray(catalog.clips)) {
        throw new Error('The native animation catalog is invalid.');
      }
      return catalog;
    }).catch((error) => {
      catalogPromise = null;
      throw error;
    });
  }
  return catalogPromise;
}

function loadClip(clipId: string, catalog: NativeMotionCatalog) {
  let promise = decodedClips.get(clipId);
  if (!promise) {
    promise = fetch(
      `/api/native-motion/${NATIVE_MOTION_CATALOG_SHA256}/${encodeURIComponent(`${clipId}.wtm`)}`,
      { cache: 'force-cache' },
    ).then(async (response) => {
      if (!response.ok) throw new Error(`Animation clip request returned ${response.status}.`);
      return decodeBundledMotion(await response.arrayBuffer(), catalog.rig as BundledRigSchema);
    }).catch((error) => {
      decodedClips.delete(clipId);
      throw error;
    });
    decodedClips.set(clipId, promise);
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
  const [error, setError] = useState('');
  const playerOne = playerNames[0]?.trim() ?? '';
  const playerTwo = playerNames[1]?.trim() ?? '';
  const orderOne = overridePlayerOrder[0];
  const orderTwo = overridePlayerOrder[1];

  useEffect(() => {
    let active = true;
    let inFlight = false;
    let requestController: AbortController | null = null;
    setSources([null, null]);
    setError('');

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
        if (!chosenPicks.some((picks) => Object.keys(picks).length)) {
          if (active) setSources([null, null]);
          return;
        }

        const catalog = await loadCatalog();
        const clipIds = [...new Set(chosenPicks.flatMap((picks) => (
          Object.values(picks).flatMap((pick) => pick ? [pick.clipId] : [])
        )))];
        const loadedClips = new Map(await Promise.all(clipIds.map(async (id) => (
          [id, await loadClip(id, catalog)] as const
        ))));
        const sourceFor = (picks: NativeMotionPicks): BundledMotionSource | null => {
          const clips: BundledMotionSource['clips'] = {};
          for (const stroke of ['forehand', 'backhand', 'serve'] as const) {
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
          setSources(next);
          setError('');
        }
      } catch (cause) {
        if (active && !(cause instanceof DOMException && cause.name === 'AbortError')) {
          setError('Saved character animations could not be loaded; standard replay motion is active.');
          setSources([null, null]);
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

  return { sources, error };
}

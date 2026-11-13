import { createHash } from 'node:crypto';
import { get, put } from '@vercel/blob';
import { analyzeDmoBuffer } from '@/lib/te4DmoAnalysis';
import { MAX_DMO_BYTES } from '@/lib/te4DmoParser';
import {
  getPublicDmoReplay,
  getDmoReplaySubmission,
  type DmoSubmissionReplay,
  type StoredDmoReplay,
} from '@/lib/dmoReplayLibrary';

/**
 * Loading a replay's viewer data for the stored-commentary routes.
 *
 * Mirrors app/api/dmo-replays/[id]/replay/route.ts: the same access rule and
 * the same cached file in private storage, so whichever runs first analyses
 * the recording and the other reuses it. Keep the two in step.
 */
export type ViewerData = ReturnType<typeof analyzeDmoBuffer>['viewer'];
const inFlight = new Map<string, Promise<ViewerData>>();

export function replayCachePath(id: string, sourcePath: string) {
  const sourceKey = createHash('sha256').update(sourcePath).digest('hex').slice(0, 20);
  return `dmo-submission-replays/${id}-${sourceKey}.json`;
}

function parseCachedViewer(value: unknown): ViewerData | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const viewer = (value as Record<string, unknown>).viewer;
  if (
    !viewer
    || typeof viewer !== 'object'
    || Array.isArray(viewer)
    || !Array.isArray((viewer as Record<string, unknown>).names)
    || typeof ((viewer as Record<string, unknown>).match as { d?: unknown } | undefined)?.d !== 'string'
  ) return null;
  return viewer as ViewerData;
}

async function getViewerData(input: {
  id: string;
  sourcePath: string;
  fileName: string;
  storeId: string;
}): Promise<ViewerData> {
  const key = replayCachePath(input.id, input.sourcePath);
  const cached = await get(key, { access: 'private', storeId: input.storeId, useCache: false });
  if (cached?.statusCode === 200 && cached.stream) {
    const cachedJson = await new Response(cached.stream).json().catch(() => null);
    const viewer = parseCachedViewer(cachedJson);
    if (!viewer) throw new Error('Cached replay data is invalid.');
    return viewer;
  }

  const source = await get(input.sourcePath, {
    access: 'private',
    storeId: input.storeId,
    useCache: false,
  });
  if (!source || source.statusCode !== 200 || !source.stream) {
    throw new Error('The submitted recording is no longer available.');
  }
  if (source.blob.size > MAX_DMO_BYTES) {
    throw new Error('The submitted recording is too large to play.');
  }

  const bytes = Buffer.from(await new Response(source.stream).arrayBuffer());
  if (bytes.length > MAX_DMO_BYTES) {
    throw new Error('The submitted recording is too large to play.');
  }
  const analysis = analyzeDmoBuffer(bytes, input.fileName);
  const replayJson = JSON.stringify({ viewer: analysis.viewer });
  if (Buffer.byteLength(replayJson) > MAX_DMO_BYTES) {
    throw new Error('The replay data is too large to play.');
  }
  await put(key, replayJson, {
    access: 'private',
    storeId: input.storeId,
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  });
  return analysis.viewer;
}


/**
 * The replay a viewer may watch: any submission when signed in, otherwise only
 * public replays (the same rule as the replay route).
 */
export async function findViewableDmoReplay(id: string, signedIn: boolean) {
  const replay = signedIn ? await getDmoReplaySubmission(id) : await getPublicDmoReplay(id);
  if (!replay || !replay.privateBlobPathname || !replay.fileName) return null;
  return replay as (StoredDmoReplay | DmoSubmissionReplay) & { privateBlobPathname: string; fileName: string };
}

/** Viewer data for a replay, analysed once and cached in private storage. */
export function loadDmoReplayViewer(input: {
  id: string;
  sourcePath: string;
  fileName: string;
  storeId: string;
}): Promise<ViewerData> {
  const key = replayCachePath(input.id, input.sourcePath);
  let pending = inFlight.get(key);
  if (!pending) {
    pending = getViewerData(input);
    inFlight.set(key, pending);
    void pending.finally(() => {
      if (inFlight.get(key) === pending) inFlight.delete(key);
    }).catch(() => undefined);
  }
  return pending;
}

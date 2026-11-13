import { createHash } from 'node:crypto';
import { get, put } from '@vercel/blob';
import { alignDmoReplayPlayerStyles } from '@/lib/dmoReplayCharacterStyles';
import { buildDmoReplayCommentaryPoints } from '@/lib/dmoReplayCommentary';
import { dmoReplayIsWta } from '@/lib/dmoReplayTour';
import { normalizeDmoTournamentName } from '@/lib/dmoTournamentName.mjs';
import { getDmoCommentaryContext } from '@/lib/liveScores';
import {
  buildDmoCommentaryScript,
  DMO_COMMENTARY_SCRIPT_VERSION,
  type DmoCommentaryScriptCue,
} from '@/lib/dmoCommentaryScript.mjs';
import type { ViewerData } from '@/lib/dmoReplayViewerData';

/**
 * Stored replay commentary.
 *
 * Each replay's commentary is scripted once and every line is turned into an
 * MP3 once, by the WTSL bot's Kokoro, then kept in private storage. Viewers
 * only download and play the stored clips: no model download, no speech
 * generation on their device, and no wait after the first viewer.
 *
 * Clips are named by a hash of their voice and text, so a line shared by many
 * replays ("Deuce." in the same voice) is stored once.
 */

export type DmoCommentaryCue = DmoCommentaryScriptCue & { clip: string };
export type DmoCommentaryTrack = {
  version: number;
  fps: number;
  cues: DmoCommentaryCue[];
  /** Every clip is stored; nothing left to prepare. */
  complete?: boolean;
};

const CLIP_FORMAT_VERSION = 1;

export function dmoCommentaryClipKey(cue: { voice: string; speed: number; text: string }) {
  return createHash('sha256')
    .update(`${CLIP_FORMAT_VERSION}|${cue.voice}|${cue.speed.toFixed(2)}|${cue.text}`)
    .digest('hex')
    .slice(0, 32);
}

const clipPath = (clip: string) => `dmo-commentary/clips/${clip}.mp3`;

function scriptPath(id: string, sourcePath: string) {
  const sourceKey = createHash('sha256').update(sourcePath).digest('hex').slice(0, 20);
  return `dmo-commentary/scripts/${id}-${sourceKey}-v${DMO_COMMENTARY_SCRIPT_VERSION}.json`;
}

function parseTrack(value: unknown): DmoCommentaryTrack | null {
  if (!value || typeof value !== 'object') return null;
  const track = value as DmoCommentaryTrack;
  if (track.version !== DMO_COMMENTARY_SCRIPT_VERSION || !Array.isArray(track.cues)) return null;
  return track.cues.every((cue) => typeof cue?.clip === 'string' && typeof cue.text === 'string')
    ? track
    : null;
}

export type CommentaryReplay = {
  id: string;
  tournament: string;
  player1: string;
  player2: string;
  privateBlobPathname: string;
};

// Scripts recently used by this server instance; clip requests skip storage.
const recentTracks = new Map<string, DmoCommentaryTrack>();
function remember(key: string, track: DmoCommentaryTrack) {
  recentTracks.delete(key);
  recentTracks.set(key, track);
  while (recentTracks.size > 50) recentTracks.delete(recentTracks.keys().next().value!);
  return track;
}

/**
 * The replay's commentary script, built and stored on first request. The
 * replay's recording is only loaded when the script has to be built.
 */
export async function getDmoCommentaryTrack(
  replay: CommentaryReplay,
  loadViewer: () => Promise<ViewerData>,
  storeId: string,
): Promise<DmoCommentaryTrack> {
  const key = scriptPath(replay.id, replay.privateBlobPathname);
  const cached = recentTracks.get(key);
  if (cached) return cached;
  const stored = await get(key, { access: 'private', storeId, useCache: false }).catch(() => null);
  if (stored?.statusCode === 200 && stored.stream) {
    const track = parseTrack(await new Response(stored.stream).json().catch(() => null));
    if (track) return remember(key, track);
  }

  const viewer = await loadViewer();

  const submitted: [string, string] = [replay.player1.trim(), replay.player2.trim()];
  const names = alignDmoReplayPlayerStyles(submitted, viewer.names, submitted);
  if (!names[0] || !names[1]) throw new Error('Verified player names are unavailable for this replay.');
  const isWta = dmoReplayIsWta(replay.tournament) ?? false;
  const context = await getDmoCommentaryContext(names, isWta).catch(() => null);
  const script = buildDmoCommentaryScript({
    names,
    points: buildDmoReplayCommentaryPoints(viewer),
    fps: viewer.match.fps,
    tournament: normalizeDmoTournamentName(viewer.tournament) ?? '',
    surface: viewer.surface,
    // The replay player introduces matches without a round (`auto`).
    round: 'auto',
    context,
  });
  const track: DmoCommentaryTrack = {
    ...script,
    cues: script.cues.map((cue) => ({ ...cue, clip: dmoCommentaryClipKey(cue) })),
  };
  await put(key, JSON.stringify(track), {
    access: 'private',
    storeId,
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  });
  return remember(key, track);
}

export async function dmoCommentaryClipExists(clip: string, storeId: string) {
  const stored = await get(clipPath(clip), { access: 'private', storeId, useCache: false }).catch(() => null);
  await stored?.stream?.cancel().catch(() => undefined);
  return stored?.statusCode === 200;
}

export async function readDmoCommentaryClip(clip: string, storeId: string) {
  const stored = await get(clipPath(clip), { access: 'private', storeId, useCache: false }).catch(() => null);
  if (stored?.statusCode !== 200 || !stored.stream) return null;
  return new Uint8Array(await new Response(stored.stream).arrayBuffer());
}

/** Ask the bot for one line as MP3 and store it under its clip name. */
export async function generateDmoCommentaryClip(
  cue: { text: string; voice: string; speed: number; clip: string },
  storeId: string,
) {
  const base = (process.env.WTSL_CORE_API_URL || '').replace(/\/+$/, '');
  const token = process.env.WTSL_CORE_API_KEY || '';
  if (!base || !token) throw new Error('The commentary voice is not configured.');
  const response = await fetch(`${base}/api/core/commentary/speech`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'audio/mpeg, application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: cue.text, voice: cue.voice, speed: cue.speed, format: 'mp3' }),
    cache: 'no-store',
    signal: AbortSignal.timeout(50_000),
  });
  if (!response.ok || !response.headers.get('content-type')?.startsWith('audio/mpeg')) {
    const problem = response.headers.get('content-type')?.includes('application/json')
      ? await response.json().catch(() => null) as { error?: string } | null
      : null;
    const error = new Error(`The commentary voice returned ${response.status}.`) as Error & {
      busy?: boolean;
      retryAfter?: string;
    };
    error.busy = response.status === 503 && problem?.error === 'speech_busy';
    error.retryAfter = response.headers.get('Retry-After') ?? undefined;
    throw error;
  }
  const audio = new Uint8Array(await response.arrayBuffer());
  await put(clipPath(cue.clip), Buffer.from(audio), {
    access: 'private',
    storeId,
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'audio/mpeg',
  });
  return audio;
}

/**
 * One clip of this replay's commentary: from storage, or generated once and
 * stored. Only lines in the replay's own script can be requested.
 */
export async function getDmoCommentaryClip(track: DmoCommentaryTrack, clip: string, storeId: string) {
  const cue = track.cues.find((candidate) => candidate.clip === clip);
  if (!cue) return null;
  return (await readDmoCommentaryClip(clip, storeId)) ?? generateDmoCommentaryClip(cue, storeId);
}

/**
 * The order to store clips in. From the start of the replay by default; when
 * a viewer is part-way through, the score summary they'll hear and the calls
 * from their position on come first, then everything else in script order.
 */
export function dmoCommentaryPreparationOrder<Cue extends { at: number | null; kind?: string }>(
  cues: readonly Cue[],
  fromFrame: number | null = null,
): Cue[] {
  if (fromFrame === null || !Number.isFinite(fromFrame) || fromFrame <= 0) return [...cues];
  let join: Cue | null = null;
  for (const cue of cues) {
    if (cue.kind === 'join' && cue.at !== null && cue.at <= fromFrame
      && (!join || (join.at ?? -1) < cue.at)) join = cue;
  }
  const ahead = cues
    .filter((cue) => cue.at !== null && cue.at >= fromFrame && cue.kind !== 'join')
    .sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  const first = join ? [join, ...ahead] : ahead;
  const chosen = new Set(first);
  return [...first, ...cues.filter((cue) => !chosen.has(cue))];
}

/**
 * Generate missing clips in script order until the time budget runs out, so
 * the first viewer rarely waits and later viewers never do. Safe to run again:
 * stored clips are skipped.
 */
export async function prepareDmoCommentaryClips(
  replay: CommentaryReplay,
  track: DmoCommentaryTrack,
  storeId: string,
  budgetMs = 45_000,
  fromFrame: number | null = null,
) {
  const total = new Set(track.cues.map((cue) => cue.clip)).size;
  if (track.complete) return { ready: total, total };
  const deadline = Date.now() + budgetMs;
  const seen = new Set<string>();
  let ready = 0;
  for (const cue of dmoCommentaryPreparationOrder(track.cues, fromFrame)) {
    if (seen.has(cue.clip)) continue;
    seen.add(cue.clip);
    if (Date.now() > deadline) break;
    if (await dmoCommentaryClipExists(cue.clip, storeId)) {
      ready += 1;
      continue;
    }
    try {
      await generateDmoCommentaryClip(cue, storeId);
      ready += 1;
    } catch {
      break; // The bot is unavailable; viewers' requests will retry per clip.
    }
  }
  if (ready === total) {
    const key = scriptPath(replay.id, replay.privateBlobPathname);
    remember(key, { ...track, complete: true });
    await put(key, JSON.stringify({ ...track, complete: true }), {
      access: 'private',
      storeId,
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
    }).catch(() => undefined);
  }
  return { ready, total };
}

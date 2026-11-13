import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { isDmoReplayId, listDmoReplaySubmissions } from '@/lib/dmoReplayLibrary';
import { findViewableDmoReplay, loadDmoReplayViewer } from '@/lib/dmoReplayViewerData';
import {
  getDmoCommentaryTrack,
  listMissingDmoCommentaryClips,
  markDmoCommentaryTrackComplete,
  storeDmoCommentaryClip,
} from '@/lib/dmoCommentaryTrack';

/**
 * Commentary builder API, for the script that makes replay commentary clips
 * on an admin's own computer (scripts/build-commentary-clips/). The bot is
 * never involved, so building can't slow the rest of the Forum.
 *
 *   GET  ?                          replay ids to build (paged with ?cursor=)
 *   GET  ?replay=<id>               lines of that replay not yet stored
 *   PUT  ?replay=<id>&clip=<clip>   store one MP3 (request body)
 *
 * Requires `Authorization: Bearer <DMO_COMMENTARY_UPLOAD_KEY>`. With no key
 * configured (or one under 24 characters) the API is switched off.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const MAX_CLIP_BYTES = 512 * 1024;

const digest = (value: string) => createHash('sha256').update(value).digest();

function authorized(request: Request) {
  const key = process.env.DMO_COMMENTARY_UPLOAD_KEY?.trim() ?? '';
  if (key.length < 24) return false;
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer (.+)$/.exec(header);
  return Boolean(match) && timingSafeEqual(digest(match![1].trim()), digest(key));
}

const deny = () => NextResponse.json({ error: 'Not authorized.' }, { status: 401, headers: HEADERS });

/** MP3 starts with an ID3 tag or an MPEG audio frame sync. */
function looksLikeMp3(bytes: Uint8Array) {
  if (bytes.length < 4) return false;
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return true;
  return bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
}

async function loadTrack(id: string, storeId: string) {
  const replay = await findViewableDmoReplay(id, true);
  if (!replay) return null;
  const track = await getDmoCommentaryTrack(replay, () => loadDmoReplayViewer({
    id,
    sourcePath: replay.privateBlobPathname,
    fileName: replay.fileName,
    storeId,
  }), storeId);
  return { replay, track };
}

export async function GET(request: Request) {
  if (!authorized(request)) return deny();
  const storeId = process.env.MODERATION_BLOB_STORE_ID;
  if (!storeId) {
    return NextResponse.json({ error: 'Replay storage is not configured.' }, { status: 503, headers: HEADERS });
  }
  const url = new URL(request.url);
  const id = url.searchParams.get('replay');

  if (id === null) {
    const rawCursor = url.searchParams.get('cursor');
    const cursor = rawCursor && isDmoReplayId(rawCursor) ? rawCursor : null;
    const page = await listDmoReplaySubmissions({ cursor, limit: 50 });
    return NextResponse.json(page, { headers: HEADERS });
  }

  if (!isDmoReplayId(id)) {
    return NextResponse.json({ error: 'Match replay not found.' }, { status: 404, headers: HEADERS });
  }
  try {
    const found = await loadTrack(id, storeId);
    if (!found) {
      return NextResponse.json({ error: 'Match replay not found.' }, { status: 404, headers: HEADERS });
    }
    const { missing, total } = await listMissingDmoCommentaryClips(found.track, storeId);
    if (!missing.length && !found.track.complete) {
      await markDmoCommentaryTrackComplete(found.replay, found.track, storeId);
    }
    return NextResponse.json({
      replay: { id, player1: found.replay.player1, player2: found.replay.player2 },
      total,
      missing: missing.map(({ clip, text, voice, speed }) => ({ clip, text, voice, speed })),
    }, { headers: HEADERS });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Commentary could not be prepared.' },
      { status: 503, headers: HEADERS },
    );
  }
}

export async function PUT(request: Request) {
  if (!authorized(request)) return deny();
  const storeId = process.env.MODERATION_BLOB_STORE_ID;
  if (!storeId) {
    return NextResponse.json({ error: 'Replay storage is not configured.' }, { status: 503, headers: HEADERS });
  }
  const url = new URL(request.url);
  const id = url.searchParams.get('replay') ?? '';
  const clip = url.searchParams.get('clip') ?? '';
  if (!isDmoReplayId(id) || !/^[0-9a-f]{32}$/.test(clip)) {
    return NextResponse.json({ error: 'Unknown replay or clip.' }, { status: 404, headers: HEADERS });
  }
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > MAX_CLIP_BYTES) {
    return NextResponse.json({ error: 'Clip is too large.' }, { status: 413, headers: HEADERS });
  }
  try {
    const found = await loadTrack(id, storeId);
    // Only lines in this replay's own script can be stored.
    if (!found || !found.track.cues.some((cue) => cue.clip === clip)) {
      return NextResponse.json({ error: 'Unknown replay or clip.' }, { status: 404, headers: HEADERS });
    }
    const audio = new Uint8Array(await request.arrayBuffer());
    if (audio.byteLength > MAX_CLIP_BYTES) {
      return NextResponse.json({ error: 'Clip is too large.' }, { status: 413, headers: HEADERS });
    }
    if (!looksLikeMp3(audio)) {
      return NextResponse.json({ error: 'Clip must be an MP3.' }, { status: 415, headers: HEADERS });
    }
    await storeDmoCommentaryClip(clip, audio, storeId);
    return NextResponse.json({ stored: clip }, { headers: HEADERS });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Clip could not be stored.' },
      { status: 503, headers: HEADERS },
    );
  }
}

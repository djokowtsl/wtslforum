import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { isDmoReplayId } from '@/lib/dmoReplayLibrary';
import { findViewableDmoReplay, loadDmoReplayViewer } from '@/lib/dmoReplayViewerData';
import { getDmoCommentaryClip, getDmoCommentaryTrack } from '@/lib/dmoCommentaryTrack';
import { isWtslSyncAuthorized } from '@/lib/wtslSyncAuth';
import {
  COMMENTARY_MAINTENANCE_MESSAGE,
  isAllowedCommentaryMatch,
  isCommentaryRestrictionActive,
} from '@/lib/dmoCommentaryMaintenance.mjs';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ERROR_HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

/** One stored commentary clip (MP3). Clips never change, so browsers keep them. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; clip: string }> },
) {
  const { id, clip } = await params;
  if (!isDmoReplayId(id) || !/^[0-9a-f]{32}$/.test(clip)) {
    return NextResponse.json({ error: 'Commentary clip not found.' }, { status: 404, headers: ERROR_HEADERS });
  }
  const storeId = process.env.MODERATION_BLOB_STORE_ID;
  if (!storeId) {
    return NextResponse.json({ error: 'Replay storage is not configured.' }, { status: 503, headers: ERROR_HEADERS });
  }
  try {
    const user = await getSession();
    const replay = await findViewableDmoReplay(id, Boolean(user));
    if (!replay) {
      return NextResponse.json({ error: 'Match replay not found.' }, { status: 404, headers: ERROR_HEADERS });
    }
    if (
      isCommentaryRestrictionActive()
      && !isWtslSyncAuthorized(request.headers)
      && !isAllowedCommentaryMatch({
        replayId: replay.id,
        names: [replay.player1, replay.player2],
        tournament: replay.tournament,
      })
    ) {
      return NextResponse.json(
        { error: COMMENTARY_MAINTENANCE_MESSAGE },
        { status: 503, headers: { ...ERROR_HEADERS, 'Retry-After': 'Sat, 14 Nov 2026 08:00:00 GMT' } },
      );
    }
    const track = await getDmoCommentaryTrack(replay, () => loadDmoReplayViewer({
      id,
      sourcePath: replay.privateBlobPathname,
      fileName: replay.fileName,
      storeId,
    }), storeId);
    const audio = await getDmoCommentaryClip(track, clip, storeId);
    if (!audio) {
      return NextResponse.json({ error: 'Commentary clip not found.' }, { status: 404, headers: ERROR_HEADERS });
    }
    return new Response(Buffer.from(audio), {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(audio.byteLength),
        // Private: replay access may be restricted. Immutable: a clip's name is
        // a hash of its content.
        'Cache-Control': 'private, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    const speechError = error as Error & { busy?: boolean; retryAfter?: string };
    const headers = speechError.busy
      ? {
        ...ERROR_HEADERS,
        'X-WTSL-Commentary-Busy': 'true',
        ...(speechError.retryAfter ? { 'Retry-After': speechError.retryAfter } : {}),
      }
      : ERROR_HEADERS;
    return NextResponse.json(
      { error: 'Commentary audio is temporarily unavailable.' },
      { status: 503, headers },
    );
  }
}

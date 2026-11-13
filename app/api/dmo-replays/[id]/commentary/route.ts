import { after, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { isDmoReplayId } from '@/lib/dmoReplayLibrary';
import { findViewableDmoReplay, loadDmoReplayViewer } from '@/lib/dmoReplayViewerData';
import { getDmoCommentaryTrack, prepareDmoCommentaryClips } from '@/lib/dmoCommentaryTrack';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const HEADERS = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

/**
 * The replay's stored commentary script: every line, its voice, and the frame
 * it plays at. Whoever can watch the replay can hear its commentary.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isDmoReplayId(id)) {
    return NextResponse.json({ error: 'Match replay not found.' }, { status: 404, headers: HEADERS });
  }
  const storeId = process.env.MODERATION_BLOB_STORE_ID;
  if (!storeId) {
    return NextResponse.json({ error: 'Replay storage is not configured.' }, { status: 503, headers: HEADERS });
  }
  try {
    const user = await getSession();
    const replay = await findViewableDmoReplay(id, Boolean(user));
    if (!replay) {
      return NextResponse.json({ error: 'Match replay not found.' }, { status: 404, headers: HEADERS });
    }
    const track = await getDmoCommentaryTrack(replay, () => loadDmoReplayViewer({
      id,
      sourcePath: replay.privateBlobPathname,
      fileName: replay.fileName,
      storeId,
    }), storeId);
    // After answering, store any clips not yet generated, in script order,
    // so playback never has to wait for them.
    // A viewer joining part-way gets the clips from their position first.
    const rawFrom = new URL(request.url).searchParams.get('from');
    const from = rawFrom !== null && /^\d{1,9}$/.test(rawFrom) ? Number(rawFrom) : null;
    if (!track.complete) {
      after(() => prepareDmoCommentaryClips(replay, track, storeId, 45_000, from).then(() => undefined));
    }
    return NextResponse.json({
      version: track.version,
      fps: track.fps,
      cues: track.cues.map(({ at, speaker, text, kind, group, mustPlay, clip }) => ({
        at, speaker, text, kind, group, mustPlay, clip,
      })),
    }, { headers: HEADERS });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Commentary could not be prepared.' },
      { status: 503, headers: HEADERS },
    );
  }
}

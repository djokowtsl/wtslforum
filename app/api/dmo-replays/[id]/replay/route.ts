import { createHash } from 'node:crypto';
import { get, put } from '@vercel/blob';
import { NextResponse } from 'next/server';
import { analyzeDmoBuffer } from '@/lib/te4DmoAnalysis';
import { MAX_DMO_BYTES, Te4DmoAnalysisError } from '@/lib/te4DmoParser';
import { getPublicDmoReplay, isDmoReplayId, publicDmoReplayMetadata } from '@/lib/dmoReplayLibrary';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
};

type ViewerData = ReturnType<typeof analyzeDmoBuffer>['viewer'];
const inFlight = new Map<string, Promise<ViewerData>>();

function replayCachePath(id: string, sourcePath: string) {
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

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isDmoReplayId(id)) {
    return NextResponse.json({ error: 'Match replay not found.' }, { status: 404, headers: PRIVATE_HEADERS });
  }

  const storeId = process.env.MODERATION_BLOB_STORE_ID;
  if (!storeId) {
    return NextResponse.json({ error: 'Private replay storage is not configured.' }, { status: 503, headers: PRIVATE_HEADERS });
  }

  try {
    const replay = await getPublicDmoReplay(id);
    if (!replay) {
      return NextResponse.json({ error: 'Match replay not found.' }, { status: 404, headers: PRIVATE_HEADERS });
    }
    const key = replayCachePath(id, replay.privateBlobPathname);
    let pending = inFlight.get(key);
    if (!pending) {
      pending = getViewerData({
        id,
        sourcePath: replay.privateBlobPathname,
        fileName: replay.fileName,
        storeId,
      });
      inFlight.set(key, pending);
      void pending.finally(() => {
        if (inFlight.get(key) === pending) inFlight.delete(key);
      }).catch(() => undefined);
    }
    const viewer = await pending;
    return NextResponse.json({
      match: publicDmoReplayMetadata(replay),
      viewer,
    }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof Te4DmoAnalysisError) {
      return NextResponse.json({ error: error.message }, { status: 422, headers: PRIVATE_HEADERS });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'The match replay could not be prepared.' },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
}

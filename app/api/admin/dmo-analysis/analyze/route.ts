import { del, get, put } from '@vercel/blob';
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { sql } from '@/lib/db';
import { removeUnsupportedCharacterProjections } from '@/lib/characterProfileSafety.mjs';
import { resolveDmoCharacterMatch } from '@/lib/te4DmoCharacterMatch';
import { analyzeDmoBuffer } from '@/lib/te4DmoAnalysis';
import { MAX_DMO_BYTES, Te4DmoAnalysisError } from '@/lib/te4DmoParser';
import { fetchWTSLAllResults } from '@/lib/wtsl';
import { wtslCore } from '@/lib/wtsl-core';
import type { Te4AnalysisResult, Te4CharacterAttribution, Te4CharacterProfile } from '@/lib/te4DmoTypes';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const UPLOAD_PREFIX = 'dmo-analysis/';
const RESPONSE_CHUNK_BYTES = 64 * 1024;

async function fetchCharacterProfile(character: string): Promise<Te4CharacterProfile | null> {
  if (character.length > 120) return null;
  try {
    const payload = await wtslCore.characterStats({
      tour: 'atp',
      character,
      includeProfile: true,
      includeOfficial: false,
    });
    const safePayload = removeUnsupportedCharacterProjections(payload);
    if (!safePayload || typeof safePayload !== 'object' || Array.isArray(safePayload)) return null;
    const profile = (safePayload as Record<string, unknown>).profile;
    return profile && typeof profile === 'object' && !Array.isArray(profile)
      ? profile as Te4CharacterProfile
      : null;
  } catch (error) {
    console.warn('[dmo-analysis] character profile unavailable', {
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    return null;
  }
}

async function findCharacterAttribution(
  analysis: Te4AnalysisResult,
): Promise<Te4CharacterAttribution> {
  const metadataCheck = resolveDmoCharacterMatch(analysis, []);
  if (metadataCheck.status === 'insufficient_metadata') return metadataCheck;

  let rows;
  try {
    rows = await fetchWTSLAllResults(12_000);
  } catch (error) {
    console.warn('[dmo-analysis] WTSL character lookup unavailable', {
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    return { status: 'unavailable', source: null, match: null, players: null };
  }

  const attribution = resolveDmoCharacterMatch(analysis, rows);
  if (attribution.status !== 'matched' || !attribution.players) return attribution;

  const uniqueCharacters = [...new Set(
    attribution.players.flatMap((player) => player.character ? [player.character] : []),
  )];
  const profiles = new Map<string, Te4CharacterProfile | null>();
  await Promise.all(uniqueCharacters.map(async (character) => {
    profiles.set(character, await fetchCharacterProfile(character));
  }));

  return {
    ...attribution,
    players: [
      {
        ...attribution.players[0],
        profile: attribution.players[0].character
          ? profiles.get(attribution.players[0].character) ?? null
          : null,
      },
      {
        ...attribution.players[1],
        profile: attribution.players[1].character
          ? profiles.get(attribution.players[1].character) ?? null
          : null,
      },
    ],
  };
}

function isAllowedPath(pathname: string): boolean {
  if (!pathname.startsWith(UPLOAD_PREFIX) || pathname.length > 180) return false;
  if (!pathname.toLowerCase().endsWith('.dmo') || pathname.includes('\\')) return false;
  return !pathname.split('/').some((segment) => segment === '.' || segment === '..');
}

function streamedJson(body: unknown, status = 200): Response {
  const encoded = Buffer.from(JSON.stringify(body), 'utf8');
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < encoded.length; offset += RESPONSE_CHUNK_BYTES) {
        controller.enqueue(encoded.subarray(offset, offset + RESPONSE_CHUNK_BYTES));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export async function POST(request: Request) {
  const user = await getSession();
  if (!user?.isAdmin) {
    return NextResponse.json(
      { error: 'Admin access required.' },
      { status: 403, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  const storeId = process.env.MODERATION_BLOB_STORE_ID;
  if (!storeId) {
    return NextResponse.json(
      { error: 'Private DMO storage is not configured.' },
      { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json(
      { error: 'Invalid analysis request.' },
      { status: 400, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
  const pathname = typeof body.pathname === 'string' ? body.pathname : '';
  const filename = typeof body.filename === 'string' ? body.filename.trim().slice(0, 160) : '';
  const liveBroadcastId = body.liveBroadcastId === undefined ? null : body.liveBroadcastId;
  if (!isAllowedPath(pathname) || !filename.toLowerCase().endsWith('.dmo')) {
    return NextResponse.json(
      { error: 'Choose a valid uploaded .dmo recording.' },
      { status: 400, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
  if (liveBroadcastId !== null && (
    typeof liveBroadcastId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(liveBroadcastId)
  )) {
    return NextResponse.json(
      { error: 'The replay broadcast could not be verified.' },
      { status: 400, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  let uploaded = false;
  let unattachedReplayPath: string | null = null;
  try {
    if (liveBroadcastId) {
      const ownedBroadcast = await sql`
        SELECT id
        FROM dmo_live_broadcasts
        WHERE id=${liveBroadcastId}::uuid
          AND owner_discord_id=${user.discordId}
          AND status='live'
          AND payload->>'mode'='manual'
          AND payload->>'replay'='true'
      `;
      if (!ownedBroadcast.length) {
        return NextResponse.json(
          { error: 'The replay broadcast could not be verified.' },
          { status: 404, headers: { 'Cache-Control': 'private, no-store' } },
        );
      }
    }

    const blob = await get(pathname, { access: 'private', storeId, useCache: false });
    if (!blob || blob.statusCode !== 200 || !blob.stream) {
      return NextResponse.json(
        { error: 'The private DMO upload could not be found.' },
        { status: 404, headers: { 'Cache-Control': 'private, no-store' } },
      );
    }
    uploaded = true;
    if (blob.blob.size > MAX_DMO_BYTES) {
      return NextResponse.json(
        { error: 'The DMO file is larger than the 64 MiB analysis limit.' },
        { status: 413, headers: { 'Cache-Control': 'private, no-store' } },
      );
    }

    const bytes = Buffer.from(await new Response(blob.stream).arrayBuffer());
    if (bytes.length > MAX_DMO_BYTES) {
      return NextResponse.json(
        { error: 'The DMO file is larger than the 64 MiB analysis limit.' },
        { status: 413, headers: { 'Cache-Control': 'private, no-store' } },
      );
    }
    const analysis = analyzeDmoBuffer(bytes, filename);
    if (liveBroadcastId) {
      const replayJson = JSON.stringify({ viewer: analysis.viewer });
      if (Buffer.byteLength(replayJson) > MAX_DMO_BYTES) {
        return NextResponse.json(
          { error: 'The full replay data is larger than the 64 MiB storage limit.' },
          { status: 413, headers: { 'Cache-Control': 'private, no-store' } },
        );
      }
      const replayPath = `dmo-live-replays/${liveBroadcastId}-${randomUUID()}.json`;
      const replayBlob = await put(replayPath, replayJson, {
        access: 'private',
        storeId,
        addRandomSuffix: false,
        contentType: 'application/json',
      });
      unattachedReplayPath = replayBlob.pathname;
      const attached = await sql`
        UPDATE dmo_live_broadcasts
        SET payload=COALESCE(payload, '{}'::jsonb)
              || jsonb_build_object('replayDataPath', ${replayBlob.pathname}),
            updated_at=NOW()
        WHERE id=${liveBroadcastId}::uuid
          AND owner_discord_id=${user.discordId}
          AND status='live'
          AND payload->>'mode'='manual'
          AND payload->>'replay'='true'
        RETURNING id
      `;
      if (!attached.length) {
        await del(replayBlob.pathname, { storeId }).catch(() => undefined);
        unattachedReplayPath = null;
        return NextResponse.json(
          { error: 'The replay broadcast ended before its playback data was ready.' },
          { status: 409, headers: { 'Cache-Control': 'private, no-store' } },
        );
      }
      unattachedReplayPath = null;
      return NextResponse.json(
        { replayDataReady: true },
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    }
    analysis.characterAttribution = await findCharacterAttribution(analysis);
    return streamedJson(analysis);
  } catch (error) {
    if (unattachedReplayPath) {
      await del(unattachedReplayPath, { storeId }).catch(() => {
        console.error('[dmo-analysis] unattached replay cleanup failed');
      });
    }
    if (error instanceof Te4DmoAnalysisError) {
      return NextResponse.json(
        { error: error.message },
        { status: 422, headers: { 'Cache-Control': 'private, no-store' } },
      );
    }
    console.error('[dmo-analysis] analysis failed');
    return NextResponse.json(
      { error: 'The DMO recording could not be analyzed. Try another recording or contact an administrator.' },
      { status: 500, headers: { 'Cache-Control': 'private, no-store' } },
    );
  } finally {
    if (uploaded) {
      await del(pathname, { storeId }).catch(() => {
        console.error('[dmo-analysis] temporary upload cleanup failed');
      });
    }
  }
}

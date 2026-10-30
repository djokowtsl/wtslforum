import { del, get, put } from '@vercel/blob';
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { sql } from '@/lib/db';
import {
  isCoachingReplayStagingPath,
  MAX_COACHING_REPLAY_BYTES,
  sanitizeCoachingViewerData,
} from '@/lib/coachingReportViewer';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PRIVATE_REPLAY_PREFIX = 'dmo-coaching-replays/';

function cleanText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, maxLength);
}

async function readSmallJson(request: Request): Promise<Record<string, unknown> | null> {
  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf8') > 64 * 1024) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const user = await getSession();
  if (!user?.isAdmin) {
    return NextResponse.json({ error: 'Admin access required.' }, { status: 403 });
  }

  const storeId = process.env.MODERATION_BLOB_STORE_ID;
  if (!storeId) {
    return NextResponse.json(
      { error: 'Private replay storage is not configured.' },
      { status: 503 },
    );
  }

  const body = await readSmallJson(request);
  const stagingPath = body?.stagingPath;
  const consent = body?.consent;
  const consentReferences = body?.consentReferences;
  const submitterConsentReference = cleanText(
    (consentReferences as Record<string, unknown> | null)?.submitter,
    300,
  );
  const player1ConsentReference = cleanText(
    (consentReferences as Record<string, unknown> | null)?.player1,
    300,
  );
  const player2ConsentReference = cleanText(
    (consentReferences as Record<string, unknown> | null)?.player2,
    300,
  );
  const tournament = cleanText(body?.tournament, 160);
  const roundName = cleanText(body?.roundName, 80);
  if (
    !isCoachingReplayStagingPath(stagingPath)
    || !consent
    || typeof consent !== 'object'
    || (consent as Record<string, unknown>).submitter !== true
    || (consent as Record<string, unknown>).player1 !== true
    || (consent as Record<string, unknown>).player2 !== true
    || (consent as Record<string, unknown>).review !== true
    || submitterConsentReference.length < 10
    || player1ConsentReference.length < 10
    || player2ConsentReference.length < 10
    || !tournament
    || !roundName
  ) {
    return NextResponse.json(
      { error: 'Confirm all three consents, the review, and the consent record before publishing.' },
      { status: 400, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  let finalPathToClean: string | null = null;
  try {
    const alreadyPublished = await sql`
      SELECT id
      FROM coaching_reports
      WHERE source_replay_pathname=${stagingPath}
      LIMIT 1
    `;
    if (alreadyPublished.length) {
      return NextResponse.json(
        { error: 'This replay has already been published.' },
        { status: 409, headers: { 'Cache-Control': 'private, no-store' } },
      );
    }

    const stagingBlob = await get(stagingPath, {
      access: 'private',
      storeId,
      useCache: false,
    });
    if (!stagingBlob || stagingBlob.statusCode !== 200 || !stagingBlob.stream) {
      return NextResponse.json(
        { error: 'The private coaching replay could not be found.' },
        { status: 404, headers: { 'Cache-Control': 'private, no-store' } },
      );
    }
    if (stagingBlob.blob.size > MAX_COACHING_REPLAY_BYTES) {
      return NextResponse.json(
        { error: 'This replay is larger than the 64 MiB publication limit.' },
        { status: 413, headers: { 'Cache-Control': 'private, no-store' } },
      );
    }

    const replayText = await new Response(stagingBlob.stream).text();
    if (Buffer.byteLength(replayText, 'utf8') > MAX_COACHING_REPLAY_BYTES) {
      return NextResponse.json(
        { error: 'This replay is larger than the 64 MiB publication limit.' },
        { status: 413, headers: { 'Cache-Control': 'private, no-store' } },
      );
    }
    let rawViewer: unknown;
    try {
      rawViewer = JSON.parse(replayText);
    } catch {
      return NextResponse.json(
        { error: 'The uploaded replay data is invalid.' },
        { status: 422, headers: { 'Cache-Control': 'private, no-store' } },
      );
    }
    const viewer = sanitizeCoachingViewerData(rawViewer);
    if (!viewer) {
      return NextResponse.json(
        { error: 'The replay data is incomplete or unsupported for public viewing.' },
        { status: 422, headers: { 'Cache-Control': 'private, no-store' } },
      );
    }

    const replayJson = JSON.stringify(viewer);
    const replayBytes = Buffer.byteLength(replayJson, 'utf8');
    if (replayBytes > MAX_COACHING_REPLAY_BYTES) {
      return NextResponse.json(
        { error: 'This replay is larger than the 64 MiB publication limit.' },
        { status: 413, headers: { 'Cache-Control': 'private, no-store' } },
      );
    }

    const id = randomUUID();
    const replayPathname = `${PRIVATE_REPLAY_PREFIX}${id}.json`;
    const title = `${tournament} — ${roundName}: ${viewer.names[0]} vs ${viewer.names[1]}`.slice(0, 240);
    await put(replayPathname, replayJson, {
      access: 'private',
      storeId,
      addRandomSuffix: false,
      contentType: 'application/json',
    });
    finalPathToClean = replayPathname;

    const inserted = await sql`
      INSERT INTO coaching_reports (
        id, title, tournament, round_name, player1, player2, score,
        replay_pathname, source_replay_pathname,
        submitter_consent, player1_consent, player2_consent, review_confirmed,
        submitter_consent_reference, player1_consent_reference, player2_consent_reference,
        consent_recorded_by_discord_id, reviewed_by_discord_id
      )
      VALUES (
        ${id}::uuid, ${title}, ${tournament}, ${roundName}, ${viewer.names[0]},
        ${viewer.names[1]}, ${viewer.score}, ${replayPathname}, ${stagingPath},
        TRUE, TRUE, TRUE, TRUE, ${submitterConsentReference}, ${player1ConsentReference},
        ${player2ConsentReference}, ${user.discordId}, ${user.discordId}
      )
      RETURNING id::text
    `;
    if (!inserted[0]) throw new Error('The coaching report was not saved.');

    finalPathToClean = null;
    return NextResponse.json(
      { id: inserted[0].id, title },
      { status: 201, headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    console.error('[coaching-reports] publish failed', {
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    return NextResponse.json(
      { error: 'The report could not be published. Check the Forum database and private storage, then try again.' },
      { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
    );
  } finally {
    await del(stagingPath, { storeId }).catch(() => {
      console.error('[coaching-reports] staging replay cleanup failed');
    });
    if (finalPathToClean) {
      await del(finalPathToClean, { storeId }).catch(() => {
        console.error('[coaching-reports] unpublished replay cleanup failed');
      });
    }
  }
}

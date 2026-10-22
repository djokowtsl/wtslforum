import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { isSameSiteMutation } from '@/lib/liveRequestSecurity';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 32 * 1024;
const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
};
const player = z.union([z.literal(1), z.literal(2)]);
const pair = z.tuple([z.number().int().min(0).max(7), z.number().int().min(0).max(7)]);
const snapshotSchema = z.object({
  version: z.literal(1),
  filename: z.string().min(1).max(120),
  stadium: z.string().max(80).nullable(),
  players: z.tuple([z.string().min(1).max(80), z.string().min(1).max(80)]),
  frameCount: z.number().int().min(0).max(1_000_000),
  courtFrameCount: z.number().int().min(0).max(1_000).optional(),
  pointCount: z.number().int().min(0).max(20_000),
  bestOf: z.union([z.literal(1), z.literal(3), z.literal(5)]),
  score: z.object({
    sets: z.array(pair).max(5),
    games: z.tuple([z.number().int().min(0).max(7), z.number().int().min(0).max(7)]),
    points: z.tuple([z.number().int().min(0).max(100), z.number().int().min(0).max(100)]),
    pointText: z.tuple([z.string().max(4), z.string().max(4)]),
    tiebreak: z.boolean(),
    server: player.nullable(),
  }).strict(),
  currentPoint: z.object({
    number: z.number().int().min(1).max(20_001),
    server: player.nullable(),
    rallyHits: z.number().int().min(0).max(200),
    serveSpeedKmh: z.number().int().min(0).max(500).nullable(),
    inProgress: z.boolean(),
  }).strict(),
  winChance: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]),
  winHistory: z.array(z.number().min(0).max(1)).max(120),
  stats: z.array(z.object({
    servicePoints: z.number().int().min(0).max(20_000),
    servicePointsWon: z.number().int().min(0).max(20_000),
    serviceWinRate: z.number().min(0).max(1).nullable(),
    pointsWon: z.number().int().min(0).max(20_000),
    firstServeFaults: z.number().int().min(0).max(20_000),
    acesOrUnreturned: z.number().int().min(0).max(20_000),
  }).strict()).length(2),
  recentPoints: z.array(z.object({
    number: z.number().int().min(1).max(20_000),
    server: player,
    winner: player,
    rallyHits: z.number().int().min(0).max(200),
    faults: z.number().int().min(0).max(10),
  }).strict()).max(12),
  court: z.array(z.tuple([
    z.number().int().min(-5000).max(5000),
    z.number().int().min(-5000).max(5000),
    z.number().int().min(0).max(1000),
    z.number().int().min(-5000).max(5000),
    z.number().int().min(-5000).max(5000),
    z.number().int().min(-5000).max(5000),
    z.number().int().min(-5000).max(5000),
  ])).max(25),
}).strict();
const updateSchema = z.object({
  sequence: z.number().int().positive(),
  snapshot: snapshotSchema.optional(),
}).strict();

type RouteContext = { params: Promise<{ id: string }> };

async function readUpdate(request: Request) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_BODY_BYTES) return { error: 'too_large' as const };
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return { error: 'too_large' as const };
  try {
    const parsed = updateSchema.safeParse(JSON.parse(text));
    return parsed.success ? { data: parsed.data } : { error: 'invalid' as const };
  } catch {
    return { error: 'invalid' as const };
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  if (!isSameSiteMutation(request)) {
    return NextResponse.json({ error: 'Request origin could not be verified.' }, { status: 403, headers: PRIVATE_HEADERS });
  }
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Sign in to update a live broadcast.' }, { status: 401, headers: PRIVATE_HEADERS });
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Broadcast not found.' }, { status: 404, headers: PRIVATE_HEADERS });
  }
  const update = await readUpdate(request);
  if (update.error) {
    const tooLarge = update.error === 'too_large';
    return NextResponse.json({ error: tooLarge ? 'Live snapshot is too large.' : 'Invalid live snapshot update.' }, {
      status: tooLarge ? 413 : 400,
      headers: PRIVATE_HEADERS,
    });
  }

  try {
    const rows = update.data.snapshot
      ? await sql`
        UPDATE dmo_live_broadcasts
        SET payload=COALESCE(payload, '{}'::jsonb)
              || jsonb_build_object(
                'snapshot', ${JSON.stringify(update.data.snapshot)}::jsonb,
                'players', COALESCE(
                  NULLIF(payload->'players', 'null'::jsonb),
                  ${JSON.stringify(update.data.snapshot.players)}::jsonb
                )
              ),
            sequence=${update.data.sequence},
            updated_at=NOW(),
            expires_at=NOW() + INTERVAL '45 seconds'
        WHERE id=${id}::uuid
          AND owner_discord_id=${user.discordId}
          AND status='live'
          AND sequence < ${update.data.sequence}
        RETURNING id
      `
      : await sql`
        UPDATE dmo_live_broadcasts
        SET sequence=${update.data.sequence},
            updated_at=NOW(),
            expires_at=NOW() + INTERVAL '45 seconds'
        WHERE id=${id}::uuid
          AND owner_discord_id=${user.discordId}
          AND status='live'
          AND sequence < ${update.data.sequence}
        RETURNING id
      `;
    if (!rows.length) {
      return NextResponse.json({ error: 'Broadcast ended or this update is out of date.' }, { status: 409, headers: PRIVATE_HEADERS });
    }
    return NextResponse.json({ ok: true }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    console.error('[live-broadcast] update failed', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json({ error: 'Live broadcasting is temporarily unavailable.' }, { status: 503, headers: PRIVATE_HEADERS });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  if (!isSameSiteMutation(request)) {
    return NextResponse.json({ error: 'Request origin could not be verified.' }, { status: 403, headers: PRIVATE_HEADERS });
  }
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Sign in to end a live broadcast.' }, { status: 401, headers: PRIVATE_HEADERS });
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Broadcast not found.' }, { status: 404, headers: PRIVATE_HEADERS });
  }
  try {
    const rows = await sql`
      UPDATE dmo_live_broadcasts
      SET status='ended',
          updated_at=NOW(),
          expires_at=NOW() + INTERVAL '15 minutes'
      WHERE id=${id}::uuid
        AND (owner_discord_id=${user.discordId} OR ${user.isAdmin})
        AND status='live'
      RETURNING id
    `;
    if (!rows.length) {
      return NextResponse.json({ error: 'Broadcast not found or already ended.' }, { status: 404, headers: PRIVATE_HEADERS });
    }
    return NextResponse.json({ ok: true }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    console.error('[live-broadcast] end failed', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json({ error: 'Live broadcasting is temporarily unavailable.' }, { status: 503, headers: PRIVATE_HEADERS });
  }
}

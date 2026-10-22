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
  bestOf: z.union([z.literal(3), z.literal(5)]),
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

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  if (!isSameSiteMutation(request)) {
    return NextResponse.json({ error: 'Request origin could not be verified.' }, { status: 403, headers: PRIVATE_HEADERS });
  }
  const user = await getSession();
  if (!user?.isAdmin) {
    return NextResponse.json({ error: 'Admin access required.' }, { status: 403, headers: PRIVATE_HEADERS });
  }
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Broadcast not found.' }, { status: 404, headers: PRIVATE_HEADERS });
  }

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Live snapshot is too large.' }, { status: 413, headers: PRIVATE_HEADERS });
  }
  const bodyText = await request.text();
  if (new TextEncoder().encode(bodyText).byteLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Live snapshot is too large.' }, { status: 413, headers: PRIVATE_HEADERS });
  }
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return NextResponse.json({ error: 'Invalid live snapshot.' }, { status: 400, headers: PRIVATE_HEADERS });
  }
  const sequence = z.number().int().positive().safeParse((body as { sequence?: unknown } | null)?.sequence);
  const snapshot = snapshotSchema.safeParse((body as { snapshot?: unknown } | null)?.snapshot);
  if (!sequence.success || !snapshot.success) {
    return NextResponse.json({ error: 'Invalid live snapshot.' }, { status: 400, headers: PRIVATE_HEADERS });
  }

  try {
    const rows = await sql`
      UPDATE dmo_live_broadcasts
      SET payload=${JSON.stringify(snapshot.data)}::jsonb,
          sequence=${sequence.data},
          updated_at=NOW(),
          expires_at=NOW() + INTERVAL '45 seconds'
      WHERE id=${id}::uuid
        AND owner_discord_id=${user.discordId}
        AND status='live'
        AND sequence < ${sequence.data}
      RETURNING id
    `;
    if (!rows.length) {
      return NextResponse.json(
        { error: 'Broadcast ended or this update is out of date.' },
        { status: 409, headers: PRIVATE_HEADERS },
      );
    }
    return NextResponse.json({ ok: true }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    console.error('[dmo-live] snapshot update failed', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json({ error: 'Live DMO broadcasting is temporarily unavailable.' }, { status: 503, headers: PRIVATE_HEADERS });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  if (!isSameSiteMutation(request)) {
    return NextResponse.json({ error: 'Request origin could not be verified.' }, { status: 403, headers: PRIVATE_HEADERS });
  }
  const user = await getSession();
  if (!user?.isAdmin) {
    return NextResponse.json({ error: 'Admin access required.' }, { status: 403, headers: PRIVATE_HEADERS });
  }
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
        AND owner_discord_id=${user.discordId}
        AND status='live'
      RETURNING id
    `;
    if (!rows.length) {
      return NextResponse.json({ error: 'Broadcast not found or already ended.' }, { status: 404, headers: PRIVATE_HEADERS });
    }
    return NextResponse.json({ ok: true }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    console.error('[dmo-live] broadcast end failed', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json({ error: 'Live DMO broadcasting is temporarily unavailable.' }, { status: 503, headers: PRIVATE_HEADERS });
  }
}

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
const pointSchema = z.object({
  number: z.number().int().min(1).max(20_000),
  scoreLabel: z.string().max(40).optional(),
  server: player,
  winner: player,
  rallyHits: z.number().int().min(0).max(200),
  faults: z.number().int().min(0).max(10),
}).strict();
const batchSchema = z.object({ points: z.array(pointSchema).min(1).max(100) }).strict();
const pointLogSchema = z.array(pointSchema).max(20_000);
type RouteContext = { params: Promise<{ id: string }> };

async function readBatch(request: Request) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_BODY_BYTES) return { error: 'too_large' as const };
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return { error: 'too_large' as const };
  try {
    const parsed = batchSchema.safeParse(JSON.parse(text));
    return parsed.success ? { data: parsed.data } : { error: 'invalid' as const };
  } catch {
    return { error: 'invalid' as const };
  }
}

export async function GET(_request: Request, context: RouteContext) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: 'Sign in to view the point log.' }, { status: 401, headers: PRIVATE_HEADERS });
  }
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Broadcast not found.' }, { status: 404, headers: PRIVATE_HEADERS });
  }

  try {
    const rows = await sql`
      SELECT payload->'pointLog' AS point_log,
        payload->'snapshot'->'recentPoints' AS snapshot_points,
        payload->'recentPoints' AS legacy_points
      FROM dmo_live_broadcasts
      WHERE id=${id}::uuid
        AND expires_at > NOW()
        AND (
          status='live'
          OR (status='ended' AND updated_at >= NOW() - INTERVAL '60 seconds')
        )
      LIMIT 1
    `;
    if (!rows.length) {
      return NextResponse.json({ error: 'Broadcast not found.' }, { status: 404, headers: PRIVATE_HEADERS });
    }
    const row = rows[0] as Record<string, unknown>;
    const storedPoints = Array.isArray(row.point_log)
      ? row.point_log
      : Array.isArray(row.snapshot_points)
        ? row.snapshot_points
        : Array.isArray(row.legacy_points)
          ? row.legacy_points
          : [];
    const parsed = pointLogSchema.safeParse(storedPoints);
    if (!parsed.success) {
      return NextResponse.json({ error: 'The point log is temporarily unavailable.' }, { status: 503, headers: PRIVATE_HEADERS });
    }
    return NextResponse.json(
      { points: parsed.data },
      { headers: PRIVATE_HEADERS },
    );
  } catch (error) {
    console.error('[live-broadcast] point log read failed', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json({ error: 'The point log is temporarily unavailable.' }, { status: 503, headers: PRIVATE_HEADERS });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  if (!isSameSiteMutation(request)) {
    return NextResponse.json({ error: 'Request origin could not be verified.' }, { status: 403, headers: PRIVATE_HEADERS });
  }
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: 'Sign in to save the point log.' }, { status: 401, headers: PRIVATE_HEADERS });
  }
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Broadcast not found.' }, { status: 404, headers: PRIVATE_HEADERS });
  }
  const batch = await readBatch(request);
  if (batch.error) {
    const tooLarge = batch.error === 'too_large';
    return NextResponse.json(
      { error: tooLarge ? 'Point log batch is too large.' : 'Invalid point log batch.' },
      { status: tooLarge ? 413 : 400, headers: PRIVATE_HEADERS },
    );
  }

  const pointsByNumber = new Map<number, string>();
  for (const point of batch.data.points) {
    const serialized = JSON.stringify(point);
    const previous = pointsByNumber.get(point.number);
    if (previous !== undefined && previous !== serialized) {
      return NextResponse.json(
        { error: 'Point log contains conflicting data for the same point.', code: 'point_log_conflict' },
        { status: 409, headers: PRIVATE_HEADERS },
      );
    }
    pointsByNumber.set(point.number, serialized);
  }

  try {
    const rows = await sql`
      UPDATE dmo_live_broadcasts AS live
      SET payload=COALESCE(live.payload, '{}'::jsonb)
            || jsonb_build_object(
              'pointLog', COALESCE((
                SELECT jsonb_agg(point ORDER BY point_number)
                FROM (
                  SELECT DISTINCT ON (point_number) point_number, point
                  FROM (
                    SELECT (incoming.point->>'number')::int AS point_number,
                           incoming.point AS point,
                           0 AS source_order
                    FROM jsonb_array_elements(${JSON.stringify(batch.data.points)}::jsonb) AS incoming(point)
                    UNION ALL
                    SELECT (stored.point->>'number')::int AS point_number,
                           stored.point AS point,
                           1 AS source_order
                    FROM jsonb_array_elements(
                      CASE
                        WHEN jsonb_typeof(live.payload->'pointLog')='array' THEN live.payload->'pointLog'
                        WHEN jsonb_typeof(live.payload->'snapshot'->'recentPoints')='array' THEN live.payload->'snapshot'->'recentPoints'
                        WHEN jsonb_typeof(live.payload->'recentPoints')='array' THEN live.payload->'recentPoints'
                        ELSE '[]'::jsonb
                      END
                    ) AS stored(point)
                  ) AS candidates
                  ORDER BY point_number, source_order
                ) AS deduplicated
              ), '[]'::jsonb)
            )
      WHERE live.id=${id}::uuid
        AND live.owner_discord_id=${user.discordId}
        AND live.status='live'
        AND live.expires_at > NOW()
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(${JSON.stringify(batch.data.points)}::jsonb) AS incoming(point)
          JOIN jsonb_array_elements(
            CASE
              WHEN jsonb_typeof(live.payload->'pointLog')='array' THEN live.payload->'pointLog'
              WHEN jsonb_typeof(live.payload->'snapshot'->'recentPoints')='array' THEN live.payload->'snapshot'->'recentPoints'
              WHEN jsonb_typeof(live.payload->'recentPoints')='array' THEN live.payload->'recentPoints'
              ELSE '[]'::jsonb
            END
          ) AS stored(point)
            ON (incoming.point->>'number')::int = (stored.point->>'number')::int
          WHERE incoming.point IS DISTINCT FROM stored.point
        )
      RETURNING live.id
    `;
    if (!rows.length) {
      return NextResponse.json({ error: 'Broadcast ended or not found.' }, { status: 409, headers: PRIVATE_HEADERS });
    }
    return NextResponse.json({ ok: true }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    console.error('[live-broadcast] point log update failed', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json({ error: 'The point log is temporarily unavailable.' }, { status: 503, headers: PRIVATE_HEADERS });
  }
}

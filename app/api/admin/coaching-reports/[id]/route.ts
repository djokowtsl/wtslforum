import { del } from '@vercel/blob';
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

const PRIVATE_REPLAY_PREFIX = 'dmo-coaching-replays/';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSession();
  if (!user?.isAdmin) {
    return NextResponse.json({ error: 'Admin access required.' }, { status: 403 });
  }

  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: 'Coaching report not found.' }, { status: 404 });
  }

  try {
    const updated = await sql`
      WITH target AS (
        SELECT id, replay_pathname
        FROM coaching_reports
        WHERE id=${id}::uuid AND unpublished_at IS NULL
        FOR UPDATE
      )
      UPDATE coaching_reports AS report
      SET replay_pathname=NULL,
          unpublished_at=NOW(),
          unpublished_by_discord_id=${user.discordId}
      FROM target
      WHERE report.id=target.id
      RETURNING target.replay_pathname
    `;
    const pathname = `${PRIVATE_REPLAY_PREFIX}${id}.json`;
    if (updated[0] && updated[0].replay_pathname !== pathname) {
      console.error('[coaching-reports] replay cleanup path did not match its report ID');
      return NextResponse.json(
        { ok: true, storageCleanupPending: true },
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    }
    if (!updated[0]) {
      const existing = await sql`
        SELECT unpublished_at
        FROM coaching_reports
        WHERE id=${id}::uuid
        LIMIT 1
      `;
      if (!existing[0] || !existing[0].unpublished_at) {
        return NextResponse.json(
          { error: 'Published coaching report not found.' },
          { status: 404, headers: { 'Cache-Control': 'private, no-store' } },
        );
      }
    }

    const storeId = process.env.MODERATION_BLOB_STORE_ID;
    if (!pathname || !storeId) {
      return NextResponse.json(
        { ok: true, storageCleanupPending: true },
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    }
    try {
      await del(pathname, { storeId });
      return NextResponse.json(
        { ok: true, storageCleanupPending: false },
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    } catch {
      console.error('[coaching-reports] unpublished replay cleanup failed');
      return NextResponse.json(
        { ok: true, storageCleanupPending: true },
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    }
  } catch (error) {
    console.error('[coaching-reports] unpublish failed', {
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    return NextResponse.json(
      { error: 'The report could not be removed. Try again or contact a Forum administrator.' },
      { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
}

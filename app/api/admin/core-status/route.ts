import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { wtslCore } from '@/lib/wtsl-core';

export const dynamic = 'force-dynamic';

const msg = (e: unknown) => (e instanceof Error ? e.message : 'Request failed');

/**
 * Admin-only diagnostic for the bot's Core API — "No open fixtures" on /matches and /betting
 * looks identical whether the bot genuinely has zero open markets right now, or the forum can't
 * reach/authenticate with the Core API at all. This surfaces the real health/capabilities/raw
 * fixtures response so that can be told apart without guessing.
 */
export async function GET() {
  const u = await getSession();
  if (!u?.isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!wtslCore.configured()) {
    return NextResponse.json({ configured: false, error: 'WTSL_CORE_API_URL / WTSL_CORE_API_KEY not set' });
  }

  const [health, capabilities, fixtures] = await Promise.all([
    wtslCore.health().then((r) => ({ ok: true, data: r })).catch((e) => ({ ok: false, error: msg(e) })),
    wtslCore.capabilities().then((r) => ({ ok: true, data: r })).catch((e) => ({ ok: false, error: msg(e) })),
    wtslCore.fixtures().then((r) => ({ ok: true, count: r.length, data: r })).catch((e) => ({ ok: false, error: msg(e) })),
  ]);

  return NextResponse.json({ configured: true, health, capabilities, fixtures });
}

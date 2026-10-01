import { NextRequest, NextResponse } from 'next/server';
import { safe } from '@/lib/db';
import { searchPlayers } from '@/lib/stats';
import { isTourCode } from '@/lib/wtsl';

export const dynamic = 'force-dynamic';

// Backs the player-search autocomplete on the verification form. Public and read-only — the
// same name/avatar/country is already visible on every /players page.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tour = searchParams.get('tour') ?? '';
  const q = searchParams.get('q') ?? '';
  if (!isTourCode(tour)) return NextResponse.json({ error: 'Invalid tour' }, { status: 400 });

  const results = await safe(() => searchPlayers(tour, q), [] as any[]);
  return NextResponse.json({ ok: true, results });
}

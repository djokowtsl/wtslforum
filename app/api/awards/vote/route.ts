import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { sql } from '@/lib/db';
import { castVote } from '@/lib/awards';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Log in with Discord to vote.' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const categoryId = Number(body?.categoryId);
  const nomineeId = body?.nomineeId ? Number(body.nomineeId) : null;
  const writeIn = typeof body?.writeIn === 'string' ? body.writeIn.trim().slice(0, 120) : null;
  if (!categoryId || (!nomineeId && !writeIn)) return NextResponse.json({ error: 'Pick a nominee or write someone in.' }, { status: 400 });

  const rows = await sql`SELECT c.id, c.allow_write_in, cy.voting_open FROM award_categories c JOIN award_cycles cy ON cy.id = c.cycle_id WHERE c.id = ${categoryId} LIMIT 1`;
  const category = rows[0];
  if (!category) return NextResponse.json({ error: 'Unknown award category.' }, { status: 404 });
  if (!category.voting_open) return NextResponse.json({ error: 'Voting is not open for this award yet.' }, { status: 403 });
  if (writeIn && !nomineeId && !category.allow_write_in) return NextResponse.json({ error: 'Write-in votes are not allowed for this award.' }, { status: 403 });

  await castVote(categoryId, user.discordId, nomineeId, nomineeId ? null : writeIn);
  return NextResponse.json({ ok: true });
}

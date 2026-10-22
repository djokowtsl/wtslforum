import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { sql } from '@/lib/db';
import { castVote, closeExpiredAwardCycles } from '@/lib/awards';
import { isAwardVotingOpen } from '@/lib/awardVoting';
import { syncAwardVotesToSheet } from '@/lib/awardVoteSheetSync';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Log in with Discord to vote.' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const categoryId = Number(body?.categoryId);
  const nomineeId = body?.nomineeId ? Number(body.nomineeId) : null;
  const writeIn = typeof body?.writeIn === 'string' ? body.writeIn.trim().slice(0, 120) : null;
  if (!categoryId || (!nomineeId && !writeIn)) return NextResponse.json({ error: 'Pick a nominee or write someone in.' }, { status: 400 });

  await closeExpiredAwardCycles();
  const rows = await sql`
    SELECT c.id, c.allow_write_in, cy.voting_open, cy.voting_closes_at
    FROM award_categories c
    JOIN award_cycles cy ON cy.id = c.cycle_id
    WHERE c.id = ${categoryId}
    LIMIT 1
  `;
  const category = rows[0];
  if (!category) return NextResponse.json({ error: 'Unknown award category.' }, { status: 404 });
  if (!isAwardVotingOpen(category.voting_open, category.voting_closes_at)) {
    return NextResponse.json({ error: 'Voting is closed for this award.' }, { status: 403 });
  }
  if (writeIn && !nomineeId && !category.allow_write_in) return NextResponse.json({ error: 'Write-in votes are not allowed for this award.' }, { status: 403 });

  const vote = await castVote(categoryId, user.discordId, nomineeId, nomineeId ? null : writeIn);
  if (!vote) return NextResponse.json({ error: 'Voting is closed for this award.' }, { status: 403 });

  const sheetSync = await syncAwardVotesToSheet([vote]);
  if (sheetSync.status === 'failed') {
    console.warn('[awards] vote saved but spreadsheet sync failed', { voteId: vote.voteId });
  }
  return NextResponse.json({ ok: true, sheetSyncStatus: sheetSync.status });
}

import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { sql } from '@/lib/db';
import { castVote, closeExpiredAwardCycles, getSiteAwardBallot, saveAwardFormResponseState } from '@/lib/awards';
import { isAwardVotingOpen } from '@/lib/awardVoting';
import { awardFormBallotFingerprint, syncAwardBallotsToForm } from '@/lib/awardVoteFormSync';

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
    SELECT c.id, c.cycle_id, c.allow_write_in, cy.voting_open, cy.voting_closes_at
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

  const ballot = await getSiteAwardBallot(Number(category.cycle_id), user.discordId);
  if (!ballot || !ballot.isComplete) {
    return NextResponse.json({ ok: true, formSyncStatus: 'incomplete', ballotSubmitted: false });
  }

  const fingerprint = awardFormBallotFingerprint(ballot.season, ballot.answers);
  if (ballot.responseFingerprint === fingerprint && ballot.previousResponseId) {
    return NextResponse.json({ ok: true, formSyncStatus: 'synced', ballotSubmitted: true });
  }

  const sync = await syncAwardBallotsToForm([ballot]);
  const result = sync.results[0];
  if (sync.status !== 'synced' || !result || result.status === 'failed' || result.status === 'stale' || !result.responseId) {
    console.warn('[awards] vote saved but native Google Form submission failed', { voteId: vote.voteId });
    return NextResponse.json({
      ok: true,
      formSyncStatus: sync.status === 'not_configured' || sync.status === 'misconfigured' ? sync.status : 'failed',
      ballotSubmitted: false,
    });
  }

  const saved = await saveAwardFormResponseState(
    Number(category.cycle_id),
    user.discordId,
    result.responseId,
    result.fingerprint ?? fingerprint,
    result.updatedAt ?? ballot.updatedAt,
  );
  if (!saved.length) {
    return NextResponse.json({ ok: true, formSyncStatus: 'failed', ballotSubmitted: false });
  }

  return NextResponse.json({ ok: true, formSyncStatus: 'synced', ballotSubmitted: true });
}

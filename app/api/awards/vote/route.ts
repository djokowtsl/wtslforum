import { after, NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { sql } from '@/lib/db';
import { castVote, closeExpiredAwardCycles, getSiteAwardBallot } from '@/lib/awards';
import { isAwardVotingOpen } from '@/lib/awardVoting';
import { awardFormBallotFingerprint } from '@/lib/awardVoteFormSync';
import {
  enqueueAwardFormSyncJob,
  markAwardFormSyncJobSynced,
  processAwardFormSyncJob,
} from '@/lib/awardFormSyncJobs';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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
    return NextResponse.json({ ok: true });
  }

  const fingerprint = awardFormBallotFingerprint(ballot.season, ballot.answers);
  if (ballot.responseFingerprint === fingerprint && ballot.previousResponseId) {
    await markAwardFormSyncJobSynced(
      Number(category.cycle_id),
      user.discordId,
      fingerprint,
      ballot.updatedAt,
    );
    return NextResponse.json({ ok: true });
  }

  let job: Awaited<ReturnType<typeof enqueueAwardFormSyncJob>>;
  try {
    job = await enqueueAwardFormSyncJob(
      Number(category.cycle_id),
      user.discordId,
      fingerprint,
      ballot.updatedAt,
    );
  } catch {
    console.error('[awards] ballot saved but sync job could not be queued', {
      cycleId: Number(category.cycle_id),
    });
    return NextResponse.json({ ok: true });
  }

  if (job.status !== 'needs_review' && job.status !== 'processing') {
    after(async () => {
      try {
        await processAwardFormSyncJob(job.id);
      } catch {
        console.error('[awards] background ballot sync worker failed', {
          cycleId: Number(category.cycle_id),
        });
      }
    });
  }

  return NextResponse.json({ ok: true });
}

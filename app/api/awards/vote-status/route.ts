import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getSiteAwardBallot } from '@/lib/awards';
import { awardFormBallotFingerprint } from '@/lib/awardVoteFormSync';
import { getAwardFormSyncJob } from '@/lib/awardFormSyncJobs';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Log in with Discord to view your ballot status.' }, { status: 401 });

  const cycleId = Number(req.nextUrl.searchParams.get('cycleId'));
  if (!Number.isSafeInteger(cycleId) || cycleId < 1) {
    return NextResponse.json({ error: 'Choose a valid award cycle.' }, { status: 400 });
  }

  const ballot = await getSiteAwardBallot(cycleId, user.discordId);
  if (!ballot || !ballot.isComplete) {
    return NextResponse.json({ formSyncStatus: 'incomplete', ballotSubmitted: false });
  }

  const fingerprint = awardFormBallotFingerprint(ballot.season, ballot.answers);
  if (ballot.previousResponseId && ballot.responseFingerprint === fingerprint) {
    return NextResponse.json({ formSyncStatus: 'synced', ballotSubmitted: true });
  }

  const job = await getAwardFormSyncJob(cycleId, user.discordId);
  return NextResponse.json({
    formSyncStatus: job?.status ?? 'needs_review',
    ballotSubmitted: false,
  });
}

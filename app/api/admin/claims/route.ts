import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { approveClaim, rejectClaim } from '@/lib/player-claims';
import { approveChallongeClaim, rejectChallongeClaim } from '@/lib/challonge-claims';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user?.isAdmin) return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const claimId = String(body?.claim_id ?? '').trim();
  const action = String(body?.action ?? '').trim();
  const kind = String(body?.kind ?? 'player').trim();
  if (!claimId || !['approve', 'reject'].includes(action)) {
    return NextResponse.json({ error: 'Missing claim_id or action' }, { status: 400 });
  }

  try {
    if (kind === 'challonge') {
      if (action === 'approve') await approveChallongeClaim(claimId, user.id);
      else await rejectChallongeClaim(claimId, user.id, String(body?.note ?? '').trim().slice(0, 500));
    } else {
      if (action === 'approve') await approveClaim(claimId, user.id);
      else await rejectClaim(claimId, user.id, String(body?.note ?? '').trim().slice(0, 500));
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not update claim' }, { status: 400 });
  }
}


import { redirect } from 'next/navigation';
import { safe } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { listClaims } from '@/lib/player-claims';
import { listChallongeClaims } from '@/lib/challonge-claims';
import ClaimAdminPanel from '@/components/ClaimAdminPanel';
import ChallongeClaimAdminPanel from '@/components/ChallongeClaimAdminPanel';
import PageHero from '@/components/PageHero';

export const dynamic = 'force-dynamic';

export default async function AdminClaims() {
  const u = await getSession();
  if (!u) redirect('/api/auth/discord');
  if (!u.isAdmin) redirect('/');

  const [claims, challongeClaims] = await Promise.all([
    safe(() => listClaims('pending'), [] as any[]),
    safe(() => listChallongeClaims('pending'), [] as any[]),
  ]);

  return (
    <>
      <PageHero eyebrow="Staff" title="Player verification">Approve or reject requests linking a Discord account to a WTSL player profile or a Challonge username.</PageHero>
      <main className="container">
        <div className="panel">
          <div className="panel-head"><h2 className="display">WTSL player claims</h2></div>
          <ClaimAdminPanel claims={claims as any} />
        </div>
        <div className="panel section-space">
          <div className="panel-head"><h2 className="display">Challonge claims</h2></div>
          <ChallongeClaimAdminPanel claims={challongeClaims as any} />
        </div>
      </main>
    </>
  );
}


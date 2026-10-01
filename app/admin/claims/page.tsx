import { redirect } from 'next/navigation';
import { safe } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { listClaims } from '@/lib/player-claims';
import ClaimAdminPanel from '@/components/ClaimAdminPanel';
import PageHero from '@/components/PageHero';

export const dynamic = 'force-dynamic';

export default async function AdminClaims() {
  const u = await getSession();
  if (!u) redirect('/api/auth/discord');
  if (!u.isAdmin) redirect('/');

  const claims = await safe(() => listClaims('pending'), [] as any[]);

  return (
    <>
      <PageHero eyebrow="Staff" title="Player verification">Approve or reject requests linking a Discord account to a WTSL player profile.</PageHero>
      <main className="container">
        <div className="panel">
          <ClaimAdminPanel claims={claims as any} />
        </div>
      </main>
    </>
  );
}

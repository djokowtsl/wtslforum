import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getSession, discordAvatar } from '@/lib/auth';
import { safe } from '@/lib/db';
import { getLatestClaimForUser } from '@/lib/player-claims';
import { tourLabel } from '@/lib/wtsl';
import PageHero from '@/components/PageHero';
import PlayerClaimForm from '@/components/PlayerClaimForm';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Your profile' };

export default async function Profile() {
  const u = await getSession();
  if (!u) redirect('/api/auth/discord');
  const claim = await safe(() => getLatestClaimForUser(u.id), null);

  return (
    <>
      <PageHero eyebrow="Your account" title="Profile">You are signed in with Discord.</PageHero>
      <main className="container narrow">
        <div className="sidebar-card" style={{ textAlign: 'center', padding: 34 }}>
          <img className="avatar-img" style={{ width: 96, height: 96 }} src={discordAvatar(u.avatar, u.username)} alt="" />
          <h3 className="display" style={{ marginTop: 14, fontSize: 34 }}>{u.username}</h3>
          <p>Discord-connected WTSL community account</p>
          {u.isAdmin && <p><span className="pill cyan">Admin</span></p>}
          <form action="/api/auth/logout" method="post"><button className="btn">Sign out</button></form>
        </div>

        <div className="sidebar-card" style={{ padding: 28, marginTop: 20 }}>
          <h3 className="display" style={{ fontSize: 22 }}>WTSL player verification</h3>
          {claim?.status === 'approved' ? (
            <p>
              Verified as <b>{claim.player_name}</b> ({tourLabel(claim.tour)}).{' '}
              <Link href={`/players/${claim.wtsl_player_id}?tour=${encodeURIComponent(claim.tour)}`}>View your dashboard</Link>
            </p>
          ) : claim?.status === 'pending' ? (
            <p>Your claim for <b>{claim.player_name}</b> ({tourLabel(claim.tour)}) is awaiting admin review.</p>
          ) : (
            <>
              {claim?.status === 'rejected' && (
                <p className="notice">Your previous claim was not approved{claim.review_note ? `: ${claim.review_note}` : '.'} You can submit a new one below.</p>
              )}
              <p>Link this Discord account to your official WTSL player profile. An admin must approve this before it appears anywhere publicly — nobody can claim a player without review.</p>
              <PlayerClaimForm />
            </>
          )}
        </div>
      </main>
    </>
  );
}

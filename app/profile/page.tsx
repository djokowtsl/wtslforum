import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getSession, discordAvatar } from '@/lib/auth';
import { safe } from '@/lib/db';
import { getClaimsForUser, type PlayerClaim } from '@/lib/player-claims';
import { getLatestChallongeClaimForUser, type ChallongeClaim } from '@/lib/challonge-claims';
import { getUserStatus } from '@/lib/presence';
import { TOURS } from '@/lib/wtsl';
import PageHero from '@/components/PageHero';
import PlayerClaimForm from '@/components/PlayerClaimForm';
import ChallongeClaimForm from '@/components/ChallongeClaimForm';
import StatusPicker from '@/components/StatusPicker';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Your profile' };

export default async function Profile() {
  const u = await getSession();
  if (!u) redirect('/api/auth/discord');
  const claims = await safe(() => getClaimsForUser(u.id), [] as PlayerClaim[]);
  const claimByTour = new Map(claims.map((c) => [c.tour, c]));
  const challongeClaim = await safe(() => getLatestChallongeClaimForUser(u.id), null as ChallongeClaim | null);
  const status = await safe(() => getUserStatus(u.id), 'online' as const);

  return (
    <>
      <PageHero eyebrow="Your account" title="Profile">You are signed in with Discord.</PageHero>
      <main className="container narrow">
        <div className="sidebar-card" style={{ textAlign: 'center', padding: 34 }}>
          <img className="avatar-img" style={{ width: 96, height: 96 }} src={discordAvatar(u.avatar, u.username)} alt="" />
          <h3 className="display" style={{ marginTop: 14, fontSize: 34 }}>{u.username}</h3>
          <p>Discord-connected WTSL community account</p>
          {u.isAdmin && <p><span className="pill cyan">Admin</span></p>}
          <div className="status-row">
            <span>Your status:</span>
            <StatusPicker initial={status} />
          </div>
          <form action="/api/auth/logout" method="post"><button className="btn">Sign out</button></form>
        </div>

        <div className="sidebar-card" style={{ padding: 28, marginTop: 20 }}>
          <h3 className="display" style={{ fontSize: 22 }}>WTSL player verification</h3>
          <p>
            Link this Discord account to your official WTSL player profile, one tour at a time — verify
            every tour you play (ATP, WTA, Doubles, Coop, Created) independently. An admin must approve
            each claim before it appears anywhere publicly.
          </p>
          {TOURS.map((t) => {
            const claim = claimByTour.get(t.code);
            return (
              <div key={t.code} className="verify-tour-row">
                <h4 className="display" style={{ fontSize: 17, marginBottom: 6 }}>{t.label}</h4>
                {claim?.status === 'approved' ? (
                  <p>
                    Verified as <b>{claim.player_name}</b>.{' '}
                    <Link href={`/players/${claim.wtsl_player_id}?tour=${encodeURIComponent(claim.tour)}`}>View your dashboard</Link>
                  </p>
                ) : claim?.status === 'pending' ? (
                  <p>Your claim for <b>{claim.player_name}</b> is awaiting admin review.</p>
                ) : (
                  <>
                    {claim?.status === 'rejected' && (
                      <p className="notice">Your previous claim was not approved{claim.review_note ? `: ${claim.review_note}` : '.'} You can submit a new one below.</p>
                    )}
                    <PlayerClaimForm tour={t.code} />
                  </>
                )}
              </div>
            );
          })}
        </div>

        <div className="sidebar-card" style={{ padding: 28, marginTop: 20 }}>
          <h3 className="display" style={{ fontSize: 22 }}>Challonge verification</h3>
          <p>
            Link your Challonge username so the predictions leaderboard shows your official WTSL
            identity instead of a raw Challonge handle. An admin must approve this too.
          </p>
          {challongeClaim?.status === 'approved' ? (
            <p>Verified as Challonge user <b>{challongeClaim.challonge_username}</b>.</p>
          ) : challongeClaim?.status === 'pending' ? (
            <p>Your claim for Challonge username <b>{challongeClaim.challonge_username}</b> is awaiting admin review.</p>
          ) : (
            <>
              {challongeClaim?.status === 'rejected' && (
                <p className="notice">Your previous claim was not approved{challongeClaim.review_note ? `: ${challongeClaim.review_note}` : '.'} You can submit a new one below.</p>
              )}
              <ChallongeClaimForm />
            </>
          )}
        </div>
      </main>
    </>
  );
}

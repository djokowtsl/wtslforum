import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getSession, discordAvatar } from '@/lib/auth';
import PageHero from '@/components/PageHero';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Your profile' };

export default async function Profile() {
  const u = await getSession();
  if (!u) redirect('/api/auth/discord');
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
      </main>
    </>
  );
}

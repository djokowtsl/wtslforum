import type { Metadata } from 'next';
import { safe } from '@/lib/db';
import { openFixtures } from '@/lib/betting';
import { wtslCore } from '@/lib/wtsl-core';
import PageHero from '@/components/PageHero';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Betting fixtures' };

export default async function Betting() {
  const fx = await safe(() => openFixtures(), [] as any[]);
  const fixtures = Array.isArray(fx) ? fx : [];
  return (
    <>
      <PageHero eyebrow="WTSL Community" title="Betting fixtures">Virtual WTSL Dollars only. Follow fixtures, odds and community selections.</PageHero>
      <main className="container">
        <div className="notice" style={{ marginBottom: 22 }}>Placing bets on the site is temporarily disabled, keep betting in Discord for now.{!wtslCore.configured() && ' (The WTSL Core API is not configured on this deployment.)'}</div>
        {fixtures.length === 0 ? <div className="forum-list"><div className="empty"><strong>No open fixtures</strong>New fixtures appear when the next round opens.</div></div> : (
          <div className="fixture-grid">
            {fixtures.map((f: any) => (
              <article className="fixture-card" key={f.key}>
                <div className="fixture-top"><span>{f.tournament || 'WTSL'} · {(f.tour || 'TE4').toUpperCase()}</span><b>{String(f.status || 'open').toUpperCase()}</b></div>
                <h2>{f.first_name} <small>vs</small> {f.second_name}</h2>
                <div className="odds"><span>{f.first_name}<strong>{Number(f.odds_one).toFixed(2)}</strong></span><span>{f.second_name}<strong>{Number(f.odds_two).toFixed(2)}</strong></span></div>
                <div className="topic-meta">Fixture {f.key}</div>
              </article>
            ))}
          </div>
        )}
      </main>
    </>
  );
}

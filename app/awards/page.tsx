import type { Metadata } from 'next';
import { safe } from '@/lib/db';
import { getAwards } from '@/lib/queries';
import PageHero from '@/components/PageHero';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Awards' };

const CATEGORIES = [
  ['Player of the Year', 'The player who defined the season — on the court and in the community.'],
  ['Match of the Year', 'The one everybody is still talking about. Nominated and voted by the community.'],
  ['Rivalry of the Year', 'Two players, one storyline. The rivalry that gave the tour its edge.'],
  ['Community Contributor', 'For the writers, organisers, designers and helpers who keep WTSL running.'],
];

export default async function Awards() {
  const awards = await safe(() => getAwards(), [] as any[]);
  const seasons = [...new Set(awards.map((a: any) => a.season))] as string[];

  return (
    <>
      <PageHero eyebrow="WTSL Community Awards" title="Awards">A hall of fame for the players, matches and people who made each WTSL season.</PageHero>
      <main className="container">
        {seasons.length > 0 && seasons.map((s) => (
          <section key={s} style={{ marginBottom: 44 }}>
            <div className="section-heading"><h2>{s}</h2><span>Winners</span></div>
            <div className="award-grid">
              {awards.filter((a: any) => a.season === s).map((a: any) => (
                <div className="award-card" key={a.id}>
                  <span className="num">★</span>
                  <h3>{a.category}</h3>
                  {a.note && <p>{a.note}</p>}
                  <div className="award-winner"><b>{a.winner}</b><span>Winner</span></div>
                  {a.runner_up && <div className="award-winner"><b>{a.runner_up}</b><span>Runner-up</span></div>}
                </div>
              ))}
            </div>
          </section>
        ))}

        <div className="section-heading"><h2>{seasons.length ? 'The categories' : 'Award categories'}</h2></div>
        <div className="award-grid">
          {CATEGORIES.map(([name, text], i) => (
            <div className="award-card" key={name}>
              <span className="num">{String(i + 1).padStart(2, '0')}</span>
              <h3>{name}</h3>
              <p>{text}</p>
            </div>
          ))}
        </div>
        {seasons.length === 0 && <div className="notice" style={{ marginTop: 22 }}>No winners have been crowned yet. Nominations and voting are announced in the Announcements board and on Discord.</div>}
      </main>
    </>
  );
}

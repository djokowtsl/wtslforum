import type { Metadata } from 'next';
import { safe } from '@/lib/db';
import { getAwards } from '@/lib/queries';
import { getSession } from '@/lib/auth';
import { getActiveCycle, getCategories, getNomineesForCategories, getUserVotes } from '@/lib/awards';
import PageHero from '@/components/PageHero';
import AwardVoteForm from '@/components/AwardVoteForm';
import YearTabs from '@/components/YearTabs';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Awards' };

export default async function Awards({ searchParams }: { searchParams: Promise<{ season?: string }> }) {
  const { season: seasonParam } = await searchParams;
  const [awards, cycle, user] = await Promise.all([
    safe(() => getAwards(), [] as any[]),
    safe(() => getActiveCycle(), null as any),
    getSession(),
  ]);
  const seasons = [...new Set(awards.map((a: any) => a.season))] as string[];
  const shownSeasons = seasonParam && seasons.includes(seasonParam) ? [seasonParam] : seasons;

  const categories = cycle ? await safe(() => getCategories(cycle.id), [] as any[]) : [];
  const nominees = categories.length ? await safe(() => getNomineesForCategories(categories.map((c: any) => c.id)), [] as any[]) : [];
  const categoriesWithNominees = categories.map((c: any) => ({ ...c, nominees: nominees.filter((n: any) => n.category_id === c.id) }));
  const userVotes = cycle && user ? await safe(() => getUserVotes(cycle.id, user.discordId), [] as any[]) : [];
  const initialVotes = Object.fromEntries(userVotes.map((v: any) => [v.category_id, { nomineeId: v.nominee_id, writeIn: v.write_in }]));

  return (
    <>
      <PageHero eyebrow="WTSL Forum Awards" title="Awards">A hall of fame for the players, matches and people who made each WTSL season.</PageHero>
      <main className="container">
        <section style={{ marginBottom: 44 }}>
          <div className="section-heading"><h2>{cycle?.season ?? 'This season'}&apos;s awards</h2><span>{cycle?.voting_open ? 'Voting open' : 'Voting closed'}</span></div>
          {!cycle || categories.length === 0 ? (
            <div className="notice">Nominations haven&apos;t been set up yet — check back once an admin adds this season&apos;s categories.</div>
          ) : !cycle.voting_open ? (
            <div className="notice">Voting isn&apos;t open yet. These are this season&apos;s categories — nominees and the vote will open soon.
              <div className="award-grid" style={{ marginTop: 16 }}>
                {categoriesWithNominees.map((c: any) => (
                  <div className="award-card" key={c.id}><h3>{c.name}</h3>{c.nominees.length > 0 && <p>{c.nominees.map((n: any) => n.name).join(', ')}</p>}</div>
                ))}
              </div>
            </div>
          ) : !user ? (
            <div className="notice">You need to <a className="btn btn-sm btn-discord" href="/api/auth/discord" style={{ marginLeft: 8 }}>log in with Discord</a> to vote.</div>
          ) : (
            <AwardVoteForm categories={categoriesWithNominees} initialVotes={initialVotes} />
          )}
        </section>

        {seasons.length > 0 && (
          <>
            <YearTabs basePath="/awards" years={seasons} current={seasonParam && seasons.includes(seasonParam) ? seasonParam : undefined} paramName="season" />
            {shownSeasons.map((s) => (
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
          </>
        )}
        {seasons.length === 0 && <div className="notice" style={{ marginTop: 22 }}>No winners have been crowned yet. Nominations and voting are announced in the Announcements board and on Discord.</div>}
      </main>
    </>
  );
}

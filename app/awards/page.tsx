import type { Metadata } from 'next';
import { safe } from '@/lib/db';
import { getAwards } from '@/lib/queries';
import { getSession } from '@/lib/auth';
import { getActiveCycle, getCategories, getNomineesForCategories, getUserVotes } from '@/lib/awards';
import PageHero from '@/components/PageHero';
import AwardVoteForm from '@/components/AwardVoteForm';
import YearTabs from '@/components/YearTabs';
import PlayerAvatar from '@/components/PlayerAvatar';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Awards' };

/** Per-category emoji shown instead of the old generic star decoration. */
const CATEGORY_EMOJI: Record<string, string> = {
  'Player of the Year (Year-End No. 1)': '👑',
  'Fans Favourite Award': '❤️',
  'Stefan Edberg Sportsmanship Award': '🤝',
  'Most Improved Player': '📈',
  'Newcomer of the Year': '🌱',
  'Arthur Ashe Humanitarian Award': '🕊️',
  'Farmer of the Year': '🌽',
  'Comedian/Troll of the Year': '🤡',
  'Trickiest Player': '🎩',
  'Best Dressed Player': '👔',
  'Coach of the Year': '🧠',
  'Upset of the Year': '⚡',
  'Match of the Year': '🎾',
  'Worst Scheduler': '🗓️',
  'Tournament of the Year': '🏆',
};

function Face({ src, flagSrc, flagLabel, name, size = 32 }: { src?: string | null; flagSrc?: string | null; flagLabel?: string | null; name?: string | null; size?: number }) {
  return <PlayerAvatar src={src} flagSrc={flagSrc} flagLabel={flagLabel} name={name} size={size} />;
}

/** Match of the Year / Upset of the Year are a two-player matchup, not a single winner. */
const MATCH_CATEGORIES = new Set(['Match of the Year', 'Upset of the Year']);

/** Normalize old Farmer category labels for display without changing stored award rows. */
function canonicalAwardCategory(value: unknown): string {
  const category = String(value ?? '').trim();
  const withoutLegacyEmoji = category
    .replace(/^(?:(?:🦑|🐙|🌽)\uFE0F?\s*)+/u, '')
    .trim();
  return withoutLegacyEmoji === 'Farmer of the Year' ? withoutLegacyEmoji : category;
}

function uniqueSeasonAwards(rows: any[]) {
  const byCategory = new Map<string, { award: any; canonical: boolean }>();
  for (const award of rows) {
    const category = canonicalAwardCategory(award.category);
    const canonical = String(award.category ?? '').trim() === category;
    const previous = byCategory.get(category);
    const previousId = Number(previous?.award.id);
    const awardId = Number(award.id);
    const newerDuplicate = Number.isFinite(awardId) && (!Number.isFinite(previousId) || awardId > previousId);
    if (!previous || (canonical && !previous.canonical) || (canonical === previous.canonical && newerDuplicate)) {
      byCategory.set(category, { award: { ...award, category }, canonical });
    }
  }
  return Array.from(byCategory.values(), ({ award }) => award);
}

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
  const categoriesWithNominees = categories.map((c: any) => ({
    ...c,
    name: canonicalAwardCategory(c.name),
    nominees: nominees.filter((n: any) => n.category_id === c.id),
  }));
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
                  <div className="award-card" key={c.id}>
                    {c.name === 'Farmer of the Year' && <span className="num">{CATEGORY_EMOJI[c.name]}</span>}
                    <h3>{c.name}</h3>
                    {c.nominees.length > 0 && <p>{c.nominees.map((n: any) => n.name).join(', ')}</p>}
                  </div>
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
                  {uniqueSeasonAwards(awards.filter((a: any) => a.season === s)).map((a: any) => (
                    <div className="award-card" key={a.id}>
                      <span className="num">{CATEGORY_EMOJI[a.category] ?? '★'}</span>
                      <h3>{a.category}</h3>
                      {a.note && <p>{a.note}</p>}
                      {MATCH_CATEGORIES.has(a.category) ? (
                        <div className="award-match">
                          <div className="award-match-players">
                            <div className="award-match-player">
                              <Face src={a.winner_avatar} flagSrc={a.winner_flag} flagLabel={a.winner_country} name={a.winner} size={40} />
                              <span className="nm">{a.winner}</span>
                            </div>
                            <span className="award-match-vs">def</span>
                            <div className="award-match-player">
                              <Face src={a.player_two_avatar} flagSrc={a.player_two_flag} flagLabel={a.player_two_country} name={a.player_two} size={40} />
                              <span className="nm">{a.player_two}</span>
                            </div>
                          </div>
                          {a.score && <div className="match-score" style={{ textAlign: 'center' }}>{a.score}</div>}
                          {a.link_url && <a className="award-match-link" href={a.link_url} target="_blank" rel="noreferrer">Watch the match ↗</a>}
                        </div>
                      ) : (
                        <>
                          <div className="award-winner"><Face src={a.winner_avatar} flagSrc={a.winner_flag} flagLabel={a.winner_country} name={a.winner} /><b>{a.winner}</b></div>
                          {a.runner_up && <div className="award-winner"><Face src={a.runner_up_avatar} flagSrc={a.runner_up_flag} flagLabel={a.runner_up_country} name={a.runner_up} /><b>{a.runner_up}</b><span>Runner-up</span></div>}
                        </>
                      )}
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

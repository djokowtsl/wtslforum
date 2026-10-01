import Link from 'next/link';
import fs from 'node:fs';
import path from 'node:path';
import { dbConfigured, safe, sql } from '@/lib/db';
import { getTopics, getArticles, getCategoriesWithCounts } from '@/lib/queries';
import { getTournaments } from '@/lib/tournaments';
import { recentMatches } from '@/lib/stats';
import { openFixtures } from '@/lib/betting';
import { getSession } from '@/lib/auth';
import { fmtDate, timeAgo } from '@/lib/format';
import { discordAvatar } from '@/lib/auth';
import { FixtureCard, ResultCard } from '@/components/MatchCards';

export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  discord_not_configured: 'Discord sign-in has not been configured on this deployment yet (missing DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET).',
  discord_cancelled: 'Discord sign-in was cancelled.',
  discord_auth: 'Your Discord sign-in expired or was interrupted. Please try again.',
  discord_token: 'Discord rejected the login. Check that the redirect URL in the Discord Developer Portal exactly matches DISCORD_REDIRECT_URI, and that the client secret is correct.',
  discord_user: 'Discord signed you in but would not share your profile. Please try again.',
  database: 'You signed in with Discord, but the forum database is not reachable (check DATABASE_URL and that db.sql has been run).',
  auth_secret: 'AUTH_SECRET is not set on this deployment, so sessions cannot be created.',
};

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const [u, topics, categories, articles, tournaments, results, fixtures, topPlayers] = await Promise.all([
    getSession(),
    safe(() => getTopics({ limit: 6 }), [] as any[]),
    safe(() => getCategoriesWithCounts(), [] as any[]),
    safe(() => getArticles(true, 3), [] as any[]),
    safe(() => getTournaments(), [] as any[]),
    safe(() => recentMatches(3), [] as any[]),
    safe(() => openFixtures(), [] as any[]),
    safe(() => sql`SELECT name,avatar_url,flag_url,country,tour_elo,official_url FROM wtsl_players WHERE tour_elo IS NOT NULL ORDER BY tour_elo DESC LIMIT 1`, [] as any[]),
  ]);
  const heroPhoto = fs.existsSync(path.join(process.cwd(), 'public/brand/hero.jpg'));
  const featured = tournaments.find((t: any) => t.status === 'ongoing') || tournaments.find((t: any) => t.status === 'upcoming');
  const lead = results[0];
  const top = topPlayers[0];
  const live = tournaments.filter((t: any) => t.status === 'ongoing').concat(tournaments.filter((t: any) => t.status === 'upcoming')).slice(0, 4);
  const tournamentNames = Object.fromEntries(tournaments.map((t: any) => [t.wtsl_tournament_key, t.name]));
  const fx = (Array.isArray(fixtures) ? fixtures : []).slice(0, 3);
  const hasTour = results.length > 0 || fx.length > 0;

  return (
    <>
      {error && <div className="banner"><div role="alert"><span>⚠️</span><span>{ERRORS[error] || 'Something went wrong. Please try again.'}</span></div></div>}

      <section className={`hero ${heroPhoto ? 'has-photo' : ''}`} style={heroPhoto ? { backgroundImage: 'linear-gradient(90deg,rgba(3,10,24,.96) 0%,rgba(3,10,24,.78) 55%,rgba(3,10,24,.5) 100%),url(/brand/hero.jpg)' } : undefined}>
        <div className="hero-inner">
          <div>
            <div className="eyebrow">World Tennis Simulation League</div>
            <h1 className="display">WTSL<br /><em>Community</em></h1>
            <p className="tagline">The place for the people behind the tour.</p>
            <p className="lede">Talk matches, follow the tournaments, dig into the players and read the stories that make WTSL what it is — all in one clubhouse.</p>
            <div className="hero-actions">
              <Link className="btn btn-primary" href="/discussions">Enter the forum</Link>
              <a className="btn" href="https://www.playwtsl.com/TE4" target="_blank" rel="noreferrer">Go to WTSL ↗</a>
              {!u && <a className="btn btn-discord" href="/api/auth/discord">Join with Discord</a>}
            </div>
          </div>
          <div className="hero-panel">
            <div className="panel-label">This week on the tour</div>
            {featured && <Link className="spot" href={'/tournaments/' + featured.wtsl_tournament_key}><small>{featured.status === 'ongoing' ? 'Ongoing now' : 'Up next'}</small><b>{featured.name}</b><span>{featured.location}{featured.country ? `, ${featured.country}` : ''} · {featured.surface}</span></Link>}
            {lead && <Link className="spot" href="/matches"><small>Latest result</small><b>{lead.player_one_name} vs {lead.player_two_name}</b><span>{lead.score || '—'}{lead.played_at ? ` · ${timeAgo(lead.played_at)}` : ''}</span></Link>}
            {top && <Link className="spot" href="/players"><small>Top of the Tour Elo</small><b>{top.name}</b><span>Tour Elo {top.tour_elo}{top.country ? ` · ${top.country}` : ''}</span></Link>}
            {topics[0] && <Link className="spot" href={'/discussions/' + topics[0].id}><small>Hot in the forum</small><b>{topics[0].title}</b><span>{topics[0].replies} {topics[0].replies === 1 ? 'reply' : 'replies'}{topics[0].category ? ` · ${topics[0].category}` : ''}</span></Link>}
            {!featured && !lead && !top && !topics[0] && ['Discussions|/discussions|Join the conversation', 'Matches|/matches|Results and fixtures', 'Tournaments|/tournaments|The WTSL calendar', 'Players|/players|Ratings and profiles'].map((x) => { const [a, h, d] = x.split('|'); return <Link className="spot" key={h} href={h}><small>Explore</small><b>{a}</b><span>{d}</span></Link>; })}
          </div>
        </div>
      </section>

      <section className="live">
        <div className="live-inner">
          <div className="live-head"><span className="live-dot" /><h2 className="display">Live on the tour</h2><Link href="/matches">All matches →</Link></div>
          {hasTour ? (
            <>
              {results.length > 0 && (<><div className="live-sub" style={{ marginTop: 0 }}>Latest results</div><div className="live-grid">{results.map((m: any) => <ResultCard key={m.id} m={m} tournamentNames={tournamentNames} />)}</div></>)}
              {fx.length > 0 && (<><div className="live-sub">Open fixtures</div><div className="live-grid">{fx.map((f: any) => <FixtureCard key={f.key} f={f} />)}</div></>)}
            </>
          ) : (
            <div className="notice">Fixtures and results from the WTSL tour will appear here as soon as the data connection is live. In the meantime, the <Link href="/tournaments" style={{ color: 'var(--lime)' }}>tournament calendar</Link> has everything that is on.</div>
          )}
        </div>
      </section>

      <main className="container">
        {!dbConfigured() && <div className="notice warn" style={{ marginBottom: 24 }}>The forum database is not connected on this deployment (<code>DATABASE_URL</code> is missing), so discussions, articles and tournaments cannot load yet.</div>}

        <div className="section-head">
          <div><div className="eyebrow">Forum</div><h2 className="display" style={{ marginTop: 10 }}>Latest discussions</h2></div>
          <Link className="btn btn-sm" href="/discussions">View all</Link>
        </div>
        <div className="layout">
          <section className="forum-list">
            <div className="category-head">Recent topics</div>
            {topics.length === 0 ? (
              <div className="empty"><strong>No discussions yet</strong>Be the first to start a conversation about the tour.{u ? <><br /><Link className="btn btn-primary btn-sm" href="/discussions/new">Start a discussion</Link></> : <><br /><a className="btn btn-discord btn-sm" href="/api/auth/discord">Join with Discord</a></>}</div>
            ) : topics.map((t: any) => (
              <Link className="topic" href={'/discussions/' + t.id} key={t.id}>
                <img className="av" src={discordAvatar(t.avatar, t.author || 'W')} alt="" />
                <div>
                  <div className="topic-title">{t.title}</div>
                  <div className="topic-meta">{t.category && <span className="pill">{t.category}</span>}<span>{t.author || 'Community'}</span><span>{timeAgo(t.created_at)}</span></div>
                </div>
                <div className="topic-stat">{t.replies}<span>replies</span></div>
                <div className="topic-last">{t.last_author ? <><b>{t.last_author}</b>{timeAgo(t.last_reply_at)}</> : <span>No replies yet</span>}</div>
              </Link>
            ))}
          </section>
          <aside className="stack">
            {!u && <div className="sidebar-card"><h3 className="display">Join the clubhouse</h3><p>Sign in with Discord to post, reply and take part in every tournament thread.</p><a className="btn btn-discord" style={{ width: '100%' }} href="/api/auth/discord">Join with Discord</a></div>}
            {categories.length > 0 && <div className="sidebar-card"><h3 className="display">Boards</h3>{categories.map((c: any) => <Link className="cat-link" key={c.id} href={'/discussions?c=' + c.slug}>{c.name}<span>{c.topics}</span></Link>)}</div>}
            {live.length > 0 && <div className="sidebar-card"><h3 className="display">On the calendar</h3>{live.map((t: any) => <Link className="mini-t" key={t.id} href={'/tournaments/' + t.wtsl_tournament_key}><span className={`status-dot ${t.status}`} /><div><b>{t.name}</b><small>{t.status === 'ongoing' ? 'Ongoing now' : `Starts ${fmtDate(t.start_date)}`}</small></div></Link>)}</div>}
          </aside>
        </div>

        {articles.length > 0 && (
          <>
            <div className="section-head section-space">
              <div><div className="eyebrow">Editorial</div><h2 className="display" style={{ marginTop: 10 }}>From the community</h2></div>
              <Link className="btn btn-sm" href="/articles">All articles</Link>
            </div>
            <div className="article-grid">
              {articles.map((a: any) => (
                <Link href={'/articles/' + a.slug} className="article" key={a.id}>
                  <div className="article-cover" style={a.cover_url ? { backgroundImage: `linear-gradient(0deg,rgba(3,10,24,.6),transparent),url(${a.cover_url})` } : undefined}></div>
                  <div className="article-body"><h3>{a.title}</h3>{a.excerpt && <p>{a.excerpt}</p>}<small>{a.author || 'WTSL Community'} · {fmtDate(a.created_at)}</small></div>
                </Link>
              ))}
            </div>
          </>
        )}
      </main>
    </>
  );
}

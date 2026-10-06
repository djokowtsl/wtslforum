import type { Metadata } from 'next';
import Link from 'next/link';
import { safe } from '@/lib/db';
import { fixturesBoard, getBalance, getBets, poolOdds, hybridOdds } from '@/lib/betting';
import { wtslCore } from '@/lib/wtsl-core';
import { getTournaments } from '@/lib/tournaments';
import { getSession } from '@/lib/auth';
import PageHero from '@/components/PageHero';
import BettingAutoRefresh from '@/components/BettingAutoRefresh';
import { timeAgo, fmtDateTime } from '@/lib/format';
import { sortOpenFixturesByTournamentRecency } from '@/lib/fixture-order';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Betting fixtures' };

const DISCORD_URL = 'https://discord.com/channels/786583939028090881/1550152646638174308';
function money(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00';
}

/** Returns the WTSL (official), house-adjusted live, and guaranteed-minimum odds for one side of a fixture. */
function sideOdds(f: any, side: 'one' | 'two') {
  const official = Number(side === 'one' ? f.odds_one : f.odds_two) || 0;
  const total = Number(f.pool_total) || 0;
  const selected = Number(side === 'one' ? f.pool_one : f.pool_two) || 0;
  let live: number | null = null;
  try {
    if (total > 0 && selected > 0) live = poolOdds(total, selected);
  } catch { /* pool not active yet */ }
  let guaranteed = official;
  try {
    if (official > 0) guaranteed = hybridOdds(official, live);
  } catch { /* official odds missing */ }
  return { official, live: live ?? official, guaranteed };
}

export default async function Betting() {
  const user = await getSession();
  const [board, account, bets, atpTournaments, wtaTournaments] = await Promise.all([
    safe(() => fixturesBoard(), { open: [] as any[], recent_settled: [] as any[] }),
    user ? safe(() => getBalance(user.discordId), null as any) : Promise.resolve(null),
    user ? safe(() => getBets(user.discordId), [] as any[]) : Promise.resolve([] as any[]),
    safe(() => getTournaments('TE4'), [] as any[]),
    safe(() => getTournaments('TE4_(F)'), [] as any[]),
  ]);
  const fixtures = sortOpenFixturesByTournamentRecency(
    Array.isArray(board?.open) ? board.open : [],
    [...atpTournaments, ...wtaTournaments],
  );
  const settled = Array.isArray(board?.recent_settled) ? board.recent_settled : [];
  const betList = Array.isArray(bets) ? bets : [];

  return (
    <>
      <BettingAutoRefresh />
      <PageHero eyebrow="WTSL Forum" title="Betting board">Follow live odds across the tour. Betting itself still happens in Discord — use the button to jump straight there.</PageHero>
      <main className="container">
        {!wtslCore.configured() && <div className="notice warn" style={{ marginBottom: 22 }}>The WTSL Core API is not configured on this deployment, so odds and account data can&apos;t load right now.</div>}

        {user && (
          <div className="kpi-grid">
            <div><span>My W$ balance</span><b>{account ? `W$${money(account.balance)}` : '—'}</b></div>
            <div><span>Total staked</span><b>{account ? `W$${money(account.total_staked)}` : '—'}</b></div>
            <div><span>Total returned</span><b>{account ? `W$${money(account.total_returned)}` : '—'}</b></div>
            <div><span>Net profit</span><b>{account ? `W$${money(account.total_profit)}` : '—'}</b></div>
          </div>
        )}

        <div className="section-head">
          <div>
            <h2 className="display">Open fixtures</h2>
            <p>WTSL odds, house-adjusted live odds and the guaranteed minimum you&apos;d lock in right now.</p>
          </div>
          <a className="btn btn-discord btn-sm" href={DISCORD_URL} target="_blank" rel="noreferrer">Place bets in Discord ↗</a>
        </div>
        {fixtures.length === 0 ? <div className="forum-list"><div className="empty"><strong>No open fixtures</strong>New fixtures appear when the next round opens.</div></div> : (
          <div className="fixture-grid">
            {fixtures.map((f: any) => {
              const one = sideOdds(f, 'one');
              const two = sideOdds(f, 'two');
              return (
                <article className="fixture-card" key={f.key}>
                  <div className="fixture-top"><span>{f.tournament || 'WTSL'} · {(f.tour || 'TE4').toUpperCase()}</span><b>{String(f.status || 'open').toUpperCase()}</b></div>
                  <h2>{f.first_id && f.tour ? <Link href={`/players/${f.first_id}?tour=${encodeURIComponent(f.tour)}`}>{f.first_name}</Link> : f.first_name} <small>vs</small> {f.second_id && f.tour ? <Link href={`/players/${f.second_id}?tour=${encodeURIComponent(f.tour)}`}>{f.second_name}</Link> : f.second_name}</h2>
                  <div className="topic-meta">{f.round_deadline ? `Deadline: ${fmtDateTime(f.round_deadline)}` : 'No deadline set'}</div>
                  <div className="odds-compare">
                    <div className="odds-head"><span /><span>WTSL</span><span>Live</span><span>Min</span></div>
                    <div className="odds-side"><b>{f.first_id && f.tour ? <Link href={`/players/${f.first_id}?tour=${encodeURIComponent(f.tour)}`}>{f.first_name}</Link> : f.first_name}</b><span>{one.official.toFixed(2)}</span><span>{one.live.toFixed(2)}</span><span>{one.guaranteed.toFixed(2)}</span></div>
                    <div className="odds-side"><b>{f.second_id && f.tour ? <Link href={`/players/${f.second_id}?tour=${encodeURIComponent(f.tour)}`}>{f.second_name}</Link> : f.second_name}</b><span>{two.official.toFixed(2)}</span><span>{two.live.toFixed(2)}</span><span>{two.guaranteed.toFixed(2)}</span></div>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        <div className="section-head section-space">
          <div>
            <h2 className="display">Recently settled</h2>
            <p>Results the bot has closed out, with the winner and final odds. Note the bot doesn&apos;t always close out every finished match promptly, so this list can lag behind what&apos;s actually been played.</p>
          </div>
        </div>
        {settled.length === 0 ? <div className="forum-list"><div className="empty"><strong>No settled fixtures yet</strong>Settled results appear here once the bot closes a market out.</div></div> : (
          <div className="fixture-grid">
            {settled.map((f: any) => {
              const winnerIsFirst = f.winner_id != null && String(f.winner_id) === String(f.first_id);
              const winnerIsSecond = f.winner_id != null && String(f.winner_id) === String(f.second_id);
              return (
                <article className="fixture-card" key={f.key}>
                  <div className="fixture-top"><span>{f.tournament || 'WTSL'} · {(f.tour || 'TE4').toUpperCase()}</span><b>SETTLED</b></div>
                  <h2 className="fixture-matchup">
                    <span className={winnerIsFirst ? 'winner' : ''}>
                      {f.first_id && f.tour ? <Link href={`/players/${f.first_id}?tour=${encodeURIComponent(f.tour)}`}>{f.first_name}</Link> : f.first_name}
                      {winnerIsFirst ? <span className="winner-check">✓</span> : null}
                    </span>
                    <small>vs</small>
                    <span className={winnerIsSecond ? 'winner' : ''}>
                      {f.second_id && f.tour ? <Link href={`/players/${f.second_id}?tour=${encodeURIComponent(f.tour)}`}>{f.second_name}</Link> : f.second_name}
                      {winnerIsSecond ? <span className="winner-check">✓</span> : null}
                    </span>
                  </h2>
                  <div className="topic-meta">
                    {f.result_note ? `${f.result_note} · ` : ''}{f.settled_at ? `Settled ${timeAgo(f.settled_at)}` : ''}
                  </div>
                  <div className="odds-compare">
                    <div className="odds-head"><span /><span>WTSL odds</span></div>
                    <div className="odds-side"><b>{f.first_name}</b><span>{(Number(f.odds_one) || 0).toFixed(2)}</span></div>
                    <div className="odds-side"><b>{f.second_name}</b><span>{(Number(f.odds_two) || 0).toFixed(2)}</span></div>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {user && (
          <>
            <div className="section-head section-space">
              <div>
                <h2 className="display">My bet ledger</h2>
                <p>Your recent bets placed in Discord.</p>
              </div>
            </div>
            {betList.length === 0 ? <div className="forum-list"><div className="empty"><strong>No bets yet</strong>Place a bet in Discord and it&apos;ll show up here.</div></div> : (
              <div className="forum-list">
                {betList.slice(0, 20).map((b: any, i: number) => (
                  <div className="bet-row" key={b.bet_id ?? i}>
                    <div>
                      <strong>{b.selection_name || b.selection_id}</strong>
                      <div className="topic-meta">{b.fixture_key}{b.placed_at ? ` · ${new Date(b.placed_at).toLocaleDateString()}` : ''}</div>
                    </div>
                    <div className="topic-meta">
                      Stake W${money(b.stake)} @ {Number(b.odds).toFixed(2)}
                      <span className="pill cyan">{String(b.status || 'open').toUpperCase()}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}

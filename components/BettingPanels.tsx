'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { fmtDateTime, timeAgo } from '@/lib/format';
import { usePublicFixtures } from '@/components/PublicLiveData';

const DISCORD_URL = 'https://discord.com/channels/786583939028090881/1550152646638174308';
const TAKEOUT = 0.05;

function money(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '0.00';
}

function sideOdds(fixture: any, side: 'one' | 'two') {
  const official = Number(side === 'one' ? fixture.odds_one : fixture.odds_two) || 0;
  const total = Number(fixture.pool_total) || 0;
  const selected = Number(side === 'one' ? fixture.pool_one : fixture.pool_two) || 0;
  const live = total > 0 && selected > 0
    ? Math.max(1, total * (1 - TAKEOUT) / selected)
    : null;
  const guaranteed = official > 0
    ? Math.max(1, official / (1 + TAKEOUT), live ?? 0)
    : 0;
  return { official, live: live ?? official, guaranteed };
}

function PlayerName({ id, tour, name }: { id?: string | number | null; tour?: string | null; name: string }) {
  if (!id || !tour) return <>{name}</>;
  return <Link href={`/players/${id}?tour=${encodeURIComponent(tour)}`}>{name}</Link>;
}

function FeedMessage({ title, detail, unavailable = false }: {
  title: string;
  detail: string;
  unavailable?: boolean;
}) {
  return (
    <div className="forum-list">
      <div className={`empty${unavailable ? ' notice warn' : ''}`} role="status" aria-live="polite">
        <strong>{title}</strong>{detail}
      </div>
    </div>
  );
}

export function BettingBoardPanels() {
  const feed = usePublicFixtures();
  const board = feed.bettingBoard;
  const fixtures = board.open;
  const settled = board.recent_settled;

  return (
    <>
      <div className="section-head">
        <div>
          <h2 className="display">Open fixtures</h2>
          <p>WTSL odds, house-adjusted live odds and the guaranteed minimum you&apos;d lock in right now.</p>
        </div>
        <a className="btn btn-discord btn-sm" href={DISCORD_URL} target="_blank" rel="noreferrer">Place virtual bets in Discord ↗</a>
      </div>
      {feed.status === 'loading' ? (
        null
      ) : feed.status === 'unavailable' ? (
        <FeedMessage title="Open fixtures unavailable." detail="The official-draw check did not finish. Markets have not been cleared or presented as open." unavailable />
      ) : fixtures.length === 0 ? (
        <FeedMessage title="No open fixtures." detail="New fixtures appear when the next round opens." />
      ) : (
        <div className="fixture-grid">
          {fixtures.map((fixture: any) => {
            const one = sideOdds(fixture, 'one');
            const two = sideOdds(fixture, 'two');
            return (
              <article className="fixture-card" key={fixture.key}>
                <div className="fixture-top"><span>{fixture.tournament || 'WTSL'} · {(fixture.tour || 'TE4').toUpperCase()}</span><b>{String(fixture.status || 'open').toUpperCase()}</b></div>
                <h2><PlayerName id={fixture.first_id} tour={fixture.tour} name={fixture.first_name} /> <small>vs</small> <PlayerName id={fixture.second_id} tour={fixture.tour} name={fixture.second_name} /></h2>
                <div className="topic-meta">{fixture.round_deadline ? `Deadline: ${fmtDateTime(fixture.round_deadline)}` : 'No deadline set'}</div>
                <div className="odds-compare">
                  <div className="odds-head"><span /><span>WTSL</span><span>Live</span><span>Min</span></div>
                  <div className="odds-side"><b><PlayerName id={fixture.first_id} tour={fixture.tour} name={fixture.first_name} /></b><span>{one.official.toFixed(2)}</span><span>{one.live.toFixed(2)}</span><span>{one.guaranteed.toFixed(2)}</span></div>
                  <div className="odds-side"><b><PlayerName id={fixture.second_id} tour={fixture.tour} name={fixture.second_name} /></b><span>{two.official.toFixed(2)}</span><span>{two.live.toFixed(2)}</span><span>{two.guaranteed.toFixed(2)}</span></div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <div className="section-head section-space">
        <div>
          <h2 className="display">Recently settled</h2>
          <p>Markets the bot has resolved. If a pairing disappears from its official draw, the market is voided and affected bets are refunded.</p>
        </div>
      </div>
      {feed.status === 'loading' ? (
        null
      ) : feed.status === 'unavailable' ? (
        <FeedMessage title="Settled markets unavailable." detail="The betting feed could not be loaded." unavailable />
      ) : settled.length === 0 ? (
        <FeedMessage title="No settled fixtures yet." detail="Settled results appear here once the bot closes a market out." />
      ) : (
        <div className="fixture-grid">
          {settled.map((fixture: any) => {
            const winnerIsFirst = fixture.winner_id != null && String(fixture.winner_id) === String(fixture.first_id);
            const winnerIsSecond = fixture.winner_id != null && String(fixture.winner_id) === String(fixture.second_id);
            const refunded = fixture.winner_id == null;
            return (
              <article className="fixture-card" key={fixture.key}>
                <div className="fixture-top"><span>{fixture.tournament || 'WTSL'} · {(fixture.tour || 'TE4').toUpperCase()}</span><b>{refunded ? 'VOID / REFUNDED' : 'SETTLED'}</b></div>
                <h2 className="fixture-matchup">
                  <span className={winnerIsFirst ? 'winner' : ''}>
                    <PlayerName id={fixture.first_id} tour={fixture.tour} name={fixture.first_name} />
                    {winnerIsFirst ? <span className="winner-check">✓</span> : null}
                  </span>
                  <small>vs</small>
                  <span className={winnerIsSecond ? 'winner' : ''}>
                    <PlayerName id={fixture.second_id} tour={fixture.tour} name={fixture.second_name} />
                    {winnerIsSecond ? <span className="winner-check">✓</span> : null}
                  </span>
                </h2>
                <div className="topic-meta">{fixture.result_note ? `${fixture.result_note} · ` : ''}{fixture.settled_at ? `Settled ${timeAgo(fixture.settled_at)}` : ''}</div>
                {!refunded && <div className="odds-compare">
                  <div className="odds-head"><span /><span>WTSL odds</span></div>
                  <div className="odds-side"><b>{fixture.first_name}</b><span>{(Number(fixture.odds_one) || 0).toFixed(2)}</span></div>
                  <div className="odds-side"><b>{fixture.second_name}</b><span>{(Number(fixture.odds_two) || 0).toFixed(2)}</span></div>
                </div>}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}

export function MyBettingPanel() {
  const [balanceStatus, setBalanceStatus] = useState<'loading' | 'ready' | 'unauthorized' | 'unavailable'>('loading');
  const [account, setAccount] = useState<Record<string, unknown> | null>(null);
  const [ledgerStatus, setLedgerStatus] = useState<'loading' | 'ready' | 'unauthorized' | 'unavailable'>('loading');
  const [bets, setBets] = useState<any[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    const loadBalance = async () => {
      try {
        const response = await fetch('/api/betting/account', { cache: 'no-store', signal: controller.signal });
        if (!controller.signal.aborted) {
          if (response.status === 401) setBalanceStatus('unauthorized');
          else if (!response.ok) setBalanceStatus('unavailable');
          else {
            const payload = await response.json() as { account?: Record<string, unknown> };
            if (payload.account) {
              setAccount(payload.account);
              setBalanceStatus('ready');
            } else setBalanceStatus('unavailable');
          }
        }
      } catch {
        if (!controller.signal.aborted) setBalanceStatus('unavailable');
      }
    };
    const loadLedger = async () => {
      try {
        const response = await fetch('/api/betting/ledger', { cache: 'no-store', signal: controller.signal });
        if (!controller.signal.aborted) {
          if (response.status === 401) setLedgerStatus('unauthorized');
          else if (!response.ok) setLedgerStatus('unavailable');
          else {
            const payload = await response.json() as { bets?: any[] };
            if (Array.isArray(payload.bets)) {
              setBets(payload.bets);
              setLedgerStatus('ready');
            } else setLedgerStatus('unavailable');
          }
        }
      } catch {
        if (!controller.signal.aborted) setLedgerStatus('unavailable');
      }
    };
    void loadBalance();
    void loadLedger();
    return () => controller.abort();
  }, []);

  return (
    <>
      {balanceStatus !== 'loading' && (
        <div className="kpi-grid">
          <div><span>My W$ balance</span><b>{balanceStatus === 'ready' ? `W$${money(account?.balance)}` : '—'}</b></div>
          <div><span>Total staked</span><b>{balanceStatus === 'ready' ? `W$${money(account?.total_staked)}` : '—'}</b></div>
          <div><span>Total returned</span><b>{balanceStatus === 'ready' ? `W$${money(account?.total_returned)}` : '—'}</b></div>
          <div><span>Net profit</span><b>{balanceStatus === 'ready' ? `W$${money(account?.total_profit)}` : '—'}</b></div>
        </div>
      )}
      {balanceStatus === 'unavailable' && <FeedMessage title="Your balance is unavailable." detail="This does not affect your bet ledger." unavailable />}
      <div className="section-head section-space">
        <div>
          <h2 className="display">My bet ledger</h2>
          <p>Your recent bets placed in Discord.</p>
        </div>
      </div>
      {ledgerStatus === 'loading' ? (
        null
      ) : ledgerStatus === 'unauthorized' ? (
        <div className="forum-list"><div className="empty"><strong>Sign in to view your ledger</strong><a className="btn btn-discord btn-sm" href="/api/auth/discord">Log in with Discord</a></div></div>
      ) : ledgerStatus === 'unavailable' ? (
        <FeedMessage title="Your betting data is unavailable." detail="The account feed failed. This does not mean your ledger is empty." unavailable />
      ) : bets.length === 0 ? (
        <div className="forum-list"><div className="empty"><strong>No bets yet</strong>Place a bet in Discord and it&apos;ll show up here.</div></div>
      ) : (
        <div className="forum-list">
          {bets.slice(0, 20).map((bet: any, index: number) => (
            <div className="bet-row" key={bet.bet_id ?? index}>
              <div>
                <strong>{bet.selection_name || bet.selection_id}</strong>
                <div className="topic-meta">{bet.fixture_key}{bet.placed_at ? ` · ${new Date(bet.placed_at).toLocaleDateString()}` : ''}</div>
              </div>
              <div className="topic-meta">
                Stake W${money(bet.stake)} @ {Number(bet.odds).toFixed(2)}
                <span className="pill cyan">{String(bet.status || 'open').toUpperCase()}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

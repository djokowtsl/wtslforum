import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { wtslCore, type CorePredictionRow } from '@/lib/wtsl-core';
import { getChallongeDisplayMap, type ChallongeDisplay } from '@/lib/challonge-claims';
import { safe } from '@/lib/db';
import PageHero from '@/components/PageHero';
import { getPublicSiteSnapshot } from '@/lib/siteSnapshots';
import SnapshotAutoRefresh from '@/components/SnapshotAutoRefresh';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Predictions leaderboard' };

async function safeLeaderboard(): Promise<{ rows: CorePredictionRow[]; checkedAt: string | null; unavailable: boolean }> {
  if (!wtslCore.configured()) return { rows: [], checkedAt: null, unavailable: false };
  try {
    const snapshot = await getPublicSiteSnapshot(
      'predictions-leaderboard',
      () => wtslCore.predictionsLeaderboard(100),
    );
    if (!Array.isArray(snapshot.payload)) {
      return { rows: [], checkedAt: null, unavailable: true };
    }
    return { rows: snapshot.payload, checkedAt: snapshot.checkedAt, unavailable: false };
  } catch {
    return { rows: [], checkedAt: null, unavailable: true };
  }
}

const MEDALS = ['🥇', '🥈', '🥉'];

// Small cosmetic aliasing for a couple of usernames, kept in sync with
// PREDICTION_DISPLAY_NAME_ALIASES in the bot's main.py Discord embed. Only used as a fallback
// for predictors who haven't verified their Challonge username on the forum yet.
const DISPLAY_NAME_ALIASES: Record<string, string> = {
  squeaky94: 'Squeaky',
};

function predictorName(r: CorePredictionRow, verified?: ChallongeDisplay): string {
  if (verified) return verified.displayName;
  const username = (r.challonge_username || '').trim();
  const alias = username ? DISPLAY_NAME_ALIASES[username.toLowerCase()] : undefined;
  if (alias) return `${alias} (${username})`;
  return username || r.prediction_name || 'Unknown';
}

async function PredictionsLeaderboard() {
  const [leaderboard, challongeMap] = await Promise.all([
    safeLeaderboard(),
    safe(() => getChallongeDisplayMap(), new Map<string, ChallongeDisplay>()),
  ]);
  const { rows } = leaderboard;
  return (
    <main className="container">
      {!wtslCore.configured() ? (
        <div className="notice">The predictions leaderboard isn&apos;t available on this deployment yet.</div>
      ) : leaderboard.unavailable ? (
        <div className="notice warn" role="status">The predictions snapshot is not available yet. Standings will appear after the next successful background sync.</div>
      ) : rows.length === 0 ? (
        <>
          {leaderboard.checkedAt && <p className="muted feed-freshness">Standings checked {new Date(leaderboard.checkedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</p>}
          <div className="forum-list"><div className="empty"><strong>No predictions recorded yet</strong>Standings appear once the Discord bot scans a tournament&apos;s picks.</div></div>
        </>
      ) : (
        <section className="panel">
          <div className="panel-head"><h2 className="display">Top predictors</h2><span>{rows.length} ranked</span></div>
          {leaderboard.checkedAt && <p className="muted feed-freshness">Standings checked {new Date(leaderboard.checkedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</p>}
          <table>
            <thead>
              <tr><th>#</th><th>Predictor</th><th>Points</th><th>Correct picks</th><th>Tournaments</th><th>Won</th><th>Avg score</th></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const possible = Number(r.total_picks_potential) || 0;
                const correct = Number(r.total_picks) || 0;
                const pct = possible > 0 ? Math.round((correct / possible) * 100) : 0;
                const verified = challongeMap.get((r.challonge_username || '').trim().toLowerCase());
                return (
                  <tr key={r.challonge_user_id}>
                    <td>{MEDALS[i] || i + 1}</td>
                    <td>
                      <div className="prediction-player">
                        {verified && (verified.avatarUrl
                          ? <img src={verified.avatarUrl} alt="" loading="lazy" />
                          : <span className="prediction-avatar-placeholder" aria-hidden="true">{predictorName(r, verified).trim().slice(0, 1).toUpperCase() || '?'}</span>)}
                        {verified?.wtslPlayerId && verified.tour ? (
                          <Link href={`/players/${verified.wtslPlayerId}?tour=${encodeURIComponent(verified.tour)}`}>{predictorName(r, verified)}</Link>
                        ) : (
                          predictorName(r, verified)
                        )}
                      </div>
                    </td>
                    <td><b>{r.total_score}</b></td>
                    <td>{correct}/{possible}{possible > 0 ? ` (${pct}%)` : ''}</td>
                    <td>{r.tournaments}</td>
                    <td>{r.tournaments_won}</td>
                    <td>{Number(r.average_score).toFixed(1)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}

export default function Predictions() {
  return (
    <>
      <PageHero eyebrow="WTSL Forum" title="Predictions leaderboard">
        Challonge prediction standings.
      </PageHero>
      <SnapshotAutoRefresh />
      <Suspense fallback={null}>
        <PredictionsLeaderboard />
      </Suspense>
    </>
  );
}

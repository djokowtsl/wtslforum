import type { Metadata } from 'next';
import { wtslCore, type CorePredictionRow } from '@/lib/wtsl-core';
import PageHero from '@/components/PageHero';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Predictions leaderboard' };

async function safeLeaderboard(): Promise<CorePredictionRow[]> {
  if (!wtslCore.configured()) return [];
  try {
    return await wtslCore.predictionsLeaderboard(100);
  } catch {
    return [];
  }
}

const MEDALS = ['🥇', '🥈', '🥉'];

export default async function Predictions() {
  const rows = await safeLeaderboard();
  return (
    <>
      <PageHero eyebrow="WTSL Community" title="Predictions leaderboard">
        Bracket prediction standings from the WTSL Discord, synced from Challonge picks.
      </PageHero>
      <main className="container">
        {!wtslCore.configured() ? (
          <div className="notice">The predictions leaderboard isn&apos;t available on this deployment yet.</div>
        ) : rows.length === 0 ? (
          <div className="forum-list"><div className="empty"><strong>No predictions recorded yet</strong>Standings appear once the Discord bot scans a tournament&apos;s picks.</div></div>
        ) : (
          <section className="panel">
            <div className="panel-head"><h2 className="display">Top predictors</h2><span>{rows.length} ranked</span></div>
            <table>
              <thead>
                <tr><th>#</th><th>Predictor</th><th>Points</th><th>Correct picks</th><th>Tournaments</th><th>Won</th><th>Avg score</th></tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const possible = Number(r.total_picks_potential) || 0;
                  const correct = Number(r.total_picks) || 0;
                  const pct = possible > 0 ? Math.round((correct / possible) * 100) : 0;
                  return (
                    <tr key={r.challonge_user_id}>
                      <td>{MEDALS[i] || i + 1}</td>
                      <td>{r.prediction_name || r.challonge_username || 'Unknown'}{r.discord_user_id ? <small> · Discord-linked</small> : null}</td>
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
    </>
  );
}

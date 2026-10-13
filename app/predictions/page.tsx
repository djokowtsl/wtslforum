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
export const metadata: Metadata = { title: 'Predictions & Projections' };

const PROJECTIONS = [
  ['Shanghai', 'Shanghai_2026_TE4'],
  ['Cincinnati', 'Cincinnati_2026_TE4'],
  ['Wimbledon', 'Wimbledon_2026_TE4'],
  ['Halle', 'Halle_2026_TE4'],
  ['s-Hertogenbosch', 'sHertogenbosch_2026_TE4'],
  ['Boss Open', 'Boss_Open_2026_TE4'],
  ['Roland Garros', 'Roland_Garros_2026_TE4'],
  ['Rome', 'Rome_2026_TE4'],
  ['Bordeaux', 'Bordeaux_2026_TE4'],
  ['Carnac', 'Carnac_2026_TE4'],
  ['Cagliari', 'Cagliari_2026_TE4'],
  ['Madrid', 'Madrid_2026_TE4'],
  ['Reggio Emilia', 'Reggio_Emilia_2026_TE4'],
  ['Valencia', 'Valencia_2026_TE4'],
  ['Castelldefels', 'Castelldefels_2026_TE4'],
  ['Barcelona', 'Barcelona_2026_TE4'],
  ['Oeiras', 'Oeiras_2026_TE4'],
  ['Cueta', 'Cueta_2026_TE4'],
  ['Monte Carlo', 'Monte_Carlo_2026_TE4'],
  ['Miami', 'Miami_2026_TE4'],
] as const;

const DEFAULT_PROJECTION = PROJECTIONS[0][1];
const projectionUrl = (id: string) =>
  `https://www.playwtsl.com/pages/bracket.php?tournament=${encodeURIComponent(id)}`;

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
    <section className="predictions-leaderboard-scroll" aria-label="Challonge prediction leaderboard">
      {!wtslCore.configured() ? (
        <div className="notice">The predictions leaderboard isn&apos;t available on this deployment yet.</div>
      ) : leaderboard.unavailable ? (
        <div className="notice warn" role="status">Standings are temporarily unavailable. Please try again later.</div>
      ) : rows.length === 0 ? (
        <>
          <div className="forum-list"><div className="empty"><strong>No predictions recorded yet</strong>Standings appear as tournament predictions are added.</div></div>
        </>
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
    </section>
  );
}

export default async function Predictions({ searchParams }: { searchParams: Promise<{ tournament?: string }> }) {
  const params = await searchParams;
  const selectedProjection = PROJECTIONS.find(([, id]) => id === params.tournament)?.[1] ?? DEFAULT_PROJECTION;
  const selectedName = PROJECTIONS.find(([, id]) => id === selectedProjection)?.[0] ?? 'Shanghai';
  const selectedUrl = projectionUrl(selectedProjection);
  return (
    <>
      <PageHero eyebrow="WTSL Forum" title="Predictions & Projections">
        Community Challonge standings, alongside the official 2026 tournament projections.
      </PageHero>
      <SnapshotAutoRefresh />
      <main className="container predictions-page">
        <div className="predictions-section-heading">
          <div>
            <span className="eyebrow">Community standings</span>
            <h2 className="display">Top predictors</h2>
          </div>
          <span className="predictions-section-note">Ranked by tournament picks</span>
        </div>
        <Suspense fallback={<section className="predictions-leaderboard-scroll"><div className="forum-list"><div className="empty" aria-label="Loading leaderboard"><strong>Loading standings</strong><span className="predictions-skeleton" /></div></div></section>}>
          <PredictionsLeaderboard />
        </Suspense>

        <section className="projection-section" aria-labelledby="projection-heading">
          <div className="predictions-section-heading projection-heading">
            <div>
              <span className="eyebrow">Official tournament draw</span>
              <h2 id="projection-heading" className="display">2026 projections</h2>
              <p>Choose an event to explore its projected draw. Table and Matches views remain available in the source page.</p>
            </div>
            <a className="btn btn-ghost projection-open-link" href={selectedUrl} target="_blank" rel="noopener noreferrer">
              Open {selectedName} 2026 separately <span aria-hidden="true">↗</span>
            </a>
          </div>
          <form className="projection-controls" action="/predictions" method="get">
            <label htmlFor="projection-tournament">Tournament</label>
            <select id="projection-tournament" name="tournament" defaultValue={selectedProjection}>
              {PROJECTIONS.map(([name, id]) => (
                <option key={id} value={id}>{name} 2026</option>
              ))}
            </select>
            <button className="btn btn-primary btn-sm" type="submit">Show projection</button>
          </form>
          <div className="projection-frame-wrap">
            <iframe
              key={selectedProjection}
              className="projection-frame"
              src={selectedUrl}
              title={`${selectedName} 2026 official tournament projection`}
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
            />
          </div>
        </section>
      </main>
    </>
  );
}

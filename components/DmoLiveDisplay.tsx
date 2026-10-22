'use client';

import type { Te4DmoReplaySpeed, Te4LiveSnapshot } from '@/lib/te4DmoLive';
import { surfaceForDmoTournament } from '@/lib/te4DmoSurface';
import DmoLiveCourt from './DmoLiveCourt';
import styles from './DmoLiveDisplay.module.css';

type Props = {
  snapshot: Te4LiveSnapshot;
  state: 'live' | 'ended';
  playbackSpeed?: Te4DmoReplaySpeed;
  stale?: boolean;
  updatedAt?: string;
};

function scoreLabel(sets: [number, number][]) {
  if (!sets.length) return 'Match in progress';
  return sets.map(([a, b]) => `${a}–${b}`).join('  ');
}

function pointText(value: number) {
  if (value === 0) return '0';
  if (value === 1) return '15';
  if (value === 2) return '30';
  return '40';
}

function timeAgo(value?: string) {
  if (!value) return '';
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 5) return 'updated just now';
  return `updated ${seconds}s ago`;
}

function ChanceChart({ values, players }: { values: number[]; players: [string, string] }) {
  const safeValues = values.length ? values : [0.5, 0.5];
  const path = safeValues.map((value, index) => {
    const x = safeValues.length === 1 ? 0 : (index / (safeValues.length - 1)) * 100;
    const y = 38 - Math.max(0, Math.min(1, value)) * 34;
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');

  return (
    <div className={styles.chanceChart}>
      <div className={styles.chanceHead}>
        <span>{players[0]}</span>
        <strong>WIN CHANCE</strong>
        <span>{players[1]}</span>
      </div>
      <svg viewBox="0 0 100 42" preserveAspectRatio="none" role="img" aria-label={`${players[0]} live match win chance`}>
        <line x1="0" y1="21" x2="100" y2="21" className={styles.chartMidline} />
        <path d={`${path} L100,42 L0,42 Z`} className={styles.chartArea} />
        <path d={path} className={styles.chartLine} />
      </svg>
      <div className={styles.chanceValues}>
        <strong>{Math.round(safeValues[safeValues.length - 1] * 100)}%</strong>
        <strong>{Math.round((1 - safeValues[safeValues.length - 1]) * 100)}%</strong>
      </div>
      <p>Estimate from recorded serve results so far. No pre-match rating is included.</p>
    </div>
  );
}

export default function DmoLiveDisplay({
  snapshot,
  state,
  playbackSpeed = 1,
  stale = false,
  updatedAt,
}: Props) {
  const p1Stats = snapshot.stats[0];
  const p2Stats = snapshot.stats[1];
  const surface = surfaceForDmoTournament(snapshot.stadium);
  const statusLabel = state === 'ended' ? 'Broadcast ended' : stale ? 'Connection paused' : 'Live';
  const pointScore = snapshot.score.tiebreak
    ? `${snapshot.score.points[0]}–${snapshot.score.points[1]}`
    : `${snapshot.score.pointText[0]}–${snapshot.score.pointText[1]}`;

  return (
    <section className={styles.panel} aria-label="Live TE4 DMO match">
      <header className={styles.header}>
        <div>
          <div className={styles.statusRow}>
            <span className={`${styles.statusDot} ${state === 'ended' ? styles.endedDot : stale ? styles.staleDot : ''}`} />
            <span>{statusLabel}</span>
            {updatedAt && <small>{timeAgo(updatedAt)}</small>}
          </div>
          <h2>{snapshot.players[0]} <i>vs</i> {snapshot.players[1]}</h2>
          <p>{snapshot.stadium || 'TE4 match'} <span>·</span> {snapshot.frameCount.toLocaleString()} frames <span>·</span> {snapshot.pointCount} completed points</p>
        </div>
        <div className={styles.finalScore}>
          <small>SETS</small>
          <strong>{scoreLabel(snapshot.score.sets)}</strong>
        </div>
      </header>

      <div className={styles.liveCourtStage}>
        <DmoLiveCourt snapshot={snapshot} surface={surface} playbackSpeed={playbackSpeed} />
        <p className={styles.pointNote}>
          {snapshot.currentPoint.inProgress
            ? `Point ${snapshot.currentPoint.number} in progress · ${snapshot.currentPoint.rallyHits} recorded rally shots${snapshot.currentPoint.serveSpeedKmh ? ` · serve ${snapshot.currentPoint.serveSpeedKmh} km/h` : ''}`
            : `Next point · ${pointScore}${snapshot.score.tiebreak ? ' (tiebreak)' : ''}`}
        </p>
      </div>

      <div className={styles.mainGrid}>
        <div className={styles.leftColumn}>
          <div className={styles.scoreTable} role="table" aria-label="Match score">
        <div className={styles.scoreHeading} role="row">
          <span role="columnheader">Player</span>
          <span role="columnheader">Games</span>
          <span role="columnheader">{snapshot.score.tiebreak ? 'TB' : 'Points'}</span>
          <span role="columnheader">Serve</span>
        </div>
            {snapshot.players.map((name, index) => {
              const stats = index === 0 ? p1Stats : p2Stats;
              return (
                <div className={styles.scoreRow} role="row" key={`${index}-${name}`}>
                  <strong role="cell" className={styles.playerName}>{name}</strong>
                  <strong role="cell">{snapshot.score.games[index]}</strong>
                  <strong role="cell" className={styles.pointsCell}>{snapshot.score.tiebreak ? snapshot.score.points[index] : snapshot.score.pointText[index]}</strong>
                  <span role="cell" className={styles.serveCell}>
                    {snapshot.score.server === index + 1 ? <i aria-label="Serving">●</i> : null}
                    {stats.serviceWinRate === null ? '—' : `${Math.round(stats.serviceWinRate * 100)}%`}
                  </span>
                </div>
              );
            })}
          </div>
          <div className={styles.metrics} aria-label="Match statistics">
            <div><span>Service points won</span><strong>{p1Stats.servicePointsWon}/{p1Stats.servicePoints}</strong><small>{snapshot.players[0]}</small></div>
            <div><span>Service points won</span><strong>{p2Stats.servicePointsWon}/{p2Stats.servicePoints}</strong><small>{snapshot.players[1]}</small></div>
            <div><span>Unreturned serves</span><strong>{p1Stats.acesOrUnreturned} / {p2Stats.acesOrUnreturned}</strong><small>{snapshot.players[0]} / {snapshot.players[1]}</small></div>
          </div>
          <ChanceChart values={snapshot.winHistory} players={snapshot.players} />
        </div>

        <div className={styles.rightColumn}>
          <div className={styles.recentHeading}>
            <strong>POINT LOG</strong>
            <span>LAST {snapshot.recentPoints.length}</span>
          </div>
          {snapshot.recentPoints.length ? (
            <ol className={styles.pointList}>
              {[...snapshot.recentPoints].reverse().map((point) => (
                <li key={point.number}>
                  <span className={styles.pointScore}>{point.scoreLabel ?? '—'}</span>
                  <span><b>{snapshot.players[point.winner - 1]}</b><small>{point.rallyHits ? `${point.rallyHits + 1} shots` : 'Unreturned serve'}{point.faults ? ` · ${point.faults} fault` : ''}</small></span>
                  <span className={styles.pointServer}>{point.server === 1 ? 'P1 serve' : 'P2 serve'}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className={styles.emptyLog}>Completed points will appear here.</p>
          )}
        </div>
      </div>
      <footer className={styles.footer}>
        <span>The original DMO stays on the broadcaster&apos;s device. Active updates contain only recent court positions and parsed point events.</span>
        <span>Best of {snapshot.bestOf}</span>
      </footer>
    </section>
  );
}

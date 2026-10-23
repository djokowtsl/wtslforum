'use client';

import type { Te4DmoReplaySpeed, Te4LivePoint, Te4LiveSnapshot } from '@/lib/te4DmoLive';
import type { LivePreMatchProbability } from '@/lib/liveBroadcast';
import { surfaceForDmoTournament } from '@/lib/te4DmoSurface';
import DmoLiveCourt from './DmoLiveCourt3D';
import styles from './DmoLiveDisplay.module.css';

type Props = {
  snapshot: Te4LiveSnapshot;
  state: 'live' | 'ended';
  playbackSpeed?: Te4DmoReplaySpeed;
  stale?: boolean;
  updatedAt?: string;
  preMatchPrediction?: LivePreMatchProbability | null;
  pointLog?: Te4LivePoint[];
  pointLogLoaded?: boolean;
};

function scoreLabel(sets: [number, number][]) {
  if (!sets.length) return null;
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
  const milliseconds = Math.max(0, Date.now() - new Date(value).getTime());
  if (milliseconds < 1_500) return 'updated just now';
  return `updated ${Math.ceil(milliseconds / 1000)}s ago`;
}

function ChanceChart({
  values,
  players,
  preMatchPrediction,
}: {
  values: number[];
  players: [string, string];
  preMatchPrediction?: LivePreMatchProbability | null;
}) {
  const safeValues = values.length ? values : [0.5, 0.5];
  const secondPreMatchProbability = preMatchPrediction
    ? 100 - preMatchPrediction.probability
    : null;
  const tourLabel = preMatchPrediction?.tour === 'TE4_(F)' ? 'WTA' : 'ATP';
  const preMatchSource = preMatchPrediction?.source === 'official'
    ? `Official WTSL ${tourLabel} Elo/H2H`
    : preMatchPrediction?.source === 'all-results'
      ? `WTSL ${tourLabel} H2H results`
      : preMatchPrediction
        ? `Official WTSL ${tourLabel} · no H2H record`
        : '';
  const path = safeValues.map((value, index) => {
    const x = safeValues.length === 1 ? 0 : (index / (safeValues.length - 1)) * 100;
    const y = 38 - Math.max(0, Math.min(1, value)) * 34;
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');

  return (
    <div className={styles.chanceChart}>
      <div className={styles.chanceHead}>
        <span>{players[0]}</span>
        <strong>LIVE WIN CHANCE</strong>
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
      <p>Live estimate from the DMO score and recorded serve results.</p>
      {preMatchPrediction && secondPreMatchProbability !== null && (
        <div
          className={styles.preMatchChance}
          role="group"
          aria-label={`Official pre-match probabilities: ${players[0]} ${preMatchPrediction.probability}%, ${players[1]} ${secondPreMatchProbability}%`}
        >
          <div className={styles.preMatchHead}>
            <strong>PRE-MATCH</strong>
            <span>{preMatchSource}</span>
          </div>
          <div className={styles.preMatchValues}>
            <div><span>{players[0]}</span><strong>{preMatchPrediction.probability}%</strong></div>
            <div><span>{players[1]}</span><strong>{secondPreMatchProbability}%</strong></div>
          </div>
          <p>Shown separately; it does not change the live estimate.</p>
        </div>
      )}
    </div>
  );
}

export default function DmoLiveDisplay({
  snapshot,
  state,
  playbackSpeed = 1,
  stale = false,
  updatedAt,
  preMatchPrediction,
  pointLog,
  pointLogLoaded = false,
}: Props) {
  const playerStats = snapshot.stats;
  const p1Stats = playerStats[0];
  const p2Stats = playerStats[1];
  const surface = surfaceForDmoTournament(snapshot.stadium);
  const statusLabel = state === 'ended' ? 'Broadcast ended' : stale ? 'Connection paused' : 'Live';
  const pointScore = snapshot.score.tiebreak
    ? `${snapshot.score.points[0]}–${snapshot.score.points[1]}`
    : `${snapshot.score.pointText[0]}–${snapshot.score.pointText[1]}`;
  const displayedPointLog = pointLog ?? snapshot.recentPoints;

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
          <p>{snapshot.stadium || 'TE4 match'}</p>
        </div>
      </header>

      <div className={styles.liveCourtStage}>
        <DmoLiveCourt snapshot={snapshot} surface={surface} playbackSpeed={playbackSpeed} />
        <aside className={styles.scoreBug} aria-label="Live match score">
          <div className={styles.scoreBugHeader}>
            <span className={styles.scoreBugStatus}>
              <i aria-hidden="true" className={styles.scoreBugDot} />
              {statusLabel}
            </span>
            {scoreLabel(snapshot.score.sets) && (
              <strong className={styles.scoreBugSets} aria-label="Set scores">
                {scoreLabel(snapshot.score.sets)}
              </strong>
            )}
          </div>
          <div className={styles.scoreBugTable} role="table" aria-label="Player, games, points and serve percentage">
            <div className={styles.scoreBugHeading} role="row">
              <span role="columnheader">Player</span>
              <span role="columnheader">Games</span>
              <span role="columnheader">{snapshot.score.tiebreak ? 'TB' : 'Points'}</span>
              <span role="columnheader">Serve</span>
            </div>
            {snapshot.players.map((name, index) => (
              <div className={styles.scoreBugRow} role="row" key={`${index}-${name}`}>
                <strong role="cell" className={styles.scoreBugPlayer} title={name}>
                  {snapshot.score.server === index + 1 && (
                    <i className={styles.scoreBugServeDot} role="img" aria-label="Serving" />
                  )}
                  <span>{name}</span>
                </strong>
                <strong role="cell">{snapshot.score.games[index]}</strong>
                <strong role="cell" className={styles.scoreBugPoints}>
                  {snapshot.score.tiebreak ? snapshot.score.points[index] : snapshot.score.pointText[index]}
                </strong>
                <span role="cell" className={styles.scoreBugServe}>
                  {playerStats[index].serviceWinRate === null
                    ? '—'
                    : `${Math.round(playerStats[index].serviceWinRate * 100)}%`}
                </span>
              </div>
            ))}
          </div>
        </aside>
        <p className={styles.pointNote}>
          {snapshot.currentPoint.inProgress
            ? `Point ${snapshot.currentPoint.number} in progress · ${snapshot.currentPoint.rallyHits} recorded rally shots${snapshot.currentPoint.serveSpeedKmh ? ` · serve ${snapshot.currentPoint.serveSpeedKmh} km/h` : ''}`
            : `Next point · ${pointScore}${snapshot.score.tiebreak ? ' (tiebreak)' : ''}`}
        </p>
      </div>

      <div className={styles.mainGrid}>
        <div className={styles.leftColumn}>
          <div className={styles.metrics} role="table" aria-label="Match statistics">
            <div className={styles.metricsHeading} role="row">
              <span role="columnheader">Statistic</span>
              <span role="columnheader" title={snapshot.players[0]}>{snapshot.players[0]}</span>
              <span role="columnheader" title={snapshot.players[1]}>{snapshot.players[1]}</span>
            </div>
            <div className={styles.metricRow} role="row">
              <span role="rowheader">Points won</span>
              <strong role="cell">{p1Stats.pointsWon}</strong>
              <strong role="cell">{p2Stats.pointsWon}</strong>
            </div>
            <div className={styles.metricRow} role="row">
              <span role="rowheader">Service points won</span>
              <strong role="cell">{p1Stats.servicePointsWon}/{p1Stats.servicePoints}</strong>
              <strong role="cell">{p2Stats.servicePointsWon}/{p2Stats.servicePoints}</strong>
            </div>
            <div className={styles.metricRow} role="row">
              <span role="rowheader">Return points won</span>
              <strong role="cell">{p1Stats.pointsWon - p1Stats.servicePointsWon}/{p2Stats.servicePoints}</strong>
              <strong role="cell">{p2Stats.pointsWon - p2Stats.servicePointsWon}/{p1Stats.servicePoints}</strong>
            </div>
            <div className={styles.metricRow} role="row">
              <span role="rowheader">Unreturned serves</span>
              <strong role="cell">{p1Stats.acesOrUnreturned}</strong>
              <strong role="cell">{p2Stats.acesOrUnreturned}</strong>
            </div>
            <div className={styles.metricRow} role="row">
              <span role="rowheader">Serve faults</span>
              <strong role="cell">{p1Stats.firstServeFaults}</strong>
              <strong role="cell">{p2Stats.firstServeFaults}</strong>
            </div>
          </div>
          <ChanceChart
            values={snapshot.winHistory}
            players={snapshot.players}
            preMatchPrediction={preMatchPrediction}
          />
        </div>

        <div className={styles.rightColumn}>
          <div className={styles.recentHeading}>
            <strong>POINT LOG</strong>
            <span>NEWEST FIRST</span>
          </div>
          {displayedPointLog.length ? (
            <div
              className={styles.pointListScroller}
              role="region"
              tabIndex={0}
              aria-label="Match point log, newest first. Scroll down for earlier points."
            >
              <ol className={styles.pointList}>
              {[...displayedPointLog].reverse().map((point) => (
                <li key={point.number}>
                  <span className={styles.pointScore}>{point.scoreLabel ?? '—'}</span>
                  <span><b>{snapshot.players[point.winner - 1]}</b><small>{point.rallyHits ? `${point.rallyHits + 1} shots` : 'Unreturned serve'}{point.faults ? ` · ${point.faults} fault` : ''}</small></span>
                  <span className={styles.pointServer} title={`Served by ${snapshot.players[point.server - 1]}`}>
                    Serve: {snapshot.players[point.server - 1]}
                  </span>
                </li>
              ))}
              </ol>
            </div>
          ) : (
            <p className={styles.emptyLog}>Completed points will appear here.</p>
          )}
          {pointLogLoaded && displayedPointLog.length < snapshot.pointCount && (
            <p className={styles.pointLogNotice}>Some earlier points are unavailable for this broadcast.</p>
          )}
        </div>
      </div>
      <footer className={styles.footer}>
        <span>Best of {snapshot.bestOf}</span>
      </footer>
    </section>
  );
}

'use client';

import { useEffect, useRef } from 'react';
import type { Te4LiveSnapshot } from '@/lib/te4DmoLive';
import styles from './DmoLiveDisplay.module.css';

type Props = {
  snapshot: Te4LiveSnapshot;
  state: 'live' | 'ended';
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

function Court({ frames, players }: { frames: number[][]; players: [string, string] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    const width = canvas.width;
    const height = canvas.height;
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#071d31';
    context.fillRect(0, 0, width, height);

    const mapX = (value: number) => width / 2 + value * 0.21;
    const mapY = (value: number) => height / 2 + value * 0.25;
    const line = (x1: number, y1: number, x2: number, y2: number) => {
      context.beginPath();
      context.moveTo(mapX(x1), mapY(y1));
      context.lineTo(mapX(x2), mapY(y2));
      context.stroke();
    };
    const rect = (x1: number, y1: number, x2: number, y2: number) => {
      context.strokeRect(mapX(x1), mapY(y1), mapX(x2) - mapX(x1), mapY(y2) - mapY(y1));
    };

    context.strokeStyle = 'rgba(208,231,239,.72)';
    context.lineWidth = 2;
    rect(-1450, -700, 1450, 700);
    context.strokeStyle = 'rgba(208,231,239,.95)';
    context.lineWidth = 1.5;
    rect(-1189, -549, 1189, 549);
    line(0, -700, 0, 700);
    line(-1189, 0, 1189, 0);
    line(-1189, -300, 1189, -300);
    line(-1189, 300, 1189, 300);
    context.strokeStyle = 'rgba(176,244,59,.4)';
    context.lineWidth = 3;
    line(-1450, 0, 1450, 0);

    if (!frames.length) return;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.beginPath();
    frames.forEach((frame, index) => {
      const x = mapX(frame[0]);
      const y = mapY(frame[1]) - Math.min(80, frame[2] * 0.12);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.strokeStyle = 'rgba(255,255,255,.44)';
    context.lineWidth = 2;
    context.stroke();

    const latest = frames[frames.length - 1];
    const playersAtFrame = [
      { name: players[0], x: latest[3], y: latest[4], color: '#b0f43b', label: '1' },
      { name: players[1], x: latest[5], y: latest[6], color: '#38c7e6', label: '2' },
    ];
    for (const player of playersAtFrame) {
      const x = mapX(player.x);
      const y = mapY(player.y);
      context.beginPath();
      context.arc(x, y, 13, 0, Math.PI * 2);
      context.fillStyle = player.color;
      context.fill();
      context.lineWidth = 3;
      context.strokeStyle = '#07111f';
      context.stroke();
      context.fillStyle = '#06111f';
      context.font = '800 12px sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(player.label, x, y + 0.5);
    }

    const ballX = mapX(latest[0]);
    const ballY = mapY(latest[1]) - Math.min(80, latest[2] * 0.12);
    context.beginPath();
    context.arc(ballX, ballY, 6, 0, Math.PI * 2);
    context.fillStyle = '#fff';
    context.shadowColor = '#fff';
    context.shadowBlur = 12;
    context.fill();
    context.shadowBlur = 0;
  }, [frames, players]);

  return (
    <div className={styles.courtWrap}>
      <canvas ref={canvasRef} width={900} height={520} aria-label="Live court positions and ball trail" role="img" />
      <div className={styles.courtLegend}>
        <span><i className={styles.playerOneDot} /> {players[0]}</span>
        <span><i className={styles.playerTwoDot} /> {players[1]}</span>
        <span><i className={styles.ballDot} /> Ball</span>
      </div>
    </div>
  );
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

export default function DmoLiveDisplay({ snapshot, state, stale = false, updatedAt }: Props) {
  const p1Stats = snapshot.stats[0];
  const p2Stats = snapshot.stats[1];
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
          <p className={styles.pointNote}>
            {snapshot.currentPoint.inProgress
              ? `Point ${snapshot.currentPoint.number} in progress · ${snapshot.currentPoint.rallyHits} recorded rally shots${snapshot.currentPoint.serveSpeedKmh ? ` · serve ${snapshot.currentPoint.serveSpeedKmh} km/h` : ''}`
              : `Next point · ${pointScore}${snapshot.score.tiebreak ? ' (tiebreak)' : ''}`}
          </p>

          <div className={styles.metrics} aria-label="Match statistics">
            <div><span>Service points won</span><strong>{p1Stats.servicePointsWon}/{p1Stats.servicePoints}</strong><small>{snapshot.players[0]}</small></div>
            <div><span>Service points won</span><strong>{p2Stats.servicePointsWon}/{p2Stats.servicePoints}</strong><small>{snapshot.players[1]}</small></div>
            <div><span>Unreturned serves</span><strong>{p1Stats.acesOrUnreturned} / {p2Stats.acesOrUnreturned}</strong><small>{snapshot.players[0]} / {snapshot.players[1]}</small></div>
          </div>
          <ChanceChart values={snapshot.winHistory} players={snapshot.players} />
        </div>

        <div className={styles.rightColumn}>
          <div className={styles.courtHeading}>
            <strong>COURT TRACKER</strong>
            <span>{snapshot.currentPoint.inProgress ? 'POINT IN PLAY' : 'LATEST FRAME'}</span>
          </div>
          <Court frames={snapshot.court} players={snapshot.players} />
          <div className={styles.recentHeading}>
            <strong>POINT LOG</strong>
            <span>LAST {snapshot.recentPoints.length}</span>
          </div>
          {snapshot.recentPoints.length ? (
            <ol className={styles.pointList}>
              {[...snapshot.recentPoints].reverse().map((point) => (
                <li key={point.number}>
                  <span className={styles.pointNumber}>{String(point.number).padStart(2, '0')}</span>
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
        <span>DMO data is parsed in the broadcaster&apos;s browser. The Forum stores only this temporary scoreboard snapshot.</span>
        <span>Best of {snapshot.bestOf}</span>
      </footer>
    </section>
  );
}

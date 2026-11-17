'use client';

import { Fragment, memo, useEffect, useRef, useState } from 'react';
import { RotateCcw, X } from 'lucide-react';
import {
  describeDmoReplayPoint,
  type DmoReplayPlayerStatistics,
  type DmoReplayPointEntry,
  type DmoReplaySeekMarker,
} from '@/lib/dmoReplayNavigation.mjs';
import type { Te4Highlight } from '@/lib/te4DmoTypes';
import styles from './DmoReplayNavigation.module.css';

/**
 * Game and set marks drawn over the replay seek bar. Worked out once per
 * replay, so this never re-renders during playback.
 */
export const DmoReplaySeekMarkers = memo(function DmoReplaySeekMarkers({
  markers,
}: {
  markers: readonly DmoReplaySeekMarker[];
}) {
  if (!markers.length) return null;
  return (
    <span className={styles.markers} aria-hidden="true">
      {markers.map((marker) => (
        <i
          key={marker.point}
          className={marker.kind === 'set' ? styles.setMarker : styles.gameMarker}
          style={{ left: `calc(8px + (100% - 16px) * ${marker.fraction.toFixed(5)})` }}
        />
      ))}
    </span>
  );
});

type PointListProps = {
  points: readonly DmoReplayPointEntry[];
  currentIndex: number;
  players: readonly [string, string];
  onSelect: (point: DmoReplayPointEntry) => void;
  onClose: () => void;
  /** Positions the panel. */
  className?: string;
  statistics?: readonly DmoReplayPlayerStatistics[];
  highlights?: readonly Te4Highlight[];
  captionsEnabled?: boolean;
  onToggleCaptions?: () => void;
  onSelectHighlight?: (highlight: Te4Highlight) => void;
  onReplayCurrentPoint?: () => void;
};

/**
 * Every point of the replay, grouped by game. Re-renders only when the point
 * being played changes, not on every frame.
 */
export const DmoReplayPointList = memo(function DmoReplayPointList({
  points,
  currentIndex,
  players,
  onSelect,
  onClose,
  className,
  statistics = [],
  highlights = [],
  captionsEnabled = true,
  onToggleCaptions,
  onSelectHighlight,
  onReplayCurrentPoint,
}: PointListProps) {
  const listRef = useRef<HTMLOListElement>(null);
  const userScrolledAt = useRef(0);
  const firstScroll = useRef(true);
  const [tab, setTab] = useState<'points' | 'insights'>('points');

  useEffect(() => {
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!list || !row) return;
    // Don't pull the list away from someone browsing it.
    if (!firstScroll.current && performance.now() - userScrolledAt.current < 4000) return;
    const top = row.offsetTop;
    const visible = top >= list.scrollTop && top + row.offsetHeight <= list.scrollTop + list.clientHeight;
    if (firstScroll.current || !visible) {
      list.scrollTop = Math.max(0, top - list.clientHeight / 2 + row.offsetHeight / 2);
    }
    firstScroll.current = false;
  }, [currentIndex, tab]);

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose]);

  return (
    <aside className={className ? `${styles.panel} ${className}` : styles.panel} aria-label="Points in this match">
      <header className={styles.panelHeader}>
        <strong>Replay details</strong>
        <div className={styles.tabs} role="tablist" aria-label="Replay details">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'points'}
            className={tab === 'points' ? styles.activeTab : undefined}
            onClick={() => setTab('points')}
          >
            Points <small>{points.length}</small>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'insights'}
            className={tab === 'insights' ? styles.activeTab : undefined}
            onClick={() => setTab('insights')}
          >
            Stats
          </button>
        </div>
        <button type="button" className={styles.close} aria-label="Close the point list" onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      {tab === 'points' ? (
        <ol
          ref={listRef}
          className={styles.list}
          role="tabpanel"
          onScroll={() => { userScrolledAt.current = performance.now(); }}
        >
          {points.map((point, position) => {
            const previous = points[position - 1];
            const newGame = !previous || previous.endsGame || previous.set !== point.set;
            const { winner, how } = describeDmoReplayPoint(point, players);
            return (
              <Fragment key={point.index}>
                {newGame && (
                  <li className={styles.gameHeading} aria-hidden="true">
                    <span>Set {point.set}</span>
                    <b>{point.tiebreak ? 'Tie-break' : point.games.replace('-', '–')}</b>
                    <small>{players[point.server - 1]} serving</small>
                  </li>
                )}
                <li>
                  <button
                    type="button"
                    className={styles.point}
                    aria-current={position === currentIndex ? 'true' : undefined}
                    onClick={() => onSelect(point)}
                  >
                    <span className={styles.score}>{point.score.replace('-', '–') || '—'}</span>
                    <span className={styles.summary}>
                      <strong data-player={point.winner ?? undefined}>{winner}</strong>
                      <span>{how}</span>
                    </span>
                    {point.endsMatch ? (
                      <em className={styles.tagMatch}>Match</em>
                    ) : point.endsSet ? (
                      <em className={styles.tagSet}>Set</em>
                    ) : point.isBreak ? (
                      <em className={styles.tagBreak}>Break</em>
                    ) : null}
                  </button>
                </li>
              </Fragment>
            );
          })}
        </ol>
      ) : (
        <div className={styles.insights} role="tabpanel">
          <div className={styles.captionControl}>
            <span>Point captions</span>
            <button type="button" aria-pressed={captionsEnabled} onClick={onToggleCaptions}>
              {captionsEnabled ? 'On' : 'Off'}
            </button>
          </div>
          <button
            type="button"
            className={styles.replayCurrent}
            onClick={onReplayCurrentPoint}
            disabled={currentIndex < 0}
          >
            <RotateCcw size={14} aria-hidden="true" />
            Replay current point
          </button>
          <div className={styles.statsWrap}>
            <table className={styles.statsTable}>
              <thead>
                <tr>
                  <th scope="col">Match stats</th>
                  <th scope="col" title={players[0]}>{players[0]}</th>
                  <th scope="col" title={players[1]}>{players[1]}</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Points won', (stat: DmoReplayPlayerStatistics) => String(stat.pointsWon)],
                  ['Service points', (stat: DmoReplayPlayerStatistics) => `${stat.servicePointsWon}/${stat.servicePoints}`],
                  ['Aces', (stat: DmoReplayPlayerStatistics) => String(stat.aces)],
                  ['Double faults', (stat: DmoReplayPlayerStatistics) => String(stat.doubleFaults)],
                  ['Winners', (stat: DmoReplayPlayerStatistics) => String(stat.winners)],
                  ['Errors', (stat: DmoReplayPlayerStatistics) => String(stat.errors)],
                  ['Break points converted', (stat: DmoReplayPlayerStatistics, opponent: DmoReplayPlayerStatistics) =>
                    `${stat.breakPointsConverted}/${opponent.breakPointsFaced}`],
                  ['Break points saved', (stat: DmoReplayPlayerStatistics) =>
                    `${stat.breakPointsSaved}/${stat.breakPointsFaced}`],
                ].map(([label, format]) => {
                  const formatValue = format as (
                    stat: DmoReplayPlayerStatistics,
                    opponent: DmoReplayPlayerStatistics,
                  ) => string;
                  const first = statistics[0];
                  const second = statistics[1];
                  return (
                    <tr key={label as string}>
                      <th scope="row">{label as string}</th>
                      <td>{first ? formatValue(first, second ?? first) : '—'}</td>
                      <td>{second ? formatValue(second, first ?? second) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {highlights.length > 0 && (
            <section className={styles.highlights} aria-label="Key moments from this match">
              <h3>Key moments</h3>
              <ul>
                {highlights.map((highlight) => (
                  <li key={`${highlight.point}-${highlight.frame}`}>
                    <button type="button" onClick={() => onSelectHighlight?.(highlight)}>
                      <strong>{highlight.rewatch || `Point ${highlight.point}`}</strong>
                      <span>
                        Set {highlight.set} · {highlight.games} · {highlight.reasons}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <a className={styles.sharedInsightsLink} href="/coaching-hub#coach-insights">
            See shared WTSL insights
          </a>
          <p className={styles.insightNote}>
            Shared insights summarize multiple verified WTSL matches; they are not tied to a point in this replay.
          </p>
        </div>
      )}
      <p className={styles.shortcuts}>
        <kbd>Space</kbd> play · <kbd>←</kbd><kbd>→</kbd> 5 s · <kbd>J</kbd><kbd>L</kbd> 10 s ·
        {' '}<kbd>P</kbd><kbd>N</kbd> point · <kbd>&lt;</kbd><kbd>&gt;</kbd> speed ·
        {' '}<kbd>F</kbd> full screen · <kbd>M</kbd> sound · <kbd>C</kbd> camera
      </p>
    </aside>
  );
});

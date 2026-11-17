'use client';

import { Fragment, memo, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import {
  describeDmoReplayPoint,
  type DmoReplayPointEntry,
  type DmoReplaySeekMarker,
} from '@/lib/dmoReplayNavigation.mjs';
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
}: PointListProps) {
  const listRef = useRef<HTMLOListElement>(null);
  const userScrolledAt = useRef(0);
  const firstScroll = useRef(true);

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
  }, [currentIndex]);

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
        <strong>Points</strong>
        <span>{points.length}</span>
        <button type="button" className={styles.close} aria-label="Close the point list" onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      <ol
        ref={listRef}
        className={styles.list}
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
      <p className={styles.shortcuts}>
        <kbd>Space</kbd> play · <kbd>←</kbd><kbd>→</kbd> 5 s · <kbd>J</kbd><kbd>L</kbd> 10 s ·
        {' '}<kbd>P</kbd><kbd>N</kbd> point · <kbd>&lt;</kbd><kbd>&gt;</kbd> speed ·
        {' '}<kbd>F</kbd> full screen · <kbd>M</kbd> sound · <kbd>C</kbd> camera
      </p>
    </aside>
  );
});

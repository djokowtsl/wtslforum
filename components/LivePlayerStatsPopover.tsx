'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  buildProfileStatLines,
  type ProfileScreenshotStats,
} from '@/lib/profileStatistics';

const FEATURED_METRICS = new Set([
  'First serve %',
  'Avg aces',
  'Avg double faults',
  'Avg 1st serve speed',
  'Avg winners',
  'Breakpoint conversion %',
]);

type Tour = 'TE4' | 'TE4_(F)';
type LoadState = 'idle' | 'loading' | 'loaded' | 'error';

export default function LivePlayerStatsPopover({
  playerId,
  playerName,
  tour,
  rowClassName,
  children,
}: {
  playerId: string | number;
  playerName: string;
  tour: Tour;
  rowClassName: string;
  children: ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [snapshot, setSnapshot] = useState<ProfileScreenshotStats | null>(null);
  const [retryVersion, setRetryVersion] = useState(0);
  const panelId = `live-player-stats-${useId().replace(/:/g, '')}`;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const requestStarted = useRef(false);
  const open = hovered || focused || pinned;
  const tourName = tour === 'TE4_(F)' ? 'WTA' : 'ATP';

  useEffect(() => {
    if (!open || requestStarted.current) return;
    requestStarted.current = true;
    setLoadState('loading');

    const path = `/api/players/${encodeURIComponent(String(playerId))}/screenshot-stats?tour=${encodeURIComponent(tour)}`;
    void fetch(path)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error('Screenshot stats request failed');
        setSnapshot(data.stats ?? null);
        setLoadState('loaded');
      })
      .catch(() => setLoadState('error'));
  }, [open, playerId, tour, retryVersion]);

  useEffect(() => {
    if (!pinned) return;
    const dismissOutside = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setPinned(false);
        setFocused(false);
      }
    };
    document.addEventListener('pointerdown', dismissOutside);
    return () => document.removeEventListener('pointerdown', dismissOutside);
  }, [pinned]);

  const statLines = buildProfileStatLines(snapshot)
    .filter((line) => FEATURED_METRICS.has(line.label));

  return (
    <div
      ref={wrapperRef}
      className="live-score-player-stats"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onBlur={(event) => {
        const nextTarget = event.relatedTarget;
        if (!(nextTarget instanceof Node) || !wrapperRef.current?.contains(nextTarget)) {
          setFocused(false);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          setPinned(false);
          setFocused(false);
          setHovered(false);
          (event.target as HTMLElement).blur?.();
        }
      }}
    >
      <div className={rowClassName}>
        {children}
        <button
          type="button"
          className="live-player-stats-trigger"
          aria-label={`Show screenshot-derived match statistics for ${playerName}`}
          aria-controls={panelId}
          aria-expanded={open}
          onFocus={() => setFocused(true)}
          onClick={() => setPinned((current) => !current)}
        >
          Stats
        </button>
      </div>
      <section
        id={panelId}
        className="live-player-stats-panel"
        aria-label={`${tourName} screenshot-derived match statistics for ${playerName}`}
        hidden={!open}
      >
        <div className="live-player-stats-heading">
          <div>
            <strong>{playerName}</strong>
            <span>{tourName} screenshot sample</span>
          </div>
          {snapshot && (
            <small>{snapshot.screenshots} {snapshot.screenshots === 1 ? 'screenshot' : 'screenshots'}</small>
          )}
        </div>
        {loadState === 'loading' && <p role="status">Loading screenshot stats…</p>}
        {loadState === 'error' && (
          <p role="status">
            Screenshot stats are temporarily unavailable.
            <button
              type="button"
              className="live-player-stats-retry"
              onClick={() => {
                requestStarted.current = false;
                setLoadState('idle');
                setRetryVersion((version) => version + 1);
              }}
            >
              Try again
            </button>
          </p>
        )}
        {loadState === 'loaded' && !snapshot && (
          <p>No eligible screenshot statistics are available for this player yet.</p>
        )}
        {loadState === 'loaded' && snapshot && (
          <>
            <dl className="live-player-stats-grid">
              {statLines.map((line) => (
                <div key={line.label}>
                  <dt>{line.label}</dt>
                  <dd>
                    {line.value}
                    <small>
                      {line.sampleCount === null
                        ? 'No supported samples'
                        : `${line.sampleCount} ${line.sampleCount === 1 ? 'match' : 'matches'}`}
                    </small>
                  </dd>
                </div>
              ))}
            </dl>
            <p className="live-player-stats-note">
              Screenshot sample, not a complete career record.
              <a href={`/players/${encodeURIComponent(String(playerId))}?tour=${encodeURIComponent(tour)}`}>
                View full profile
              </a>
            </p>
          </>
        )}
      </section>
    </div>
  );
}

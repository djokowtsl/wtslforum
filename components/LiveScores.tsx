'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import PlayerAvatar from '@/components/PlayerAvatar';
import FeedUpdatedAt from '@/components/FeedUpdatedAt';
import LivePlayerStatsPopover from '@/components/LivePlayerStatsPopover';
import { formatLivePlayerElos } from '@/lib/liveScoreModel';
import { sameLiveMatch } from '@/lib/liveBroadcast';

type LivePlayer = {
  id: string | number;
  name: string;
  avatarUrl: string | null;
  flagUrl: string | null;
  country: string | null;
  tourElo?: number | null;
};

type LiveMatch = {
  name: string;
  score: string;
  court: string;
  mode: string;
  bestOf: 1 | 3 | 5;
  tour: string | null;
  probability: number | null;
  probabilitySource: 'official' | 'all-results' | 'no-history' | null;
  inGameElo1?: number | null;
  inGameElo2?: number | null;
  players: { first: LivePlayer; second: LivePlayer } | null;
};

export type LiveScoresPayload = { matches: LiveMatch[]; checkedAt: string; updatedAt?: string | null };

export default function LiveScores({
  initialPayload = null,
  initialSource = null,
  signedIn = false,
}: {
  initialPayload?: LiveScoresPayload | null;
  initialSource?: 'snapshot' | 'live' | null;
  signedIn?: boolean;
}) {
  const [payload, setPayload] = useState<LiveScoresPayload | null>(initialPayload);
  const [source, setSource] = useState<'snapshot' | 'live' | null>(initialSource);
  const [failed, setFailed] = useState(false);
  const [broadcasts, setBroadcasts] = useState<Array<{
    id: string;
    status: 'live' | 'ended';
    ownerName: string;
    officialByBroadcaster: boolean;
    likelyOfficial: boolean;
    players: [string, string] | null;
    snapshot: { players?: [string, string] } | null;
  }>>([]);
  const [selectedMatchIndex, setSelectedMatchIndex] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    let loading = false;
    const load = async () => {
      if (loading) return;
      loading = true;
      try {
        const response = await fetch('/api/live-scores', { cache: 'no-store' });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error('Live scores request failed');
        if (active) {
          setPayload({ matches: data.matches, checkedAt: data.checkedAt, updatedAt: data.updatedAt ?? null });
          setSource('live');
          setFailed(false);
        }
      } catch {
        if (active) setFailed(true);
      } finally {
        loading = false;
      }
    };
    void load();
    const timer = window.setInterval(() => { void load(); }, 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    let active = true;
    let loading = false;
    const loadBroadcasts = async () => {
      if (loading || !active) return;
      loading = true;
      try {
        const response = await fetch('/api/live-dmo/current', { cache: 'no-store' });
        if (!response.ok) return;
        const body = await response.json();
        if (active && Array.isArray(body?.broadcasts)) setBroadcasts(body.broadcasts);
      } catch {
        // Keep the page usable if the optional broadcast feed is unavailable.
      } finally {
        loading = false;
      }
    };
    void loadBroadcasts();
    const timer = window.setInterval(() => { void loadBroadcasts(); }, 10_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [signedIn]);

  if (failed && !payload) {
    return <div className="live-score-empty" role="status">Live scores are temporarily unavailable.</div>;
  }
  if (!payload) {
    return <div className="live-score-empty" role="status">Checking the WTSL live servers…</div>;
  }
  if (payload.matches.length === 0) {
    return (
      <div className="live-score-empty" role="status">
        No active WTSL-tagged TE4 matches to display.
        <FeedUpdatedAt updatedAt={payload.updatedAt} as="small" />
      </div>
    );
  }

  const activeMatchIndex = Math.min(selectedMatchIndex, payload.matches.length - 1);
  const scrollToMatch = (index: number) => {
    const track = trackRef.current;
    const target = track?.children.item(index);
    if (!track || !target) return;
    const trackLeft = track.getBoundingClientRect().left;
    const targetLeft = target.getBoundingClientRect().left;
    const behavior: ScrollBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    track.scrollTo({ left: track.scrollLeft + targetLeft - trackLeft, behavior });
  };

  const updateActiveMatch = () => {
    const track = trackRef.current;
    if (!track || track.children.length === 0) return;
    const trackLeft = track.getBoundingClientRect().left;
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    Array.from(track.children).forEach((slide, index) => {
      const distance = Math.abs(slide.getBoundingClientRect().left - trackLeft);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    });
    setSelectedMatchIndex((currentIndex) => currentIndex === nearestIndex ? currentIndex : nearestIndex);
  };

  return (
    <div className="live-score-section">
      <div className="live-score-carousel-heading">
        <div className="live-sub" style={{ marginTop: 0 }}>Live TE4 matches</div>
        {payload.matches.length > 1 && (
          <div className="live-score-carousel-controls">
            <span aria-live="polite" aria-atomic="true">{activeMatchIndex + 1} of {payload.matches.length}</span>
            <button type="button" aria-label="Previous live match" onClick={() => scrollToMatch(activeMatchIndex - 1)} disabled={activeMatchIndex === 0}>‹</button>
            <button type="button" aria-label="Next live match" onClick={() => scrollToMatch(activeMatchIndex + 1)} disabled={activeMatchIndex === payload.matches.length - 1}>›</button>
          </div>
        )}
      </div>
      <div ref={trackRef} className="live-score-track" role="region" aria-label="Live WTSL matches" aria-roledescription="carousel" tabIndex={0} onScroll={updateActiveMatch}>
        {payload.matches.map((match, index) => {
          const splitNames = match.name.split(/\s+vs\s+/i);
          const first = match.players?.first;
          const second = match.players?.second;
          const secondProbability = match.probability === null ? null : 100 - match.probability;
          const firstName = first?.name ?? splitNames[0] ?? match.name;
          const secondName = second?.name ?? splitNames[1] ?? '';
          const relatedBroadcasts = broadcasts.filter((broadcast) => broadcast.status === 'live'
            && sameLiveMatch(
              [firstName, secondName],
              broadcast.snapshot?.players ?? broadcast.players,
            ));
          const statsTour = match.tour === 'TE4' || match.tour === 'TE4_(F)' ? match.tour : null;
          const h2hUrl = first && second && match.tour
            ? `https://www.playwtsl.com/TE4/pages/h2h.php?tour=${encodeURIComponent(match.tour)}&pl_one=${encodeURIComponent(String(first.id))}&pl_two=${encodeURIComponent(String(second.id))}`
            : null;
          const renderPlayer = (
            player: LivePlayer | undefined,
            name: string,
            side: 'first' | 'second',
            inGameElo: number | null | undefined,
          ) => {
            const rowClassName = `live-score-player live-score-player--${side}`;
            const eloText = formatLivePlayerElos(inGameElo, player?.tourElo);
            const rowContent = (
              <>
                <PlayerAvatar src={player?.avatarUrl} flagSrc={player?.flagUrl} flagLabel={player?.country} name={name} size={34} />
                <span className="live-score-player-copy">
                  <strong>{name}</strong>
                  {eloText && <small className="live-score-player-elo">{eloText}</small>}
                </span>
              </>
            );
            if (player && statsTour) {
              return (
                <LivePlayerStatsPopover
                  key={`${statsTour}:${player.id}`}
                  playerId={player.id}
                  playerName={name}
                  tour={statsTour}
                  rowClassName={rowClassName}
                >
                  {rowContent}
                </LivePlayerStatsPopover>
              );
            }
            return <div className={rowClassName}>{rowContent}</div>;
          };
          return (
            <article className="live-score-card" key={`${match.name}-${match.court}-${index}`} role="group" aria-roledescription="slide" aria-label={`Match ${index + 1} of ${payload.matches.length}: ${firstName} vs ${secondName || 'Opponent'}`}>
              <div className="live-score-card-head">
                <span>{match.tour === 'TE4_(F)' ? 'WTA' : match.tour === 'TE4' ? 'ATP' : 'WTSL'}</span>
                <b><i />{source === 'snapshot' ? 'SCORE' : 'LIVE'}</b>
              </div>
              {match.probability !== null && secondProbability !== null && (
                <div
                  className="live-score-probability"
                  role="group"
                  aria-label={"Win probability: " + firstName + " " + match.probability + "%, " + (secondName || 'Opponent') + " " + secondProbability + "%"}
                >
                  <div className="live-score-probability-title">Win probability</div>
                  <div className="live-score-probability-values" aria-hidden="true">
                    <span className="live-score-probability-first-value">{match.probability}%</span>
                    <span className="live-score-probability-second-value">{secondProbability}%</span>
                  </div>
                  <div className="live-score-probability-bar" aria-hidden="true">
                    <span
                      className="live-score-probability-first"
                      style={{ width: String(match.probability) + '%' }}
                    />
                    <span
                      className="live-score-probability-second"
                      style={{ width: String(secondProbability) + '%' }}
                    />
                  </div>
                </div>
              )}
              {renderPlayer(first ?? undefined, firstName, 'first', match.inGameElo1)}
              <div className="live-score-center">
                <span>{match.score || 'Score unavailable'}</span>
                {match.probability === null && <small>Probability unavailable</small>}
              </div>
              {renderPlayer(second ?? undefined, secondName || 'Opponent', 'second', match.inGameElo2)}
              <div className="live-score-meta">
                {match.mode} · Best of {match.bestOf} · {match.court}
                {relatedBroadcasts.map((broadcast) => (
                  <Link
                    className="live-broadcast-match-link"
                    href={`/livestreams?broadcast=${encodeURIComponent(broadcast.id)}#broadcast-${encodeURIComponent(broadcast.id)}`}
                    key={broadcast.id}
                    title={`Watch ${broadcast.ownerName}'s live broadcast${broadcast.officialByBroadcaster ? ' · official match tagged by broadcaster' : broadcast.likelyOfficial ? ' · likely official match' : ''}`}
                    aria-label={`Watch ${broadcast.ownerName}'s live broadcast of ${firstName} vs ${secondName}${broadcast.officialByBroadcaster ? ', official match tagged by broadcaster' : broadcast.likelyOfficial ? ', likely official match' : ''}`}
                  >
                    🎥
                    {(broadcast.officialByBroadcaster || broadcast.likelyOfficial) && (
                      <small className="live-broadcast-match-label">
                        {broadcast.officialByBroadcaster ? 'OFFICIAL' : 'LIKELY OFFICIAL'}
                      </small>
                    )}
                  </Link>
                ))}
              </div>
              {h2hUrl && <a className="live-score-h2h" href={h2hUrl} target="_blank" rel="noreferrer">Official H2H ↗</a>}
            </article>
          );
        })}
      </div>
      <FeedUpdatedAt updatedAt={payload.updatedAt} as="small" className="live-score-updated" />
      {failed && <small className="live-score-updated" role="status">Unable to refresh scores; showing previously loaded scores.</small>}
    </div>
  );
}

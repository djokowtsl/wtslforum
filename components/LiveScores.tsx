'use client';

import { useEffect, useRef, useState } from 'react';
import PlayerAvatar from '@/components/PlayerAvatar';

type LivePlayer = {
  id: string | number;
  name: string;
  avatarUrl: string | null;
  flagUrl: string | null;
  country: string | null;
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
  players: { first: LivePlayer; second: LivePlayer } | null;
};

type Payload = { matches: LiveMatch[]; checkedAt: string };

export default function LiveScores() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [failed, setFailed] = useState(false);
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
          setPayload({ matches: data.matches, checkedAt: data.checkedAt });
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

  if (failed && !payload) {
    return <div className="live-score-empty" role="status">Live scores are temporarily unavailable.</div>;
  }
  if (!payload) {
    return <div className="live-score-empty" role="status">Checking the WTSL live servers…</div>;
  }
  if (payload.matches.length === 0) {
    return (
      <div className="live-score-empty" role="status">
        No active WTSL-tagged TE4 matches right now.
        <small>Checked {new Date(payload.checkedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</small>
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
          const h2hUrl = first && second && match.tour
            ? `https://www.playwtsl.com/TE4/pages/h2h.php?tour=${encodeURIComponent(match.tour)}&pl_one=${encodeURIComponent(String(first.id))}&pl_two=${encodeURIComponent(String(second.id))}`
            : null;
          return (
            <article className="live-score-card" key={`${match.name}-${match.court}-${index}`} role="group" aria-roledescription="slide" aria-label={`Match ${index + 1} of ${payload.matches.length}: ${firstName} vs ${secondName || 'Opponent'}`}>
              <div className="live-score-card-head">
                <span>{match.tour === 'TE4_(F)' ? 'WTA' : match.tour === 'TE4' ? 'ATP' : 'WTSL'}</span>
                <b><i />LIVE</b>
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
              <div className="live-score-player live-score-player--first">
                <PlayerAvatar src={first?.avatarUrl} flagSrc={first?.flagUrl} flagLabel={first?.country} name={firstName} size={34} />
                <strong>{firstName}</strong>
              </div>
              <div className="live-score-center">
                <span>{match.score || 'Score unavailable'}</span>
                {match.probability === null && <small>Probability unavailable</small>}
              </div>
              <div className="live-score-player live-score-player--second">
                <PlayerAvatar src={second?.avatarUrl} flagSrc={second?.flagUrl} flagLabel={second?.country} name={secondName} size={34} />
                <strong>{secondName || 'Opponent'}</strong>
              </div>
              <div className="live-score-meta">{match.mode} · Best of {match.bestOf} · {match.court}</div>
              {h2hUrl && <a className="live-score-h2h" href={h2hUrl} target="_blank" rel="noreferrer">Official H2H ↗</a>}
            </article>
          );
        })}
      </div>
      <small className="live-score-updated">Updated {new Date(payload.checkedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</small>
    </div>
  );
}

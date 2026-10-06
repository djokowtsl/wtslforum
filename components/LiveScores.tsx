'use client';

import { useEffect, useState } from 'react';
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

  return (
    <div className="live-score-section">
      <div className="live-sub" style={{ marginTop: 0 }}>Live TE4 matches</div>
      <div className="live-score-grid">
        {payload.matches.map((match, index) => {
          const splitNames = match.name.split(/\s+vs\s+/i);
          const first = match.players?.first;
          const second = match.players?.second;
          const firstName = first?.name ?? splitNames[0] ?? match.name;
          const secondName = second?.name ?? splitNames[1] ?? '';
          const h2hUrl = first && second && match.tour
            ? `https://www.playwtsl.com/TE4/pages/h2h.php?tour=${encodeURIComponent(match.tour)}&pl_one=${encodeURIComponent(String(first.id))}&pl_two=${encodeURIComponent(String(second.id))}`
            : null;
          return (
            <article className="live-score-card" key={`${match.name}-${match.court}-${index}`}>
              <div className="live-score-card-head">
                <span>{match.tour === 'TE4_(F)' ? 'WTA' : match.tour === 'TE4' ? 'ATP' : 'WTSL'}</span>
                <b><i />LIVE</b>
              </div>
              <div className="live-score-player">
                <PlayerAvatar src={first?.avatarUrl} flagSrc={first?.flagUrl} flagLabel={first?.country} name={firstName} size={34} />
                <strong>{firstName}</strong>
                {match.probability !== null && <b>{match.probability}%</b>}
              </div>
              <div className="live-score-center">
                <span>{match.score || 'Score unavailable'}</span>
                {match.probability !== null
                  ? <small>
                    {match.probabilitySource === 'all-results'
                      ? 'Historical H2H estimate'
                      : match.probabilitySource === 'no-history'
                        ? 'No H2H · neutral estimate'
                        : 'WTSL win probability'}
                  </small>
                  : <small>Probability unavailable</small>}
              </div>
              <div className="live-score-player">
                <PlayerAvatar src={second?.avatarUrl} flagSrc={second?.flagUrl} flagLabel={second?.country} name={secondName} size={34} />
                <strong>{secondName || 'Opponent'}</strong>
                {match.probability !== null && <b>{100 - match.probability}%</b>}
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

'use client';

import { useEffect, useRef, useState } from 'react';
import type { BracketMatch } from '@/lib/challongeBracketData';
import styles from './TournamentBracket.module.css';

type MatchDetailsPayload = {
  firstName: string;
  secondName: string;
  playerIds?: { first: string | null; second: string | null };
  headToHead: { first: number; second: number; matches: number };
  meetings: Array<{
    tournament: string | null;
    round: string | null;
    score: string | null;
    winnerName: string | null;
    playedAt: string | null;
  }>;
  playerStats: Array<{
    player_id: string;
    matches: number;
    wins: number;
    losses: number;
    aces: number;
    winners: number;
    break_points_won: number;
    first_serve_pct: number;
  }>;
  result: { score: string; winnerName: string | null; stats: unknown } | null;
  odds: { first: number; second: number } | null;
};

function statEntries(value: unknown): Array<[string, string]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>)
    .filter(([, metric]) => (typeof metric === 'number' && Number.isFinite(metric))
      || (typeof metric === 'string' && metric.trim() !== '' && Number.isFinite(Number(metric))))
    .map(([label, metric]) => [
      label.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' '),
      String(metric),
    ]);
}

function matchStatSections(value: unknown): Array<{ title: string; entries: Array<[string, string]> }> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const entries = Object.entries(value as Record<string, unknown>);
  const nested = entries
    .filter(([, sideStats]) => Boolean(sideStats) && typeof sideStats === 'object' && !Array.isArray(sideStats))
    .map(([side, sideStats]) => ({ title: side, entries: statEntries(sideStats) }))
    .filter((section) => section.entries.length > 0);
  if (nested.length) return nested;
  const flat = statEntries(value);
  return flat.length ? [{ title: 'Match', entries: flat }] : [];
}

function dateLabel(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function TournamentMatchDetails({
  tournamentKey,
  match,
  onClose,
}: {
  tournamentKey: string;
  match: BracketMatch | null;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [details, setDetails] = useState<MatchDetailsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!match) return;
    const controller = new AbortController();
    const query = new URLSearchParams({
      first: match.team1,
      second: match.team2,
      round: match.roundName,
    });
    setDetails(null);
    setLoading(true);
    setError(false);
    fetch(`/api/tournaments/${encodeURIComponent(tournamentKey)}/match-details?${query}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Match details request failed.');
        return response.json() as Promise<MatchDetailsPayload>;
      })
      .then(setDetails)
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [match, tournamentKey]);

  useEffect(() => {
    if (match && dialogRef.current && !dialogRef.current.open) dialogRef.current.showModal();
  }, [match]);

  return (
    <dialog
      className={styles.matchDialog}
      ref={dialogRef}
      aria-labelledby="tournament-match-details-title"
      onClose={onClose}
    >
      {match && (
        <div className={styles.matchDialogLayout}>
          <header className={styles.matchDialogHeader}>
            <div>
              <span className={styles.eyebrow}>{match.roundName || 'MATCH DETAILS'}</span>
              <h2 id="tournament-match-details-title">{match.team1} <span>vs</span> {match.team2}</h2>
              {(match.officialScore || details?.result?.score) && <p>{match.officialScore || details?.result?.score}</p>}
            </div>
            <button type="button" className={styles.closeButton} onClick={() => dialogRef.current?.close()}>
              Close
            </button>
          </header>
          <div className={styles.matchDialogBody}>
            {loading && <p className={styles.status} role="status">Loading match details…</p>}
            {error && <p className={styles.status} role="alert">Match details are temporarily unavailable.</p>}
            {details && (
              <>
                <section className={styles.detailSection}>
                  <h3>Head to head</h3>
                  {details.headToHead.matches > 0 ? (
                    <>
                      <p className={styles.h2hScore}>
                        {details.firstName} <strong>{details.headToHead.first}–{details.headToHead.second}</strong> {details.secondName}
                      </p>
                      <div className={styles.meetingList}>
                        {details.meetings.map((meeting, index) => (
                          <div key={`${meeting.playedAt ?? ''}-${index}`}>
                            <span>{[meeting.tournament, meeting.round, dateLabel(meeting.playedAt)].filter(Boolean).join(' · ') || 'Previous meeting'}</span>
                            <strong>{meeting.score || 'Result unavailable'}{meeting.winnerName ? ` · ${meeting.winnerName} won` : ''}</strong>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className={styles.muted}>No shared match history is recorded in the Forum yet.</p>
                  )}
                </section>

                <section className={styles.detailSection}>
                  <h3>Player stats</h3>
                  {details.playerStats.length > 0 ? (
                    <div className={styles.playerStatGrid}>
                      {[
                        { id: details.playerIds?.first, name: details.firstName },
                        { id: details.playerIds?.second, name: details.secondName },
                      ].map((player) => {
                        const stats = details.playerStats.find((item) => item.player_id === player.id);
                        return (
                          <div className={styles.playerStatCard} key={player.id ?? player.name}>
                            <strong>{player.name}</strong>
                            {stats ? (
                              <dl>
                                <div><dt>Matches</dt><dd>{stats.matches}</dd></div>
                                <div><dt>Wins</dt><dd>{stats.wins}–{stats.losses}</dd></div>
                                <div><dt>Aces</dt><dd>{stats.aces}</dd></div>
                                <div><dt>Winners</dt><dd>{stats.winners}</dd></div>
                                <div><dt>Break points won</dt><dd>{stats.break_points_won}%</dd></div>
                                <div><dt>First serve</dt><dd>{stats.first_serve_pct}%</dd></div>
                              </dl>
                            ) : <p className={styles.muted}>Player stats are not available.</p>}
                          </div>
                        );
                      })}
                    </div>
                  ) : <p className={styles.muted}>Player stats are not available.</p>}
                  {details.result && matchStatSections(details.result.stats).length > 0 && (
                    <div className={styles.matchStats}>
                      <h4>Recorded match stats</h4>
                      {matchStatSections(details.result.stats).map(({ title, entries }) => (
                        <div key={title}>
                          <strong>{title === 'player1' ? details.firstName : title === 'player2' ? details.secondName : title}</strong>
                          <ul>{entries.map(([label, value]) => <li key={label}><span>{label}</span><b>{value}</b></li>)}</ul>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section className={styles.detailSection}>
                  <h3>Odds</h3>
                  {details.odds ? (
                    <div className={styles.oddsRows}>
                      <p><span>{details.firstName}</span><strong>{details.odds.first.toFixed(2)}</strong></p>
                      <p><span>{details.secondName}</span><strong>{details.odds.second.toFixed(2)}</strong></p>
                    </div>
                  ) : (
                    <p className={styles.muted}>No current WTSL odds are available for this matchup.</p>
                  )}
                </section>
              </>
            )}
          </div>
        </div>
      )}
    </dialog>
  );
}

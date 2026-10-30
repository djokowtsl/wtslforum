'use client';

import { useCallback, useEffect, useState } from 'react';
import Te4DmoReplayPlayer from './Te4DmoReplayPlayer';
import type { PublicDmoReplay } from '@/lib/dmoReplayLibrary';
import styles from './DmoReplayLibrary.module.css';

type ReplayPage = {
  matches: PublicDmoReplay[];
  nextCursor: string | null;
};

function formatDate(value: string) {
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(parsed);
}

export default function DmoReplayLibrary({ initialMatchId = '' }: { initialMatchId?: string }) {
  const [matches, setMatches] = useState<PublicDmoReplay[]>([]);
  const [selected, setSelected] = useState<PublicDmoReplay | null>(null);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  const loadPage = useCallback(async (search: string, nextCursor?: string | null) => {
    const params = new URLSearchParams();
    if (search) params.set('q', search);
    if (nextCursor) params.set('cursor', nextCursor);
    const response = await fetch(`/api/dmo-replays?${params.toString()}`, { cache: 'no-store' });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'Match replays could not be loaded.');
    return body as ReplayPage;
  }, []);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError('');
      void loadPage(query).then((page) => {
        if (!active) return;
        setMatches(page.matches);
        setCursor(page.nextCursor);
        setHasMore(Boolean(page.nextCursor));
        setLoading(false);
      }).catch((cause) => {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : 'Match replays could not be loaded.');
        setLoading(false);
      });
    }, query ? 200 : 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query, loadPage]);

  useEffect(() => {
    if (!initialMatchId) return;
    let active = true;
    void fetch(`/api/dmo-replays/${encodeURIComponent(initialMatchId)}`, { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error('');
        return body as PublicDmoReplay;
      })
      .then((match) => {
        if (active) setSelected(match);
      })
      .catch(() => {
        if (active) setSelected(null);
      });
    return () => {
      active = false;
    };
  }, [initialMatchId]);

  const selectMatch = (match: PublicDmoReplay) => {
    setSelected(match);
    const url = new URL(window.location.href);
    url.searchParams.set('match', match.id);
    window.history.pushState({}, '', url);
  };

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await loadPage(query, cursor);
      setMatches((current) => [...current, ...page.matches]);
      setCursor(page.nextCursor);
      setHasMore(Boolean(page.nextCursor));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'More match replays could not be loaded.');
    } finally {
      setLoadingMore(false);
    }
  };

  const replayUrl = selected ? `/api/dmo-replays/${encodeURIComponent(selected.id)}/replay` : '';

  return (
    <section className={styles.library} aria-label="Submitted match replays">
      <div className={styles.listPanel}>
        <div className={styles.listHeading}>
          <div>
            <span className={styles.eyebrow}>Shared match recordings</span>
            <h2>Match replays</h2>
          </div>
          <span className={styles.count}>{error ? '!' : `${matches.length}${hasMore ? '+' : ''}`}</span>
        </div>
        <label className={styles.searchLabel} htmlFor="replay-search">Find a match</label>
        <input
          id="replay-search"
          className={styles.search}
          type="search"
          placeholder="Search players, tournament or round"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {error && <p className={styles.error} role="alert">{error}</p>}
        <div className={styles.matches} aria-live="polite">
          {loading ? (
            <p className={styles.empty} role="status">Loading match replays…</p>
          ) : matches.length ? (
            matches.map((match) => (
              <button
                className={`${styles.match}${selected?.id === match.id ? ` ${styles.active}` : ''}`}
                key={match.id}
                type="button"
                aria-pressed={selected?.id === match.id}
                onClick={() => selectMatch(match)}
              >
                <span className={styles.matchPlayers}>{match.player1} <i>vs</i> {match.player2}</span>
                <span className={styles.matchMeta}>{match.tournament} · {match.roundName}</span>
                <span className={styles.matchDate}>{formatDate(match.submissionDate)}</span>
              </button>
            ))
          ) : error ? null : (
            <p className={styles.empty}>{query ? 'No replays match that search.' : 'No submitted match replays are available yet.'}</p>
          )}
        </div>
        {hasMore && (
          <button className={styles.more} type="button" onClick={loadMore} disabled={loadingMore || loading}>
            {loadingMore ? 'Loading…' : 'Load more matches'}
          </button>
        )}
      </div>

      <div className={styles.viewerPanel}>
        {selected ? (
          <>
            <div className={styles.viewerHeading}>
              <span className={styles.eyebrow}>{selected.tournament} · {selected.roundName}</span>
              <h1>{selected.player1} <i>vs</i> {selected.player2}</h1>
              <p>{formatDate(selected.submissionDate)} <span aria-hidden="true">·</span> Submitted match replay</p>
            </div>
            <Te4DmoReplayPlayer
              replayUrl={replayUrl}
              initialSpeed={1}
              handedness={['right', 'right']}
            />
          </>
        ) : (
          <div className={styles.viewerEmpty}>
            <span className={styles.playIcon} aria-hidden="true">▶</span>
            <h2>Choose a match to rewatch</h2>
            <p>Browse recordings submitted to the Forum and Discord, then replay the full match with the same court and playback controls.</p>
          </div>
        )}
      </div>
    </section>
  );
}

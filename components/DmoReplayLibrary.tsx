'use client';

import { useCallback, useEffect, useState } from 'react';
import Te4DmoReplayPlayer from './Te4DmoReplayPlayer';
import type { DmoReplayCatalogEntry } from '@/lib/dmoReplayLibrary';
import { characterBroadcastSetup } from '@/lib/liveCharacterBackhand.mjs';
import {
  buildDmoReplayCharacterSetupIndex,
  dmoReplayCharacterNames,
  normalizeDmoReplayCharacterName,
  resolveDmoReplayCharacterPresentation,
} from '@/lib/dmoReplayCharacterStyles';
import { dmoReplayIsWta } from '@/lib/dmoReplayTour';
import {
  buildTe4CoachAnalysisUrl,
  buildTe4CoachEmbedUrl,
  buildTe4CoachScorecardEmbedUrl,
} from '@/lib/te4CoachEmbed';
import styles from './DmoReplayLibrary.module.css';

type ReplayPage = {
  matches: DmoReplayCatalogEntry[];
  nextCursor: string | null;
};

type CharacterStyleResult = {
  key: string;
  setups: ReturnType<typeof buildDmoReplayCharacterSetupIndex>;
  status: 'loading' | 'ready' | 'unavailable';
};

function formatDate(value: string) {
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(parsed);
}

export default function DmoReplayLibrary({
  initialMatchId = '',
  initialPage = null,
  publicOnly = false,
}: {
  initialMatchId?: string;
  initialPage?: ReplayPage | null;
  publicOnly?: boolean;
}) {
  const [matches, setMatches] = useState<DmoReplayCatalogEntry[]>(initialPage?.matches ?? []);
  const [selected, setSelected] = useState<DmoReplayCatalogEntry | null>(null);
  const [viewerMode, setViewerMode] = useState<'forum' | 'coach' | 'scorecard'>('forum');
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState<string | null>(initialPage?.nextCursor ?? null);
  const [hasMore, setHasMore] = useState(Boolean(initialPage?.nextCursor));
  const [loading, setLoading] = useState(!initialPage);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const characterNames = dmoReplayCharacterNames(
    [selected?.player1 ?? '', selected?.player2 ?? ''],
    [selected?.player1Character, selected?.player2Character],
  );
  const hasSelectedCharacters = Boolean(
    !publicOnly
    && selected?.hasDmoFile
    && characterNames.some((name) => Boolean(name?.trim()))
    && (
      !selected?.player1Handedness
      || !selected?.player2Handedness
      || !selected?.player1BackhandType
      || !selected?.player2BackhandType
    ),
  );
  const characterKey = characterNames
    .map((name) => name ? normalizeDmoReplayCharacterName(name) : '')
    .join('|');
  const [characterStyleResult, setCharacterStyleResult] = useState<CharacterStyleResult | null>(null);

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
    if (initialPage && !query) {
      setMatches(initialPage.matches);
      setCursor(initialPage.nextCursor);
      setHasMore(Boolean(initialPage.nextCursor));
      setError('');
      setLoading(false);
      return;
    }
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
  }, [query, loadPage, initialPage]);

  useEffect(() => {
    if (!hasSelectedCharacters) {
      setCharacterStyleResult(null);
      return;
    }
    const controller = new AbortController();
    let active = true;
    const names = [...new Set(characterNames
      .filter((name): name is string => Boolean(name?.trim()))
      .map((name) => name.trim()))];
    setCharacterStyleResult({
      key: characterKey,
      setups: new Map(),
      status: 'loading',
    });

    void (async () => {
      let setups = new Map<string, ReturnType<typeof characterBroadcastSetup>>();
      try {
        const response = await fetch('/api/character-stats?tour=all&include_profile=false', {
          cache: 'no-store',
          signal: controller.signal,
        });
        const body = await response.json().catch(() => null);
        if (response.ok) setups = buildDmoReplayCharacterSetupIndex(body?.character_filter_metadata);
      } catch {
        if (controller.signal.aborted) return;
      }

      const missingProfiles = names.filter((name) => {
        const setup = setups.get(normalizeDmoReplayCharacterName(name));
        return !setup?.playingHand || !setup.backhandType;
      });
      const fetchedProfiles = await Promise.all(missingProfiles.map(async (name) => {
        const params = new URLSearchParams({ tour: 'all', character: name });
        try {
          const response = await fetch(`/api/character-stats?${params.toString()}`, {
            cache: 'no-store',
            signal: controller.signal,
          });
          const body = await response.json().catch(() => null);
          return response.ok
            ? [normalizeDmoReplayCharacterName(name), characterBroadcastSetup(body?.profile)] as const
            : null;
        } catch {
          return null;
        }
      }));
      for (const entry of fetchedProfiles) {
        if (entry && (entry[1].playingHand || entry[1].backhandType)) setups.set(entry[0], entry[1]);
      }
      if (!active) return;
      const resolved = names.every((name) => Boolean(
        setups.get(normalizeDmoReplayCharacterName(name))?.backhandType,
      ));
      setCharacterStyleResult({
        key: characterKey,
        setups,
        status: resolved ? 'ready' : 'unavailable',
      });
    })().catch(() => {
      if (!active) return;
      setCharacterStyleResult({
        key: characterKey,
        setups: new Map(),
        status: 'unavailable',
      });
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, [
    characterKey,
    hasSelectedCharacters,
    selected?.player1Character,
    selected?.player2Character,
  ]);

  useEffect(() => {
    if (!initialMatchId) return;
    let active = true;
    void fetch(`/api/dmo-replays/${encodeURIComponent(initialMatchId)}`, { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error('');
        return body as DmoReplayCatalogEntry;
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

  const selectMatch = (match: DmoReplayCatalogEntry) => {
    setSelected(match);
    setViewerMode('forum');
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
  const coachEmbedUrl = selected?.coachShareUrl
    ? buildTe4CoachEmbedUrl(selected.coachShareUrl)
    : null;
  const coachAnalysisUrl = selected?.coachShareUrl
    ? buildTe4CoachAnalysisUrl(selected.coachShareUrl)
    : null;
  const coachScorecardEmbedUrl = selected?.coachShareUrl
    ? buildTe4CoachScorecardEmbedUrl(selected.coachShareUrl)
    : null;
  const activeCharacterStyleResult = characterStyleResult?.key === characterKey
    ? characterStyleResult
    : null;
  const characterStyleLoading = hasSelectedCharacters
    && (!activeCharacterStyleResult || activeCharacterStyleResult.status === 'loading');
  const characterPresentation = selected
    ? resolveDmoReplayCharacterPresentation(
        [selected.player1, selected.player2],
        characterNames,
        activeCharacterStyleResult?.setups ?? new Map(),
        {
          handedness: [selected.player1Handedness, selected.player2Handedness],
          backhandTypes: [selected.player1BackhandType, selected.player2BackhandType],
        },
      )
    : null;
  return (
    <section className={`${styles.library} replay-library`} aria-label="Submitted match replays">
      <div className={`${styles.listPanel} replay-library-panel`}>
        <div className={styles.listHeading}>
          <div>
            <span className={styles.eyebrow}>
              {publicOnly ? 'Publicly approved replays' : 'All current submissions'}
            </span>
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
                <span className={styles.matchBadges}>
                  {match.hasDmoFile && <span className={`${styles.matchBadge} replay-library-badge`}>DMO replay</span>}
                  {match.externalUrl && <span className={`${styles.matchBadge} replay-library-badge`}>Recording link</span>}
                  {!match.hasDmoFile && !match.externalUrl && (
                    <span className={`${styles.matchBadge} replay-library-badge`}>Submission details</span>
                  )}
                </span>
              </button>
            ))
          ) : error ? null : (
            <p className={styles.empty}>
              {query
                ? 'No submissions match that search.'
                : publicOnly
                  ? 'No DMO replays have been published publicly yet.'
                  : 'No current DMO submissions are available yet.'}
            </p>
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
              <p>{formatDate(selected.submissionDate)} <span aria-hidden="true">·</span> Match submission</p>
            </div>
            {selected.externalUrl && (
              <p className={styles.recordingLinkRow}>
                <a href={selected.externalUrl} target="_blank" rel="noopener noreferrer">
                  Open submitted recording
                </a>
              </p>
            )}
            {coachEmbedUrl && (
              <div className={styles.playerOptions} role="tablist" aria-label="Replay player">
                <button
                  className={`${styles.playerTab}${viewerMode === 'forum' ? ` ${styles.playerTabActive}` : ''}`}
                  type="button"
                  role="tab"
                  aria-selected={viewerMode === 'forum'}
                  aria-controls="selected-replay-player"
                  onClick={() => setViewerMode('forum')}
                >
                  Forum player
                </button>
                <button
                  className={`${styles.playerTab}${viewerMode === 'coach' ? ` ${styles.playerTabActive}` : ''}`}
                  type="button"
                  role="tab"
                  aria-selected={viewerMode === 'coach'}
                  aria-controls="selected-replay-player"
                  onClick={() => setViewerMode('coach')}
                >
                  TE4 Coach player
                </button>
                {coachScorecardEmbedUrl && (
                  <button
                    className={`${styles.playerTab}${viewerMode === 'scorecard' ? ` ${styles.playerTabActive}` : ''}`}
                    type="button"
                    role="tab"
                    aria-selected={viewerMode === 'scorecard'}
                    aria-controls="selected-replay-player"
                    onClick={() => setViewerMode('scorecard')}
                  >
                    Coach scorecard
                  </button>
                )}
                {coachAnalysisUrl && (
                  <a className={styles.coachAnalysisLink} href={coachAnalysisUrl} target="_blank" rel="noopener noreferrer">
                    Full Coach analysis
                  </a>
                )}
              </div>
            )}
            <div id="selected-replay-player" className={styles.playerPanel} role="tabpanel" tabIndex={0}>
              {viewerMode === 'scorecard' && coachScorecardEmbedUrl ? (
                <>
                  <iframe
                    className={styles.coachEmbed}
                    src={coachScorecardEmbedUrl}
                    title={`TE4 Coach scorecard: ${selected.player1} vs ${selected.player2}`}
                    loading="lazy"
                    referrerPolicy="strict-origin-when-cross-origin"
                  />
                  <p className={styles.scorecardNote}>
                    Coach notes that some serve-speed, net-point and forced/unforced-error figures
                    can differ slightly from the game screen. Click the scorecard to reveal it.
                  </p>
                </>
              ) : viewerMode === 'coach' && coachEmbedUrl ? (
                <iframe
                  className={styles.coachEmbed}
                  src={coachEmbedUrl}
                  title={`TE4 Coach replay: ${selected.player1} vs ${selected.player2}`}
                  allow="fullscreen"
                  loading="lazy"
                  referrerPolicy="strict-origin-when-cross-origin"
                />
              ) : selected.hasDmoFile ? (
                characterStyleLoading ? (
                  <div className={styles.characterStyleLoading} role="status">Preparing replay…</div>
                ) : (
                  <Te4DmoReplayPlayer
                    replayUrl={replayUrl}
                    initialSpeed={1}
                    isWta={dmoReplayIsWta(selected.tournament)}
                    handedness={characterPresentation?.handedness ?? ['right', 'right']}
                    strokeStyles={characterPresentation?.strokeStyles}
                  />
                )
              ) : (
                <div className={`${styles.viewerEmpty} replay-library-empty`}>
                  <span className={styles.playIcon} aria-hidden="true">{selected.externalUrl ? '↗' : '•'}</span>
                  <h2>{selected.externalUrl ? 'External recording' : 'No playable recording'}</h2>
                  <p>
                    {selected.externalUrl
                      ? 'This submission uses a recording link rather than an uploaded DMO file.'
                      : 'This submission is listed, but no playable DMO file or recording link is available.'}
                  </p>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className={`${styles.viewerEmpty} replay-library-empty`}>
            <span className={styles.playIcon} aria-hidden="true">▶</span>
            <h2>{publicOnly ? 'Choose a public match to rewatch' : 'Choose a match to rewatch'}</h2>
            <p>
              {publicOnly
                ? 'Browse approved public replays from the Forum and Discord, then watch the full match with the same court and playback controls.'
                : 'Browse recordings submitted to the Forum and Discord, then replay the full match with the same court and playback controls.'}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

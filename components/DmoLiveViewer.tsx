'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Eye, Radio } from 'lucide-react';
import { LIVE_DMO_UPDATE_INTERVAL_MS } from '@/lib/te4DmoLive';
import type { Te4LivePoint, Te4LiveSnapshot } from '@/lib/te4DmoLive';
import {
  liveBroadcastMediaMode,
  type LivePreMatchProbability,
  type LiveStream,
} from '@/lib/liveBroadcast';
import type { LiveBroadcastScore } from '@/lib/liveBroadcastScore';
import DmoLiveDisplay from './DmoLiveDisplay';
import { resolveLiveDmoUmpireScoreSource } from '@/lib/liveDmoUmpireScoreSource';
import LiveBroadcastChat from './LiveBroadcastComments';
import LiveStreamEmbed from './LiveStreamEmbed';
import Te4DmoReplayPlayer from './Te4DmoReplayPlayer';
import VoiceRoom from './VoiceRoom';
import { voiceRoomForBroadcast } from '@/lib/voiceRoomToken';
import styles from './DmoLiveViewer.module.css';

type Props = { canWatch: boolean; voiceServer?: string };

type Broadcast = {
  id: string;
  status: 'live' | 'ended';
  ownerName: string;
  character?: string | null;
  snapshot: Te4LiveSnapshot | null;
  stream: LiveStream | null;
  players: [string, string] | null;
  broadcastMode: 'manual' | 'auto';
  isWta: boolean;
  tournamentRound?: string;
  canManageTour: boolean;
  replay: boolean;
  replayDataReady: boolean;
  replaySpeed: 1 | 2 | 4;
  officialByBroadcaster: boolean;
  officialByTournament: boolean;
  likelyOfficial: boolean;
  updatedAt: string;
  stale: boolean;
  liveScore?: LiveBroadcastScore | null;
  viewerCount?: number | null;
  viewers?: Array<{ displayName: string; avatarUrl: string | null }>;
};

type PointLogState = {
  points: Te4LivePoint[];
  loaded: boolean;
};

function mergePointLog(existing: Te4LivePoint[], incoming: Te4LivePoint[]) {
  const pointsByNumber = new Map(existing.map((point) => [point.number, point]));
  let changed = false;
  for (const point of incoming) {
    const previous = pointsByNumber.get(point.number);
    if (
      !previous
      || previous.scoreLabel !== point.scoreLabel
      || previous.server !== point.server
      || previous.winner !== point.winner
      || previous.rallyHits !== point.rallyHits
      || previous.faults !== point.faults
    ) changed = true;
    pointsByNumber.set(point.number, point);
  }
  if (!changed && pointsByNumber.size === existing.length) return existing;
  return [...pointsByNumber.values()].sort((first, second) => first.number - second.number);
}

export default function DmoLiveViewer({ canWatch, voiceServer = '' }: Props) {
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [pointLogs, setPointLogs] = useState<Record<string, PointLogState>>({});
  const [preMatchPredictions, setPreMatchPredictions] = useState<Record<string, LivePreMatchProbability | null>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tourSaveError, setTourSaveError] = useState('');
  const [tourSaveErrorId, setTourSaveErrorId] = useState<string | null>(null);
  const [savingTourId, setSavingTourId] = useState<string | null>(null);
  const [focusedBroadcastId, setFocusedBroadcastId] = useState<string | null>(null);
  const focusedOnce = useRef<string | null>(null);
  const preMatchResolved = useRef(new Set<string>());
  const preMatchAttempts = useRef(new Map<string, number>());
  const pointLogLoading = useRef(new Set<string>());
  const pointLogLoaded = useRef(new Set<string>());
  const pointLogRetryAt = useRef(new Map<string, number>());
  const hasActiveDmo = broadcasts.some((broadcast) => broadcast.status === 'live' && Boolean(broadcast.snapshot));

  const updateBroadcastTour = async (broadcastId: string, tour: 'ATP' | 'WTA') => {
    setSavingTourId(broadcastId);
    setTourSaveError('');
    setTourSaveErrorId(null);
    try {
      const response = await fetch(`/api/live-dmo/${encodeURIComponent(broadcastId)}/tour`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tour }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(typeof body?.error === 'string' ? body.error : 'The match tour could not be saved.');
      }
      const isWta = body?.isWta === true;
      setBroadcasts((current) => current.map((broadcast) =>
        broadcast.id === broadcastId ? { ...broadcast, isWta } : broadcast,
      ));
    } catch (cause) {
      setTourSaveError(cause instanceof Error ? cause.message : 'The match tour could not be saved.');
      setTourSaveErrorId(broadcastId);
    } finally {
      setSavingTourId(null);
    }
  };

  useEffect(() => {
    if (!canWatch) {
      setLoading(false);
      return;
    }
    let active = true;
    let running = false;
    const params = new URLSearchParams(window.location.search);
    const hashId = window.location.hash.startsWith('#broadcast-')
      ? decodeURIComponent(window.location.hash.slice('#broadcast-'.length))
      : null;
    setFocusedBroadcastId(params.get('broadcast') ?? hashId);
    const refresh = async () => {
      if (running || !active) return;
      running = true;
      try {
        const response = await fetch('/api/live-dmo/current', { cache: 'no-store' });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : `Live feed unavailable (${response.status}).`);
        if (!active) return;
        const nextBroadcasts = Array.isArray(body?.broadcasts) ? body.broadcasts as Broadcast[] : [];
        setBroadcasts((current) => {
          const currentById = new Map(current.map((broadcast) => [broadcast.id, broadcast]));
          return nextBroadcasts.map((broadcast) => {
            const previousSnapshot = currentById.get(broadcast.id)?.snapshot;
            const nextSnapshot = broadcast.snapshot;
            if (
              previousSnapshot
              && nextSnapshot
              && previousSnapshot.filename === nextSnapshot.filename
              && previousSnapshot.version === nextSnapshot.version
              && previousSnapshot.frameCount === nextSnapshot.frameCount
              && previousSnapshot.pointCount === nextSnapshot.pointCount
              && previousSnapshot.bestOf === nextSnapshot.bestOf
              && previousSnapshot.players[0] === nextSnapshot.players[0]
              && previousSnapshot.players[1] === nextSnapshot.players[1]
              && previousSnapshot.stadium === nextSnapshot.stadium
            ) {
              return {
                ...broadcast,
                snapshot: previousSnapshot,
                viewerCount: currentById.get(broadcast.id)?.viewerCount,
                viewers: currentById.get(broadcast.id)?.viewers,
              };
            }
            const previous = currentById.get(broadcast.id);
            return {
              ...broadcast,
              viewerCount: previous?.viewerCount,
              viewers: previous?.viewers,
            };
          });
        });
        setPointLogs((current) => {
          const next: Record<string, PointLogState> = {};
          for (const broadcast of nextBroadcasts) {
            if (!broadcast.snapshot) continue;
            const previous = current[broadcast.id] ?? { points: [], loaded: false };
            const points = mergePointLog(previous.points, broadcast.snapshot.recentPoints);
            next[broadcast.id] = {
              ...previous,
              points,
            };
          }
          return next;
        });
        for (const broadcast of nextBroadcasts) {
          if (
            broadcast.snapshot
            && !pointLogLoaded.current.has(broadcast.id)
            && !pointLogLoading.current.has(broadcast.id)
            && Date.now() >= (pointLogRetryAt.current.get(broadcast.id) ?? 0)
          ) {
            pointLogLoading.current.add(broadcast.id);
            void fetch(`/api/live-dmo/${encodeURIComponent(broadcast.id)}/points`, { cache: 'no-store' })
              .then(async (pointResponse) => {
                const pointBody = await pointResponse.json().catch(() => null);
                if (!pointResponse.ok || !Array.isArray(pointBody?.points)) {
                  throw new Error('The full point log is unavailable.');
                }
                if (!active) return;
                const expectedPointCount = broadcast.snapshot?.pointCount ?? 0;
                setPointLogs((current) => {
                  const previous = current[broadcast.id] ?? { points: [], loaded: false };
                  const points = mergePointLog(pointBody.points as Te4LivePoint[], previous.points);
                  return {
                    ...current,
                    [broadcast.id]: {
                      points,
                      loaded: true,
                    },
                  };
                });
                const mergedPointCount = mergePointLog(
                  pointBody.points as Te4LivePoint[],
                  broadcast.snapshot?.recentPoints ?? [],
                ).length;
                if (mergedPointCount >= expectedPointCount) {
                  pointLogLoaded.current.add(broadcast.id);
                  pointLogRetryAt.current.delete(broadcast.id);
                } else {
                  pointLogRetryAt.current.set(broadcast.id, Date.now() + 30_000);
                }
              })
              .catch(() => {
                if (!active) return;
                pointLogRetryAt.current.set(broadcast.id, Date.now() + 30_000);
                setPointLogs((current) => {
                  const previous = current[broadcast.id] ?? { points: [], loaded: false };
                  return {
                    ...current,
                    [broadcast.id]: { ...previous, loaded: true },
                  };
                });
              })
              .finally(() => pointLogLoading.current.delete(broadcast.id));
          }
          if (
            broadcast.status !== 'live'
            || broadcast.replay
            || !broadcast.snapshot
            || !(broadcast.snapshot.players ?? broadcast.players)
            || preMatchResolved.current.has(broadcast.id)
          ) continue;
          const lastAttempt = preMatchAttempts.current.get(broadcast.id) ?? 0;
          if (Date.now() - lastAttempt < 60_000) continue;
          preMatchAttempts.current.set(broadcast.id, Date.now());
          void fetch(`/api/live-dmo/${encodeURIComponent(broadcast.id)}/pre-match`, { cache: 'no-store' })
            .then(async (predictionResponse) => {
              const predictionBody = await predictionResponse.json().catch(() => null);
              if (!predictionResponse.ok) throw new Error('Pre-match estimate unavailable.');
              const value = predictionBody?.prediction;
              const prediction: LivePreMatchProbability | null = value
                && typeof value.probability === 'number'
                && ['official', 'all-results', 'no-history'].includes(value.source)
                && ['TE4', 'TE4_(F)'].includes(value.tour)
                ? value as LivePreMatchProbability
                : null;
              if (!active) return;
              if (prediction) preMatchResolved.current.add(broadcast.id);
              setPreMatchPredictions((current) => ({ ...current, [broadcast.id]: prediction }));
            })
            .catch(() => undefined);
        }
        setError('');
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'The live feed could not be loaded.');
      } finally {
        if (active) setLoading(false);
        running = false;
      }
    };
    void refresh();
    const timer = window.setInterval(
      () => { void refresh(); },
      hasActiveDmo ? LIVE_DMO_UPDATE_INTERVAL_MS : 3000,
    );
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [canWatch, hasActiveDmo]);

  const activeStreamIdsKey = broadcasts
    .filter((broadcast) => broadcast.status === 'live' && !broadcast.replay)
    .map((broadcast) => broadcast.id)
    .join('|');

  useEffect(() => {
    if (!canWatch || !activeStreamIdsKey) return;
    const activeStreamIds = activeStreamIdsKey.split('|');
    let cancelled = false;
    const inFlight = new Set<string>();
    const sendHeartbeat = async () => {
      if (cancelled || document.visibilityState !== 'visible') return;
      await Promise.all(activeStreamIds.map(async (broadcastId) => {
        const card = document.getElementById(`broadcast-${broadcastId}`);
        const bounds = card?.getBoundingClientRect();
        // Count every visible live card, without registering off-screen streams
        // merely because they are present further down the page.
        if (!bounds || bounds.bottom <= 0 || bounds.top >= window.innerHeight || inFlight.has(broadcastId)) return;
        inFlight.add(broadcastId);
        try {
          const response = await fetch('/api/live-dmo/current', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            cache: 'no-store',
            body: JSON.stringify({ broadcastId }),
          });
          const body = await response.json().catch(() => null);
          if (!response.ok || !Number.isInteger(body?.viewerCount) || body.viewerCount < 1) {
            throw new Error('Viewer count unavailable.');
          }
          if (!cancelled) {
            setBroadcasts((current) => current.map((broadcast) =>
              broadcast.id === broadcastId
                ? { ...broadcast, viewerCount: body.viewerCount, viewers: body.viewers }
                : broadcast,
            ));
          }
        } catch {
          if (!cancelled) {
            setBroadcasts((current) => current.map((broadcast) =>
              broadcast.id === broadcastId
                ? { ...broadcast, viewerCount: null, viewers: undefined }
                : broadcast,
            ));
          }
        } finally {
          inFlight.delete(broadcastId);
        }
      }));
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void sendHeartbeat();
    };
    void sendHeartbeat();
    const timer = window.setInterval(() => { void sendHeartbeat(); }, 15_000);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [activeStreamIdsKey, canWatch]);

  useEffect(() => {
    if (!focusedBroadcastId || !broadcasts.length || focusedOnce.current === focusedBroadcastId) return;
    const targetIndex = broadcasts.findIndex((broadcast) => broadcast.id === focusedBroadcastId);
    if (targetIndex < 0) return;
    const timer = window.setTimeout(() => {
      const target = document.getElementById(`broadcast-${focusedBroadcastId}`);
      if (!target) return;
      focusedOnce.current = focusedBroadcastId;
      target.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    }, 50);
    return () => window.clearTimeout(timer);
  }, [focusedBroadcastId, broadcasts]);

  return (
    <section className={styles.page} aria-label="Live Streams">
      <header className={styles.heading}>
        <p className={styles.kicker}>WTSL FORUM / LIVE</p>
        {canWatch ? <h2>Watching <em>now</em></h2> : <h1>Live Streams</h1>}
        <p>Watch video streams and DMO court views together. Each broadcast stays available on this page.</p>
      </header>
      {!canWatch ? (
        <div className={styles.empty}>
          <span className={styles.icon}><Radio size={23} /></span>
          <h3>Sign in to watch live streams</h3>
          <p>Anyone signed in to the Forum can watch live matches and DMO replays.</p>
          <a className="btn btn-discord btn-sm" href="/api/auth/discord">Log in with Discord</a>
        </div>
      ) : (
        <>
      {error && <p className={styles.error} role="alert"><AlertTriangle size={16} />{error}</p>}
      {broadcasts.length ? (
        <div
          className="live-broadcast-list"
          role="list"
          aria-label="Live broadcasts and replays"
        >
          {broadcasts.map((broadcast) => {
            const players = broadcast.snapshot?.players ?? broadcast.players;
            const fullReplayPlayer = broadcast.replay && broadcast.replayDataReady;
            const scoreSource = resolveLiveDmoUmpireScoreSource(
              broadcast.broadcastMode,
              fullReplayPlayer,
            );
            const fallbackScoreSource = resolveLiveDmoUmpireScoreSource(
              broadcast.broadcastMode,
              false,
            );
            const mediaMode = liveBroadcastMediaMode(broadcast.stream, Boolean(broadcast.snapshot));
            const voiceRoom = voiceRoomForBroadcast(broadcast.id);
            return (
              <article
                className="live-broadcast-card"
                id={`broadcast-${broadcast.id}`}
                key={broadcast.id}
                role="listitem"
                aria-label={`${broadcast.replay ? 'Replay' : 'Broadcast'}: ${players?.join(' vs ') ?? broadcast.ownerName}`}
              >
                <div className="live-broadcast-card-heading">
                  <div className={styles.cardStatus}>
                  <span><Radio size={16} />
                    {broadcast.replay
                      ? `REPLAY ${broadcast.replaySpeed}× · ${broadcast.status === 'live' ? 'PLAYING' : 'ENDED'}`
                      : broadcast.status === 'live' ? 'LIVE' : 'ENDED'}
                    {' · '}{broadcast.ownerName}
                  </span>
                  {broadcast.character && (
                    <small className={styles.characterTag}>Playing as {broadcast.character}</small>
                  )}
                  {broadcast.status === 'live' && !broadcast.replay && (
                    <small
                      className={styles.viewerCount}
                      aria-label={broadcast.viewerCount === undefined
                        ? 'Checking the live viewer count'
                        : broadcast.viewerCount === null
                          ? 'Live viewer count temporarily unavailable'
                          : `${broadcast.viewerCount} active ${broadcast.viewerCount === 1 ? 'viewer' : 'viewers'}`}
                      title="Signed-in viewers active in the last 45 seconds"
                    >
                      <Eye size={13} aria-hidden="true" />
                      {broadcast.viewerCount === undefined
                        ? 'Checking…'
                        : broadcast.viewerCount === null
                          ? 'Viewers unavailable'
                          : `${broadcast.viewerCount} watching`}
                    </small>
                  )}
                  {broadcast.status === 'live' && !broadcast.replay && (broadcast.viewers?.length ?? 0) > 0 && (
                    <div className={styles.viewerRoster} aria-label="Signed-in viewers">
                      {broadcast.viewers?.map((viewer, index) => (
                        <span
                          className={styles.viewerIdentity}
                          key={`${viewer.displayName}-${viewer.avatarUrl ?? ''}-${index}`}
                          title={viewer.displayName}
                        >
                          <span className={styles.viewerAvatar} aria-hidden="true">
                            <span>{viewer.displayName.trim().charAt(0).toUpperCase() || '?'}</span>
                            {viewer.avatarUrl && (
                              <img
                                src={viewer.avatarUrl}
                                alt=""
                                loading="lazy"
                                onError={(event) => { event.currentTarget.style.display = 'none'; }}
                              />
                            )}
                          </span>
                          <span>{viewer.displayName}</span>
                        </span>
                      ))}
                    </div>
                  )}
                  </div>
                  {players && <strong>{players[0]} <i>vs</i> {players[1]}</strong>}
                </div>
                <div className={styles.broadcastTags}>
                  <small className={styles.broadcastTag}>{broadcast.isWta ? 'WTA' : 'ATP'}</small>
                  {broadcast.broadcastMode === 'auto' && <small className={styles.broadcastTag}>AUTO · WTSL LIVE</small>}
                  {broadcast.officialByBroadcaster
                    ? <small className={styles.broadcastTag}>OFFICIAL · BROADCASTER TAG</small>
                    : broadcast.officialByTournament
                      ? <small className={styles.broadcastTag}>OFFICIAL · ONGOING TOURNAMENT</small>
                      : broadcast.likelyOfficial && <small className={styles.broadcastTag}>LIKELY OFFICIAL</small>}
                  {broadcast.canManageTour && (
                    <label className={styles.tourControl}>
                      <span>Tour</span>
                      <select
                        aria-label={`Match tour for ${players?.join(' vs ') ?? broadcast.ownerName}`}
                        value={broadcast.isWta ? 'WTA' : 'ATP'}
                        disabled={savingTourId !== null}
                        onChange={(event) => void updateBroadcastTour(
                          broadcast.id,
                          event.currentTarget.value === 'WTA' ? 'WTA' : 'ATP',
                        )}
                      >
                        <option value="ATP">ATP</option>
                        <option value="WTA">WTA</option>
                      </select>
                    </label>
                  )}
                  {tourSaveError && tourSaveErrorId === broadcast.id && (
                    <small className={styles.tourError} role="alert">{tourSaveError}</small>
                  )}
                </div>
                {mediaMode !== 'waiting' ? (
                  <div className={styles.mediaGrid} data-media-mode={mediaMode}>
                  {broadcast.stream && (
                    <div className={styles.mediaPanel}>
                    {mediaMode === 'both' && <h3 className={styles.mediaHeading}>Video stream</h3>}
                    {
                  broadcast.status === 'live' ? (
                    <LiveStreamEmbed stream={broadcast.stream} title={`Live stream by ${broadcast.ownerName}`} />
                  ) : (
                    <p className="live-broadcast-stream-note">
                      This external stream has ended.{' '}
                      <a href={broadcast.stream.sourceUrl} target="_blank" rel="noopener noreferrer">
                        Open original stream ↗
                      </a>
                    </p>
                  )}
                    </div>
                  )}
                  {broadcast.snapshot && (
                    <div className={styles.mediaPanel}>
                    {mediaMode === 'both' && <h3 className={styles.mediaHeading}>DMO court</h3>}
                    {
                  broadcast.replay && broadcast.replayDataReady ? (
                    <Te4DmoReplayPlayer
                      broadcastId={broadcast.id}
                      initialSpeed={broadcast.replaySpeed}
                      isWta={broadcast.isWta}
                      tournamentRound={broadcast.tournamentRound}
                      handedness={broadcast.snapshot.handedness ?? ['right', 'right']}
                      strokeStyles={broadcast.snapshot.strokeStyles}
                      fallback={(
                        <DmoLiveDisplay
                          snapshot={broadcast.snapshot}
                          isWta={broadcast.isWta}
                          tournamentRound={broadcast.tournamentRound}
                          state={broadcast.status}
                          playbackSpeed={broadcast.replaySpeed}
                          liveScore={broadcast.broadcastMode === 'auto' && !broadcast.replay
                            ? broadcast.liveScore ?? null
                            : undefined}
                          stale={broadcast.stale}
                          updatedAt={broadcast.updatedAt}
                          preMatchPrediction={preMatchPredictions[broadcast.id]}
                          pointLog={pointLogs[broadcast.id]?.points}
                          pointLogLoaded={pointLogs[broadcast.id]?.loaded}
                          scoreSource={fallbackScoreSource}
                        />
                      )}
                    />
                  ) : (
                    <DmoLiveDisplay
                      snapshot={broadcast.snapshot}
                      isWta={broadcast.isWta}
                      tournamentRound={broadcast.tournamentRound}
                      state={broadcast.status}
                      playbackSpeed={broadcast.replay ? broadcast.replaySpeed : 1}
                      liveScore={broadcast.broadcastMode === 'auto' && !broadcast.replay
                        ? broadcast.liveScore ?? null
                        : undefined}
                      stale={broadcast.stale}
                      updatedAt={broadcast.updatedAt}
                      preMatchPrediction={preMatchPredictions[broadcast.id]}
                      pointLog={pointLogs[broadcast.id]?.points}
                      pointLogLoaded={pointLogs[broadcast.id]?.loaded}
                      scoreSource={scoreSource}
                    />
                  )}
                    </div>
                  )}
                  </div>
                ) : (
                  <div className={styles.empty}>
                    <span className={styles.icon}><Radio size={23} /></span>
                    <h3>{broadcast.status === 'live' ? 'Waiting for match data' : 'Broadcast ended'}</h3>
                    <p>{broadcast.status === 'live'
                      ? 'The live court view will appear shortly.'
                      : 'This broadcast ended before DMO court data became available.'}</p>
                  </div>
                )}
                {voiceServer && voiceRoom && broadcast.status === 'live' && !broadcast.replay && broadcast.stream && (
                  <VoiceRoom
                    room={voiceRoom}
                    server={voiceServer}
                  />
                )}
                <LiveBroadcastChat broadcastId={broadcast.id} />
              </article>
            );
          })}
        </div>
      ) : (
        <div className={styles.empty}>
          <span className={styles.icon}><Radio size={23} /></span>
          <h3>{loading ? 'Connecting to live broadcasts' : 'No live broadcast right now'}</h3>
          <p>{loading
            ? 'Checking for active streams and DMO courts.'
            : 'Start a broadcast above to share a stream link, a DMO court, or both.'}</p>
        </div>
      )}
        </>
      )}
    </section>
  );
}

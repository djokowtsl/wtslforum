'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Radio } from 'lucide-react';
import { LIVE_DMO_UPDATE_INTERVAL_MS } from '@/lib/te4DmoLive';
import type { Te4LivePoint, Te4LiveSnapshot } from '@/lib/te4DmoLive';
import type { LivePreMatchProbability, LiveStream } from '@/lib/liveBroadcast';
import DmoLiveDisplay from './DmoLiveDisplay';
import LiveBroadcastComments from './LiveBroadcastComments';
import LiveStreamEmbed from './LiveStreamEmbed';
import Te4DmoReplayPlayer from './Te4DmoReplayPlayer';
import styles from './DmoLiveViewer.module.css';

type Props = { canWatch: boolean };

type Broadcast = {
  id: string;
  status: 'live' | 'ended';
  ownerName: string;
  snapshot: Te4LiveSnapshot | null;
  stream: LiveStream | null;
  players: [string, string] | null;
  broadcastMode: 'manual' | 'auto';
  replay: boolean;
  replayDataReady: boolean;
  replaySpeed: 1 | 2 | 4;
  officialByBroadcaster: boolean;
  likelyOfficial: boolean;
  updatedAt: string;
  stale: boolean;
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

export default function DmoLiveViewer({ canWatch }: Props) {
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [pointLogs, setPointLogs] = useState<Record<string, PointLogState>>({});
  const [preMatchPredictions, setPreMatchPredictions] = useState<Record<string, LivePreMatchProbability | null>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [focusedBroadcastId, setFocusedBroadcastId] = useState<string | null>(null);
  const [activeBroadcastIndex, setActiveBroadcastIndex] = useState(0);
  const broadcastTrackRef = useRef<HTMLDivElement>(null);
  const focusedOnce = useRef<string | null>(null);
  const preMatchResolved = useRef(new Set<string>());
  const preMatchAttempts = useRef(new Map<string, number>());
  const pointLogLoading = useRef(new Set<string>());
  const pointLogLoaded = useRef(new Set<string>());
  const pointLogRetryAt = useRef(new Map<string, number>());
  const hasActiveDmo = broadcasts.some((broadcast) => broadcast.status === 'live' && Boolean(broadcast.snapshot));

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
            ) {
              return { ...broadcast, snapshot: previousSnapshot };
            }
            return broadcast;
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

  const scrollToBroadcast = useCallback((index: number) => {
    const track = broadcastTrackRef.current;
    const target = track?.children.item(index);
    if (!track || !target) return;
    const trackLeft = track.getBoundingClientRect().left;
    const targetLeft = target.getBoundingClientRect().left;
    const behavior: ScrollBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    track.scrollTo({ left: track.scrollLeft + targetLeft - trackLeft, behavior });
  }, []);

  const updateActiveBroadcast = () => {
    const track = broadcastTrackRef.current;
    if (!track || !track.children.length) return;
    const trackLeft = track.getBoundingClientRect().left;
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    Array.from(track.children).forEach((slide, index) => {
      const distance = Math.abs(slide.getBoundingClientRect().left - trackLeft);
      if (distance < nearestDistance) {
        nearestIndex = index;
        nearestDistance = distance;
      }
    });
    setActiveBroadcastIndex((current) => current === nearestIndex ? current : nearestIndex);
  };

  useEffect(() => {
    if (!focusedBroadcastId || !broadcasts.length || focusedOnce.current === focusedBroadcastId) return;
    const targetIndex = broadcasts.findIndex((broadcast) => broadcast.id === focusedBroadcastId);
    if (targetIndex < 0) return;
    const timer = window.setTimeout(() => {
      const target = document.getElementById(`broadcast-${focusedBroadcastId}`);
      if (!target) return;
      focusedOnce.current = focusedBroadcastId;
      scrollToBroadcast(targetIndex);
      target.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    }, 50);
    return () => window.clearTimeout(timer);
  }, [focusedBroadcastId, broadcasts, scrollToBroadcast]);

  return (
    <section className={styles.page} aria-label="Live Streams">
      <header className={styles.heading}>
        <p className={styles.kicker}>WTSL FORUM / LIVE</p>
        {canWatch ? <h2>Watching <em>now</em></h2> : <h1>Live Streams</h1>}
        <p>Live matches and replays appear with a court view, video stream, or both.</p>
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
        <div className="live-broadcast-carousel">
          {broadcasts.length > 1 && (
            <div className={styles.carouselControls}>
              <span aria-live="polite" aria-atomic="true">
                Broadcast {Math.min(activeBroadcastIndex + 1, broadcasts.length)} of {broadcasts.length}
              </span>
              <button
                type="button"
                aria-label="Previous broadcast"
                onClick={() => scrollToBroadcast(activeBroadcastIndex - 1)}
                disabled={activeBroadcastIndex === 0}
              >
                <ChevronLeft size={18} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="Next broadcast"
                onClick={() => scrollToBroadcast(activeBroadcastIndex + 1)}
                disabled={activeBroadcastIndex >= broadcasts.length - 1}
              >
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            </div>
          )}
        <div
          className="live-broadcast-list"
          ref={broadcastTrackRef}
          role={broadcasts.length > 1 ? 'region' : undefined}
          aria-label={broadcasts.length > 1 ? 'Live broadcasts and replays' : undefined}
          aria-roledescription={broadcasts.length > 1 ? 'carousel' : undefined}
          tabIndex={broadcasts.length > 1 ? 0 : undefined}
          onScroll={updateActiveBroadcast}
        >
          {broadcasts.map((broadcast) => {
            const players = broadcast.snapshot?.players ?? broadcast.players;
            return (
              <article
                className="live-broadcast-card"
                id={`broadcast-${broadcast.id}`}
                key={broadcast.id}
                role={broadcasts.length > 1 ? 'group' : undefined}
                aria-roledescription={broadcasts.length > 1 ? 'slide' : undefined}
                aria-label={broadcasts.length > 1 ? `${broadcast.replay ? 'Replay' : 'Broadcast'}: ${players?.join(' vs ') ?? broadcast.ownerName}` : undefined}
              >
                <div className="live-broadcast-card-heading">
                  <span><Radio size={16} />
                    {broadcast.replay
                      ? `REPLAY ${broadcast.replaySpeed}× · ${broadcast.status === 'live' ? 'PLAYING' : 'ENDED'}`
                      : broadcast.status === 'live' ? 'LIVE' : 'ENDED'}
                    {' · '}{broadcast.ownerName}
                  </span>
                  {players && <strong>{players[0]} <i>vs</i> {players[1]}</strong>}
                </div>
                {(broadcast.broadcastMode === 'auto' || broadcast.officialByBroadcaster || broadcast.likelyOfficial) && (
                  <div className={styles.broadcastTags}>
                    {broadcast.broadcastMode === 'auto' && <small className={styles.broadcastTag}>AUTO · WTSL LIVE</small>}
                    {broadcast.officialByBroadcaster
                      ? <small className={styles.broadcastTag}>OFFICIAL · BROADCASTER TAG</small>
                      : broadcast.likelyOfficial && <small className={styles.broadcastTag}>LIKELY OFFICIAL</small>}
                  </div>
                )}
                {broadcast.stream && broadcast.status === 'live' && (
                  <LiveStreamEmbed stream={broadcast.stream} title={`Live stream by ${broadcast.ownerName}`} />
                )}
                {broadcast.snapshot ? (
                  broadcast.replay && broadcast.replayDataReady ? (
                    <Te4DmoReplayPlayer
                      broadcastId={broadcast.id}
                      initialSpeed={broadcast.replaySpeed}
                      handedness={broadcast.snapshot.handedness ?? ['right', 'right']}
                      fallback={(
                        <DmoLiveDisplay
                          snapshot={broadcast.snapshot}
                          state={broadcast.status}
                          playbackSpeed={broadcast.replaySpeed}
                          stale={broadcast.stale}
                          updatedAt={broadcast.updatedAt}
                          preMatchPrediction={preMatchPredictions[broadcast.id]}
                          pointLog={pointLogs[broadcast.id]?.points}
                          pointLogLoaded={pointLogs[broadcast.id]?.loaded}
                        />
                      )}
                    />
                  ) : (
                    <DmoLiveDisplay
                      snapshot={broadcast.snapshot}
                      state={broadcast.status}
                      playbackSpeed={broadcast.replay ? broadcast.replaySpeed : 1}
                      stale={broadcast.stale}
                      updatedAt={broadcast.updatedAt}
                      preMatchPrediction={preMatchPredictions[broadcast.id]}
                      pointLog={pointLogs[broadcast.id]?.points}
                      pointLogLoaded={pointLogs[broadcast.id]?.loaded}
                    />
                  )
                ) : broadcast.stream && broadcast.status === 'live' ? (
                  <p className="live-broadcast-stream-note">This broadcast is sharing a video stream without DMO court data.</p>
                ) : (
                  <div className={styles.empty}>
                    <span className={styles.icon}><Radio size={23} /></span>
                    <h3>{broadcast.status === 'live' ? 'Waiting for match data' : 'Broadcast ended'}</h3>
                    <p>{broadcast.status === 'live'
                      ? 'The live court view will appear shortly.'
                      : 'This broadcast ended before DMO court data became available.'}</p>
                  </div>
                )}
                <LiveBroadcastComments broadcastId={broadcast.id} />
              </article>
            );
          })}
        </div>
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

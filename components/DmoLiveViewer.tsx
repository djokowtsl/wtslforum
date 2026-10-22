'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Radio } from 'lucide-react';
import type { Te4LiveSnapshot } from '@/lib/te4DmoLive';
import type { LiveStream } from '@/lib/liveBroadcast';
import DmoLiveDisplay from './DmoLiveDisplay';
import LiveBroadcastComments from './LiveBroadcastComments';
import LiveStreamEmbed from './LiveStreamEmbed';
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
  replaySpeed: 1 | 2 | 4;
  officialByBroadcaster: boolean;
  likelyOfficial: boolean;
  updatedAt: string;
  stale: boolean;
};

export default function DmoLiveViewer({ canWatch }: Props) {
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [focusedBroadcastId, setFocusedBroadcastId] = useState<string | null>(null);
  const focusedOnce = useRef<string | null>(null);

  useEffect(() => {
    if (!canWatch) {
      setLoading(false);
      return;
    }
    let active = true;
    let running = false;
    setFocusedBroadcastId(new URLSearchParams(window.location.search).get('broadcast'));
    const refresh = async () => {
      if (running || !active) return;
      running = true;
      try {
        const response = await fetch('/api/live-dmo/current', { cache: 'no-store' });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : `Live feed unavailable (${response.status}).`);
        if (!active) return;
        setBroadcasts(Array.isArray(body?.broadcasts) ? body.broadcasts : []);
        setError('');
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'The live feed could not be loaded.');
      } finally {
        if (active) setLoading(false);
        running = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 3000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [canWatch]);

  useEffect(() => {
    if (!focusedBroadcastId || !broadcasts.length || focusedOnce.current === focusedBroadcastId) return;
    const timer = window.setTimeout(() => {
      const target = document.getElementById(`broadcast-${focusedBroadcastId}`);
      if (!target) return;
      focusedOnce.current = focusedBroadcastId;
      target.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'start',
      });
    }, 50);
    return () => window.clearTimeout(timer);
  }, [focusedBroadcastId, broadcasts]);

  return (
    <section className={styles.page} aria-label="Live Streams">
      <header className={styles.heading}>
        <p className={styles.kicker}>WTSL FORUM / LIVE</p>
        {canWatch ? <h2>Watching <em>now</em></h2> : <h1>Live Streams</h1>}
        <p>Live matches and DMO replays appear as court reconstructions, embedded streams, or both.</p>
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
        <div className="live-broadcast-list">
          {broadcasts.map((broadcast) => {
            const players = broadcast.snapshot?.players ?? broadcast.players;
            return (
              <article className="live-broadcast-card" id={`broadcast-${broadcast.id}`} key={broadcast.id}>
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
                  <DmoLiveDisplay
                    snapshot={broadcast.snapshot}
                    state={broadcast.status}
                    stale={broadcast.stale}
                    updatedAt={broadcast.updatedAt}
                  />
                ) : broadcast.stream && broadcast.status === 'live' ? (
                  <p className="live-broadcast-stream-note">This broadcast is sharing a video stream without DMO court data.</p>
                ) : (
                  <div className={styles.empty}>
                    <span className={styles.icon}><Radio size={23} /></span>
                    <h3>{broadcast.status === 'live' ? 'Waiting for match data' : 'Broadcast ended'}</h3>
                    <p>{broadcast.status === 'live'
                      ? 'The court appears once TE4 writes enough match frames.'
                      : 'This broadcast ended before DMO court data became available.'}</p>
                  </div>
                )}
                <LiveBroadcastComments broadcastId={broadcast.id} />
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

'use client';

import { useEffect, useState } from 'react';
import styles from './VoiceRoom.module.css';

type VoiceToken = { name: string; exp: number; sig: string };
type Props = { room: string; server: string };

function safeServerOrigin(server: string) {
  try {
    const url = new URL(server);
    const local = ['localhost', '127.0.0.1'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null;
    if (url.username || url.password || (url.pathname !== '/' && url.pathname !== '')) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export default function VoiceRoom({ room, server }: Props) {
  const [src, setSrc] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setSrc('');
    setError('');

    const serverOrigin = safeServerOrigin(server);
    if (!serverOrigin) {
      setError('The voice room is not configured.');
      return () => {
        active = false;
        controller.abort();
      };
    }

    void fetch(`/api/voice-token?room=${encodeURIComponent(room)}`, {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json().catch(() => null) as VoiceToken | null;
        if (!response.ok) {
          if (response.status === 401) throw new Error('Log in to join the voice room.');
          if (response.status === 503) throw new Error('The voice room is not configured yet.');
          throw new Error('The voice room is unavailable.');
        }
        if (!body || typeof body.name !== 'string' || !Number.isSafeInteger(body.exp)
          || typeof body.sig !== 'string' || !/^[a-f0-9]{64}$/i.test(body.sig)) {
          throw new Error('The voice room could not be verified.');
        }
        const url = new URL('/', serverOrigin);
        url.searchParams.set('embed', '1');
        url.searchParams.set('room', room);
        url.searchParams.set('name', body.name);
        url.searchParams.set('exp', String(body.exp));
        url.searchParams.set('sig', body.sig);
        if (active) setSrc(url.toString());
      })
      .catch((cause: unknown) => {
        if (!active || controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : 'The voice room is unavailable.');
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [room, server]);

  return (
    <section className={styles.panel} aria-label="Match voice room">
      <div className={styles.heading}>
        <div>
          <h3>Match voice room</h3>
          <p>Join with your microphone or listen in. Up to eight participants can join.</p>
        </div>
      </div>
      {error ? (
        <p className={styles.message} role="status">{error}</p>
      ) : src ? (
        <iframe
          className={styles.frame}
          src={src}
          title="Match voice room"
          allow="microphone; autoplay"
          referrerPolicy="no-referrer"
        />
      ) : (
        <p className={styles.message} role="status">Loading voice room…</p>
      )}
      <p className={styles.privacy}>
        Audio is peer-to-peer and is not recorded here. Other participants may be able to see your
        network IP address; use headphones to reduce echo.
      </p>
    </section>
  );
}

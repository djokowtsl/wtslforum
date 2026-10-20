'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Radio } from 'lucide-react';
import type { Te4LiveSnapshot } from '@/lib/te4DmoLive';
import DmoLiveDisplay from './DmoLiveDisplay';
import styles from './DmoLiveViewer.module.css';

type Broadcast = {
  id: string;
  status: 'live' | 'ended';
  snapshot: Te4LiveSnapshot | null;
  updatedAt: string;
  stale: boolean;
};

export default function DmoLiveViewer() {
  const [broadcast, setBroadcast] = useState<Broadcast | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    let running = false;
    const refresh = async () => {
      if (running || !active) return;
      running = true;
      try {
        const response = await fetch('/api/live-dmo/current', { cache: 'no-store' });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : `Live feed unavailable (${response.status}).`);
        if (!active) return;
        setBroadcast(body?.broadcast ?? null);
        setError('');
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'The live feed could not be loaded.');
      } finally {
        if (active) setLoading(false);
        running = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 1800);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <main className={styles.page}>
      <header className={styles.heading}>
        <p className={styles.kicker}>WTSL FORUM / TE4</p>
        <h1>Live <em>DMO</em></h1>
        <p>Watch the current match broadcast. Only signed-in Forum members can view this page.</p>
      </header>
      {error && <p className={styles.error} role="alert"><AlertTriangle size={16} />{error}</p>}
      {broadcast?.snapshot ? (
        <DmoLiveDisplay
          snapshot={broadcast.snapshot}
          state={broadcast.status}
          stale={broadcast.stale}
          updatedAt={broadcast.updatedAt}
        />
      ) : (
        <section className={styles.empty}>
          <span className={styles.icon}><Radio size={23} /></span>
          <h2>{loading ? 'Connecting to live feed' : broadcast ? 'Waiting for match data' : 'No live match right now'}</h2>
          <p>{broadcast
            ? 'An admin has started a broadcast. The scoreboard will appear when TE4 writes enough match frames.'
            : 'An admin can start a broadcast from the private DMO tools. This page refreshes automatically.'}</p>
        </section>
      )}
    </main>
  );
}

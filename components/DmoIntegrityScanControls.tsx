'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

type ScanResponse = { scanned?: { id: number; status: string }[]; pending?: number; error?: string };

async function requestScan(body: Record<string, unknown>): Promise<ScanResponse> {
  const response = await fetch('/api/admin/dmo-integrity/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => null)) as ScanResponse | null;
  if (!response.ok) throw new Error(data?.error || 'The scan could not run.');
  return data ?? {};
}

/** Scans every submission without a current result, a batch at a time. */
export function DmoIntegrityScanPending({ pending }: { pending: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(pending);
  const [done, setDone] = useState(0);
  const [error, setError] = useState('');

  async function scanAll() {
    setBusy(true);
    setError('');
    let total = 0;
    try {
      for (let round = 0; round < 100; round += 1) {
        const data = await requestScan({});
        const scanned = data.scanned?.length ?? 0;
        total += scanned;
        setDone(total);
        setLeft(data.pending ?? 0);
        if (!data.pending || scanned === 0) break;
      }
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The scan could not run.');
    } finally {
      setBusy(false);
    }
  }

  if (!left && !busy) {
    return <span className="notice" style={{ padding: '6px 12px' }}>Every submitted match has been scanned.</span>;
  }
  return (
    <div style={{ display: 'grid', gap: 6, justifyItems: 'start' }}>
      <button className="btn btn-sm btn-primary" type="button" onClick={scanAll} disabled={busy}>
        {busy
          ? `Scanning… ${done} done, ${left} left`
          : `Scan ${left} new or outdated match${left === 1 ? '' : 'es'}`}
      </button>
      {error && <p role="alert" className="notice" style={{ margin: 0 }}>{error}</p>}
    </div>
  );
}

/** Rescan one submission (for example after the rubric changes). */
export function DmoIntegrityRescanButton({ id }: { id: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function rescan() {
    setBusy(true);
    setError('');
    try {
      await requestScan({ ids: [id] });
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The scan could not run.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="btn btn-sm btn-ghost" type="button" onClick={rescan} disabled={busy}>
        {busy ? 'Scanning…' : 'Rescan'}
      </button>
      {error && <span role="alert" className="notice" style={{ padding: '4px 10px' }}>{error}</span>}
    </>
  );
}

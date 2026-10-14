'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function DmoDeliveryRetryButton({ id }: { id: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function retry() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/admin/dmo-submissions/${id}/retry`, { method: 'POST' });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'Discord delivery could not be retried.');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Discord delivery could not be retried.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button className="btn btn-sm" type="button" onClick={retry} disabled={busy}>
        {busy ? 'Retrying…' : 'Retry Discord delivery'}
      </button>
      {error && <p role="alert" className="notice" style={{ marginTop: 8 }}>{error}</p>}
    </div>
  );
}

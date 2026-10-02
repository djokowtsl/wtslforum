'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type IdentityOption = { id: string; label: string };

export default function DefaultPlayerIdentityPicker({ options, initialId }: { options: IdentityOption[]; initialId: string }) {
  const [selected, setSelected] = useState(initialId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  async function change(nextId: string) {
    if (!nextId || nextId === selected) return;
    const previous = selected;
    setSelected(nextId);
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/profile/default-player-claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claimId: nextId }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setSelected(previous);
        setError(result.error || 'Could not update your discussion name.');
        return;
      }
      router.refresh();
    } catch {
      setSelected(previous);
      setError('Could not update your discussion name. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className='default-identity-control'>
      <label htmlFor='default-player-claim'>Default name for general discussions</label>
      <select
        id='default-player-claim'
        className='status-picker default-identity-picker'
        value={selected}
        disabled={saving}
        onChange={(event) => void change(event.target.value)}
        aria-busy={saving}
      >
        {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
      {error && <p className='notice' role='alert'>{error}</p>}
    </div>
  );
}

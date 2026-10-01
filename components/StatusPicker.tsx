'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const OPTIONS = [
  { value: 'online', label: '🟢 Online' },
  { value: 'away', label: '🟡 Away' },
  { value: 'busy', label: '🔴 Busy' },
  { value: 'offline', label: '⚪ Appear offline' },
];

/** Lets a member manually set their own presence — there's no automatic detection. */
export default function StatusPicker({ initial }: { initial: string }) {
  const [status, setStatus] = useState(initial);
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  async function change(v: string) {
    setStatus(v);
    setSaving(true);
    try {
      await fetch('/api/profile/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: v }),
      });
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <select value={status} onChange={(e) => change(e.target.value)} disabled={saving} className="status-picker">
      {OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

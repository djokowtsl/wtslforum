'use client';

import { useState } from 'react';

type ShareStatus = 'idle' | 'copied' | 'shared' | 'error';

export default function ShareThreadButton() {
  const [status, setStatus] = useState<ShareStatus>('idle');

  function resetStatus() {
    window.setTimeout(() => setStatus('idle'), 2500);
  }

  async function copyLink() {
    try {
      const url = window.location.href;
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const field = document.createElement('textarea');
        field.value = url;
        field.setAttribute('readonly', '');
        field.style.position = 'fixed';
        field.style.opacity = '0';
        document.body.appendChild(field);
        field.select();
        const copied = document.execCommand('copy');
        field.remove();
        if (!copied) throw new Error('Clipboard copy was unavailable');
      }
      setStatus('copied');
      resetStatus();
    } catch {
      setStatus('error');
      resetStatus();
    }
  }

  async function shareThread() {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: document.title, url: window.location.href });
        setStatus('shared');
        resetStatus();
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }
    await copyLink();
  }

  const label = status === 'copied'
    ? 'Link copied'
    : status === 'shared'
      ? 'Shared'
      : status === 'error'
        ? 'Could not share'
        : 'Share thread';

  return (
    <button type="button" className="btn btn-primary share-thread-button" onClick={shareThread} aria-live="polite">
      {label}
    </button>
  );
}
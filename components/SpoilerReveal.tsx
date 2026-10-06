'use client';

import { useState } from 'react';

export default function SpoilerReveal({ text }: { text: string }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span className={revealed ? 'spoiler-revealed' : 'spoiler-hidden'}>
      {revealed ? text : (
        <button
          type="button"
          className="spoiler-reveal-button"
          aria-label="Reveal spoiler"
          onClick={() => setRevealed(true)}
        >
          Reveal spoiler
        </button>
      )}
    </span>
  );
}
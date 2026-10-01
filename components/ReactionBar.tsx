'use client';
import { useState } from 'react';

const ALLOWED_EMOJI = ['👍', '🔥', '😂', '🎾'];

type Props = {
  topicId?: number;
  replyId?: number;
  initial: { emoji: string; count: number; reacted: boolean }[];
  signedIn: boolean;
};

/** Small like/upvote-style reaction bar shown under a topic's opening post or a reply. Clicking an
 * emoji toggles your own reaction for it (the API is a toggle, not an add-only), with an optimistic
 * local update so it feels instant — the server response still overwrites it with the real counts. */
export default function ReactionBar({ topicId, replyId, initial, signedIn }: Props) {
  const [counts, setCounts] = useState(() => {
    const m = new Map(initial.map((r) => [r.emoji, { count: r.count, reacted: r.reacted }]));
    return ALLOWED_EMOJI.map((emoji) => ({ emoji, count: m.get(emoji)?.count ?? 0, reacted: m.get(emoji)?.reacted ?? false }));
  });
  const [busy, setBusy] = useState<string | null>(null);

  async function toggle(emoji: string) {
    if (!signedIn || busy) return;
    setBusy(emoji);
    // Optimistic flip so the click feels instant instead of waiting on the round trip.
    setCounts((prev) => prev.map((c) => (c.emoji === emoji ? { ...c, count: c.count + (c.reacted ? -1 : 1), reacted: !c.reacted } : c)));
    try {
      const r = await fetch('/api/reactions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ topicId, replyId, emoji }),
      });
      const data = await r.json().catch(() => null);
      if (data?.ok) {
        const serverCounts = new Map((data.counts as { emoji: string; count: number }[]).map((c) => [c.emoji, c.count]));
        setCounts((prev) => prev.map((c) => (c.emoji === emoji ? { ...c, count: serverCounts.get(emoji) ?? 0, reacted: data.reacted } : c)));
      }
    } catch {
      // Network hiccup — leave the optimistic state as-is rather than silently reverting it.
    }
    setBusy(null);
  }

  return (
    <div className="reaction-bar">
      {counts.map((c) => (
        <button
          key={c.emoji}
          type="button"
          className={`reaction-chip${c.reacted ? ' active' : ''}`}
          onClick={() => toggle(c.emoji)}
          disabled={!signedIn || busy === c.emoji}
          title={signedIn ? undefined : 'Log in with Discord to react'}
        >
          <span>{c.emoji}</span>{c.count > 0 && <b>{c.count}</b>}
        </button>
      ))}
    </div>
  );
}

'use client';
import { useState } from 'react';
import ReactionChip from '@/components/ReactionChip';

const ALLOWED_EMOJI = ['👍', '🔥', '😂', '🎾', '❤️'];

type Props = {
  topicId?: number;
  replyId?: number;
  initial: { emoji: string; count: number; reacted: boolean; reactors: string[] }[];
  signedIn: boolean;
};

/** Small like/upvote-style reaction bar shown under a topic's opening post or a reply. Clicking an
 * emoji toggles your own reaction for it (the API is a toggle, not an add-only), with an optimistic
 * local update so it feels instant — the server response still overwrites it with the real counts. */
export default function ReactionBar({ topicId, replyId, initial, signedIn }: Props) {
  const [counts, setCounts] = useState(() => {
    const m = new Map(initial.map((r) => [r.emoji, r]));
    return ALLOWED_EMOJI.map((emoji) => ({
      emoji,
      count: m.get(emoji)?.count ?? 0,
      reacted: m.get(emoji)?.reacted ?? false,
      reactors: m.get(emoji)?.reactors ?? [],
    }));
  });
  const [busy, setBusy] = useState<string | null>(null);

  async function toggle(emoji: string) {
    if (!signedIn || busy) return;
    setBusy(emoji);
    const previous = counts;
    // Optimistic flip so the click feels instant instead of waiting on the round trip.
    setCounts((prev) => prev.map((c) => (c.emoji === emoji ? { ...c, count: c.count + (c.reacted ? -1 : 1), reacted: !c.reacted } : c)));
    try {
      const r = await fetch('/api/reactions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ topicId, replyId, emoji }),
      });
      const data = await r.json().catch(() => null);
      if (r.ok && data?.ok) {
        const serverCounts = new Map((data.counts as { emoji: string; count: number; reacted: boolean; reactors: string[] }[]).map((c) => [c.emoji, c]));
        setCounts((prev) => prev.map((c) => {
          const server = serverCounts.get(c.emoji);
          return {
            ...c,
            count: server?.count ?? 0,
            reacted: server?.reacted ?? false,
            reactors: server?.reactors ?? [],
          };
        }));
      } else {
        setCounts(previous);
      }
    } catch {
      setCounts(previous);
    }
    setBusy(null);
  }

  return (
    <div className="reaction-bar">
      {counts.map((c) => (
        <ReactionChip
          key={c.emoji}
          {...c}
          disabled={!signedIn || !!busy}
          loginRequired={!signedIn}
          updating={busy === c.emoji}
          onToggle={() => toggle(c.emoji)}
        />
      ))}
    </div>
  );
}

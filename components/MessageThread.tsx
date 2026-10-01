'use client';

import { useEffect, useRef, useState } from 'react';

type Message = {
  id: number;
  sender_id: number;
  body: string;
  created_at: string;
};

/** Polling-based DM thread (refreshes every 6s) rather than a real-time socket connection. */
export default function MessageThread({
  currentUserId,
  otherUserId,
  otherName,
  otherAvatar,
  initialMessages,
}: {
  currentUserId: string;
  otherUserId: string;
  otherName: string;
  otherAvatar: string;
  initialMessages: Message[];
}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const res = await fetch(`/api/messages/${otherUserId}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (data?.messages) setMessages(data.messages);
      } catch { /* ignore transient poll failures */ }
    }, 6000);
    return () => clearInterval(id);
  }, [otherUserId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setDraft('');
    try {
      const res = await fetch(`/api/messages/${otherUserId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      const data = await res.json();
      if (data?.message) setMessages((m) => [...m, data.message]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="message-thread">
      <div className="message-log">
        {messages.length === 0 && <p className="empty-thread">No messages yet — say hi to {otherName}.</p>}
        {messages.map((m) => {
          const mine = Number(m.sender_id) === Number(currentUserId);
          return (
            <div key={m.id} className={`message-bubble-row ${mine ? 'mine' : ''}`}>
              {!mine && <img className="avatar-img" src={otherAvatar} alt="" />}
              <div className="message-bubble">{m.body}</div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
      <form className="message-compose" onSubmit={send}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`Message ${otherName}…`}
          maxLength={4000}
        />
        <button type="submit" className="btn btn-primary" disabled={sending || !draft.trim()}>Send</button>
      </form>
    </div>
  );
}

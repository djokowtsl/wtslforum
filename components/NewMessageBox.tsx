'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type Member = { id: number; display_name: string; avatar_url: string | null; status: string | null };

function avatarSrc(url: string | null, name: string) {
  return url || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=0c1a35&color=b0f43b&bold=true`;
}

/** Lets a member find another member by name and jump straight into a new (or existing)
 * conversation thread — the inbox previously only let you start a DM from someone's post or
 * player profile, with no way to initiate one from the Messages page itself. */
export function NewMessageBox() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Member[]>([]);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) { setResults([]); return; }
    setLoading(true);
    const t = setTimeout(() => {
      fetch(`/api/members/search?q=${encodeURIComponent(query)}`)
        .then((r) => r.json())
        .then((d) => setResults(d.members || []))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="new-message-box" ref={boxRef}>
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search a member by name to start a conversation…"
        aria-label="Search members"
      />
      {loading && <div className="new-message-hint">Searching…</div>}
      {!loading && q.trim().length >= 2 && results.length === 0 && <div className="new-message-hint">No members found.</div>}
      {results.length > 0 && (
        <div className="new-message-results">
          {results.map((m) => (
            <button key={m.id} type="button" className="new-message-result" onClick={() => router.push(`/messages/${m.id}`)}>
              <img className="avatar-img" src={avatarSrc(m.avatar_url, m.display_name)} alt="" />
              <span>{m.display_name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

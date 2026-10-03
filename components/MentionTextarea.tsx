'use client';
import { useEffect, useRef, useState } from 'react';

type Member = { id: number; username: string; display_name: string; avatar_url: string | null };

type Props = {
  name: string;
  rows?: number;
  required?: boolean;
  maxLength?: number;
  placeholder?: string;
  defaultValue?: string;
  enableSpoilers?: boolean;
};

/** A plain <textarea> (so forms still submit it via FormData under `name` exactly like before)
 * that additionally watches for "@word" being typed and pops up a small list of verified members
 * to tag — picking one inserts "@username" so `RichText` can later linkify it. Only verified
 * players are offered here (see /api/mentions/search), matching "tag other verified users". */
export default function MentionTextarea({ name, rows = 6, required, maxLength, placeholder, defaultValue = '', enableSpoilers = false }: Props) {
  const [value, setValue] = useState(defaultValue);
  const [query, setQuery] = useState<string | null>(null);
  const [results, setResults] = useState<Member[]>([]);
  const [active, setActive] = useState(0);
  const [spoilerError, setSpoilerError] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);
  const triggerStart = useRef<number | null>(null);

  useEffect(() => {
    if (query === null) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/mentions/search?q=${encodeURIComponent(query)}`);
        const data = await r.json().catch(() => null);
        if (!cancelled && data?.ok) setResults(data.members);
      } catch {
        // Ignore — autocomplete just stays empty if the lookup fails.
      }
    }, 150);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query]);

  function onChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const v = e.target.value;
    setValue(v);
    const caret = e.target.selectionStart ?? v.length;
    const upToCaret = v.slice(0, caret);
    const m = /(?:^|\s)@(\w*)$/.exec(upToCaret);
    if (m) {
      triggerStart.current = caret - m[1].length - 1;
      setQuery(m[1]);
      setActive(0);
    } else {
      setQuery(null);
      triggerStart.current = null;
    }
  }

  function pick(member: Member) {
    const ta = taRef.current;
    if (!ta || triggerStart.current == null) return;
    const caret = ta.selectionStart ?? value.length;
    const before = value.slice(0, triggerStart.current);
    const after = value.slice(caret);
    const next = `${before}@${member.username} ${after}`;
    setValue(next);
    setQuery(null);
    triggerStart.current = null;
    requestAnimationFrame(() => {
      const pos = before.length + member.username.length + 2;
      ta.focus();
      ta.setSelectionRange(pos, pos);
    });
  }

  function markSpoiler() {
    const textarea = taRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart ?? value.length;
    const end = textarea.selectionEnd ?? start;
    const selected = value.slice(start, end);
    if (selected.includes('\n')) {
      setSpoilerError('Select text on one line at a time.');
      return;
    }
    setSpoilerError('');
    const marker = selected ? `||${selected}||` : '||||';
    const next = value.slice(0, start) + marker + value.slice(end);
    setValue(next);
    requestAnimationFrame(() => {
      const caret = selected ? start + marker.length : start + 2;
      textarea.focus();
      textarea.setSelectionRange(caret, caret);
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (query === null || !results.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % results.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + results.length) % results.length); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(results[active]); }
    else if (e.key === 'Escape') { setQuery(null); }
  }

  return (
    <div className="mention-wrap" style={{ position: 'relative' }}>
      <textarea
        ref={taRef}
        name={name}
        rows={rows}
        required={required}
        maxLength={maxLength}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setQuery(null), 150)}
      />
      {enableSpoilers && (
        <div className="spoiler-toolbar">
          <button className="btn btn-sm btn-ghost" type="button" onClick={markSpoiler}>Mark selected text as spoiler</button>
          <small>Readers reveal marked passages.</small>
          {spoilerError && <small className="spoiler-error" role="alert">{spoilerError}</small>}
        </div>
      )}
      {query !== null && results.length > 0 && (
        <div className="mention-pop" style={{ bottom: '100%', left: 0 }}>
          {results.map((m, i) => (
            <button type="button" key={m.id} className={i === active ? 'active' : ''} onMouseDown={(e) => { e.preventDefault(); pick(m); }}>
              {m.avatar_url && <img src={m.avatar_url} alt="" />}
              <span>{m.display_name} <small style={{ opacity: 0.6 }}>@{m.username}</small></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

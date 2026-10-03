import React from 'react';
import SpoilerReveal from './SpoilerReveal';

// Tiny, safe renderer: paragraphs, **bold**, [label](https://…), bare URLs and @mentions. No raw
// HTML is ever injected.
const TOKEN = /(\|\|[^|\n]+?\|\|)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\(https?:\/\/[^)\s]+\))|(https?:\/\/[^\s<]+)|(@\w+)/g;

export type Mentionable = { playerId: number | string; tour: string };

function inline(line: string, keyBase: string, mentionables?: Record<string, Mentionable>) {
  const out: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of line.matchAll(TOKEN)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(line.slice(last, idx));
    const tok = m[0];
    const key = `${keyBase}-${i++}`;
    if (tok.startsWith('||')) out.push(<SpoilerReveal key={key} text={tok.slice(2, -2)} />);
    else if (tok.startsWith('**')) out.push(<strong key={key}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('[')) {
      const [, label, url] = /^\[([^\]]+)\]\((.+)\)$/.exec(tok) ?? [];
      out.push(<a key={key} href={url} target="_blank" rel="noopener noreferrer nofollow ugc">{label}</a>);
    } else if (tok.startsWith('@')) {
      // Only linkify mentions that resolve to a real verified member passed in from the page —
      // anything else (a stray "@" in prose) is left as plain text rather than a dead link.
      const target = mentionables?.[tok.slice(1).toLowerCase()];
      if (target) out.push(<a key={key} className="mention" href={`/players/${target.playerId}?tour=${target.tour}`}>{tok}</a>);
      else out.push(tok);
    } else out.push(<a key={key} href={tok} target="_blank" rel="noopener noreferrer nofollow ugc">{tok}</a>);
    last = idx + tok.length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

export default function RichText({ text, mentionables }: { text: string; mentionables?: Record<string, Mentionable> }) {
  const lines = (text || '').split('\n').map((l) => l.trimEnd());
  return (
    <>
      {lines.map((l, i) => (l.trim() ? <p key={i}>{inline(l, `l${i}`, mentionables)}</p> : null))}
    </>
  );
}

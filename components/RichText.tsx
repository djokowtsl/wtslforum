import React from 'react';

// Tiny, safe renderer: paragraphs, **bold**, [label](https://…) and bare URLs. No raw HTML is ever injected.
const TOKEN = /(\*\*[^*]+\*\*)|(\[[^\]]+\]\(https?:\/\/[^)\s]+\))|(https?:\/\/[^\s<]+)/g;

function inline(line: string, keyBase: string) {
  const out: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of line.matchAll(TOKEN)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(line.slice(last, idx));
    const tok = m[0];
    const key = `${keyBase}-${i++}`;
    if (tok.startsWith('**')) out.push(<strong key={key}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('[')) {
      const [, label, url] = /^\[([^\]]+)\]\((.+)\)$/.exec(tok) ?? [];
      out.push(<a key={key} href={url} target="_blank" rel="noopener noreferrer nofollow ugc">{label}</a>);
    } else out.push(<a key={key} href={tok} target="_blank" rel="noopener noreferrer nofollow ugc">{tok}</a>);
    last = idx + tok.length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

export default function RichText({ text }: { text: string }) {
  const lines = (text || '').split('\n').map((l) => l.trimEnd());
  return (
    <>
      {lines.map((l, i) => (l.trim() ? <p key={i}>{inline(l, `l${i}`)}</p> : null))}
    </>
  );
}

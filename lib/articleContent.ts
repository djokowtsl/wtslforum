/** Structured article content, rendered as safe React nodes, never raw HTML. */
export type ArticleMark = { type: string; attrs?: Record<string, unknown> };
export type ArticleNode = {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: ArticleMark[];
  content?: ArticleNode[];
};
export type ArticleDoc = ArticleNode & { type: 'doc'; content: ArticleNode[] };
export type ArticleContent = { format: 'wtsl-article-v1'; titleDoc: ArticleDoc; bodyDoc: ArticleDoc };

export const emptyArticleDoc = (): ArticleDoc => ({ type: 'doc', content: [{ type: 'paragraph' }] });

export function safeArticleUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

/** Only trusted video providers become iframes; arbitrary video links remain links. */
export function articleVideoSource(value: unknown): { kind: 'embed' | 'file' | 'link'; url: string } | null {
  const safe = safeArticleUrl(value);
  if (!safe) return null;
  const url = new URL(safe);
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (['youtube.com', 'm.youtube.com', 'youtu.be', 'youtube-nocookie.com'].includes(host)) {
    const id = host === 'youtu.be' ? url.pathname.slice(1).split('/')[0]
      : url.searchParams.get('v') || /^\/(?:embed|shorts|live)\/([^/]+)/.exec(url.pathname)?.[1];
    if (id && /^[a-zA-Z0-9_-]{11}$/.test(id)) {
      return { kind: 'embed', url: `https://www.youtube-nocookie.com/embed/${id}` };
    }
  }
  if (['vimeo.com', 'player.vimeo.com'].includes(host)) {
    const id = /^\/(?:video\/)?(\d+)(?:\/|$)/.exec(url.pathname)?.[1];
    if (id) return { kind: 'embed', url: `https://player.vimeo.com/video/${id}` };
  }
  if (/\.(mp4|webm|ogv|ogg)$/i.test(url.pathname)) return { kind: 'file', url: safe };
  return { kind: 'link', url: safe };
}

const NODES = new Set([
  'doc', 'paragraph', 'text', 'heading', 'bulletList', 'orderedList', 'listItem',
  'blockquote', 'codeBlock', 'horizontalRule', 'hardBreak', 'image', 'articleVideo',
]);
const MARKS = new Set(['bold', 'italic', 'strike', 'underline', 'code', 'link']);

export function validateArticleDoc(input: unknown, titleOnly = false): ArticleDoc {
  let count = 0;
  let characters = 0;
  function node(value: unknown, depth: number): ArticleNode {
    if (++count > 5000 || depth > 24 || !value || typeof value !== 'object') throw new Error('Article content is too complex.');
    const v = value as Record<string, unknown>;
    if (typeof v.type !== 'string' || !NODES.has(v.type)) throw new Error('Unsupported article formatting.');
    if (titleOnly && !['doc', 'paragraph', 'text', 'hardBreak'].includes(v.type)) throw new Error('Titles support text formatting, alignment and links only.');
    const out: ArticleNode = { type: v.type };
    if (v.type === 'text') {
      if (typeof v.text !== 'string') throw new Error('Invalid article text.');
      characters += v.text.length;
      if (characters > (titleOnly ? 250 : 100000)) throw new Error(titleOnly ? 'Title is too long (maximum 250 characters).' : 'Article body is too long.');
      out.text = v.text;
    }
    const attrs = v.attrs && typeof v.attrs === 'object' ? v.attrs as Record<string, unknown> : {};
    if (['paragraph', 'heading'].includes(v.type) && ['left', 'center', 'right', 'justify'].includes(String(attrs.textAlign))) {
      out.attrs = { textAlign: attrs.textAlign };
    }
    if (v.type === 'heading') {
      const level = Number(attrs.level);
      if (![1, 2, 3, 4, 5, 6].includes(level)) throw new Error('Invalid heading level.');
      out.attrs = { ...out.attrs, level };
    }
    if (v.type === 'orderedList') out.attrs = { start: Math.max(1, Math.min(10000, Number(attrs.start) || 1)) };
    if (v.type === 'image' || v.type === 'articleVideo') {
      const src = safeArticleUrl(attrs.src);
      if (!src) throw new Error('Images and videos require a valid HTTP or HTTPS URL.');
      out.attrs = { src };
      if (v.type === 'image') {
        out.attrs.alt = typeof attrs.alt === 'string' ? attrs.alt.slice(0, 1000) : '';
        out.attrs.title = typeof attrs.title === 'string' ? attrs.title.slice(0, 1000) : null;
      }
    }
    if (v.marks !== undefined) {
      if (!Array.isArray(v.marks) || v.marks.length > 8) throw new Error('Invalid text formatting.');
      out.marks = v.marks.map((raw: unknown): ArticleMark => {
        if (!raw || typeof raw !== 'object') throw new Error('Invalid text formatting.');
        const mark = raw as Record<string, unknown>;
        if (typeof mark.type !== 'string' || !MARKS.has(mark.type)) throw new Error('Unsupported text formatting.');
        if (mark.type === 'link') {
          const href = safeArticleUrl((mark.attrs as Record<string, unknown> | undefined)?.href);
          if (!href) throw new Error('Links require a valid HTTP or HTTPS URL.');
          return { type: 'link', attrs: { href } };
        }
        return { type: mark.type };
      });
    }
    if (v.content !== undefined) {
      if (!Array.isArray(v.content)) throw new Error('Invalid article structure.');
      out.content = v.content.map(child => node(child, depth + 1));
    }
    if (depth > 0 && v.type === 'doc') throw new Error('Invalid nested document.');
    return out;
  }
  const result = node(input, 0);
  if (result.type !== 'doc' || !Array.isArray(result.content)) throw new Error('Invalid article document.');
  return result as ArticleDoc;
}

export function articlePlainText(doc: ArticleNode): string {
  if (doc.type === 'text') return doc.text || '';
  if (doc.type === 'hardBreak') return '\n';
  const children = (doc.content || []).map(articlePlainText);
  return children.join(['doc', 'bulletList', 'orderedList'].includes(doc.type) ? '\n' : '');
}

export function hasArticleBody(doc: ArticleNode): boolean {
  return Boolean(articlePlainText(doc).trim()) || ['image', 'articleVideo'].includes(doc.type)
    || (doc.content || []).some(hasArticleBody);
}

/** Preserve legacy bold/link formatting when an existing plain-body article is edited. */
export function legacyArticleDoc(text: string): ArticleDoc {
  const content = String(text || '').split(/\n+/).map(line => {
    const children: ArticleNode[] = [];
    const pattern = /(\*\*[^*]+\*\*)|(\[([^\]]+)\]\((https?:\/\/[^)\s]+)\))|(https?:\/\/[^\s<]+)/g;
    let last = 0;
    for (const match of line.matchAll(pattern)) {
      if (match.index! > last) children.push({ type: 'text', text: line.slice(last, match.index) });
      if (match[1]) children.push({ type: 'text', text: match[1].slice(2, -2), marks: [{ type: 'bold' }] });
      else {
        const href = safeArticleUrl(match[4] || match[5]);
        children.push({ type: 'text', text: match[3] || match[5], ...(href ? { marks: [{ type: 'link', attrs: { href } }] } : {}) });
      }
      last = match.index! + match[0].length;
    }
    if (last < line.length) children.push({ type: 'text', text: line.slice(last) });
    return { type: 'paragraph', ...(children.length ? { content: children } : {}) };
  });
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}

export function readArticleContent(body: unknown): ArticleContent | null {
  if (typeof body !== 'string') return null;
  try {
    const data = JSON.parse(body);
    if (data?.format !== 'wtsl-article-v1') return null;
    return { format: 'wtsl-article-v1', titleDoc: validateArticleDoc(data.titleDoc, true), bodyDoc: validateArticleDoc(data.bodyDoc) };
  } catch { return null; }
}

export function validateArticleInput(input: unknown) {
  if (!input || typeof input !== 'object') throw new Error('Invalid article.');
  const b = input as Record<string, unknown>;
  if (b.published !== undefined && typeof b.published !== 'boolean') throw new Error('Invalid publication status.');
  const titleDoc = validateArticleDoc(b.titleDoc ?? legacyArticleDoc(String(b.title || '')), true);
  const bodyDoc = validateArticleDoc(b.bodyDoc ?? legacyArticleDoc(String(b.body || '')));
  const title = articlePlainText(titleDoc).replace(/\s+/g, ' ').trim();
  const published = b.published === true;
  if (published && (!title || !hasArticleBody(bodyDoc))) throw new Error('A title and article content are required before publishing.');
  const excerpt = typeof b.excerpt === 'string' ? b.excerpt.trim() : '';
  if (excerpt.length > 1000) throw new Error('Excerpt is too long (maximum 1,000 characters).');
  const coverUrl = b.coverUrl ? safeArticleUrl(b.coverUrl) : null;
  if (b.coverUrl && !coverUrl) throw new Error('Cover image requires a valid HTTP or HTTPS URL.');
  return {
    title: title || 'Untitled article', excerpt, coverUrl, published,
    body: JSON.stringify({ format: 'wtsl-article-v1', titleDoc, bodyDoc }),
  };
}

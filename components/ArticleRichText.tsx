import React from 'react';
import { articleVideoSource, safeArticleUrl, validateArticleDoc, type ArticleDoc, type ArticleNode } from '@/lib/articleContent';

function renderNode(node: ArticleNode, key: string, title = false): React.ReactNode {
  if (node.type === 'text') {
    let result: React.ReactNode = node.text || '';
    for (const mark of node.marks || []) {
      if (mark.type === 'bold') result = <strong key={`${key}-bold`}>{result}</strong>;
      else if (mark.type === 'italic') result = <em key={`${key}-italic`}>{result}</em>;
      else if (mark.type === 'underline') result = <u key={`${key}-underline`}>{result}</u>;
      else if (mark.type === 'strike') result = <s key={`${key}-strike`}>{result}</s>;
      else if (mark.type === 'code') result = <code key={`${key}-code`}>{result}</code>;
      else if (mark.type === 'link') {
        const href = safeArticleUrl(mark.attrs?.href);
        if (href) result = <a key={`${key}-link`} href={href} target="_blank" rel="noopener noreferrer nofollow ugc">{result}</a>;
      }
    }
    return <React.Fragment key={key}>{result}</React.Fragment>;
  }
  const children = (node.content || []).map((child, index) => renderNode(child, `${key}-${index}`, title));
  const align = ['left', 'center', 'right', 'justify'].includes(String(node.attrs?.textAlign)) ? String(node.attrs?.textAlign) : undefined;
  const aligned = { 'data-align': align };
  switch (node.type) {
    case 'doc': return <React.Fragment key={key}>{children}</React.Fragment>;
    case 'paragraph': return title ? <span className="article-headline-line" key={key} {...aligned}>{children}</span> : <p key={key} {...aligned}>{children}</p>;
    case 'heading': {
      const level = Math.max(1, Math.min(6, Number(node.attrs?.level) || 2));
      const Tag = `h${level}` as keyof React.JSX.IntrinsicElements;
      return <Tag key={key} {...aligned}>{children}</Tag>;
    }
    case 'bulletList': return <ul key={key}>{children}</ul>;
    case 'orderedList': return <ol key={key} start={Math.max(1, Number(node.attrs?.start) || 1)}>{children}</ol>;
    case 'listItem': return <li key={key}>{children}</li>;
    case 'blockquote': return <blockquote key={key}>{children}</blockquote>;
    case 'codeBlock': return <pre key={key}><code>{children}</code></pre>;
    case 'hardBreak': return <br key={key} />;
    case 'horizontalRule': return <hr key={key} />;
    case 'image': {
      const src = safeArticleUrl(node.attrs?.src);
      return src ? <img key={key} src={src} alt={typeof node.attrs?.alt === 'string' ? node.attrs.alt : ''} loading="lazy" /> : null;
    }
    case 'articleVideo': {
      const video = articleVideoSource(node.attrs?.src);
      if (!video) return null;
      if (video.kind === 'embed') return <div key={key} data-article-video><iframe src={video.url} title="Article video" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" /></div>;
      if (video.kind === 'file') return <div key={key} data-article-video><video controls preload="metadata" src={video.url}>Your browser does not support embedded video.</video></div>;
      return <p key={key}><a href={video.url} target="_blank" rel="noopener noreferrer nofollow ugc">Watch the video</a></p>;
    }
    default: return null;
  }
}

export default function ArticleRichText({ doc, className = '', title = false }: { doc: unknown; className?: string; title?: boolean }) {
  let valid: ArticleDoc;
  try { valid = validateArticleDoc(doc, title); } catch { return null; }
  const classNames = `article-rich-text ${className}`.trim();
  return title ? <h1 className={classNames}>{renderNode(valid, 'article', true)}</h1>
    : <div className={classNames}>{renderNode(valid, 'article')}</div>;
}

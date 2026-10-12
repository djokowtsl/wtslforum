'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Eye, EyeOff, ImagePlus, RotateCcw, Save } from 'lucide-react';
import ArticleRichEditor from '@/components/ArticleRichEditor';
import ArticleRichText from '@/components/ArticleRichText';
import {
  articlePlainText, emptyArticleDoc, hasArticleBody, legacyArticleDoc, readArticleContent, type ArticleDoc,
} from '@/lib/articleContent';

type ArticleRecord = {
  id: number | string;
  title: string;
  slug: string;
  excerpt: string;
  body: string;
  cover_url?: string | null;
  published: boolean;
};
type Props = { userId: string; articleId?: number | string | null; onSaved?: (article: { id: number | string; slug: string; published: boolean }) => void; onCancel?: () => void; onDirtyChange?: (dirty: boolean) => void };
type FormSnapshot = { titleDoc: ArticleDoc; bodyDoc: ArticleDoc; excerpt: string; coverUrl: string; published: boolean };
const snapshotKey = (userId: string, id: string | number | null) => `wtsl:article-editor:${encodeURIComponent(userId)}:${id == null ? 'new' : encodeURIComponent(String(id))}`;
function readLocal(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function removeLocal(key: string) {
  try { localStorage.removeItem(key); } catch { /* Optional device recovery must never block server saves. */ }
}

export default function AdminArticleForm({ userId, articleId = null, onSaved, onCancel, onDirtyChange }: Props) {
  const [activeId, setActiveId] = useState<number | string | null>(articleId);
  const [titleDoc, setTitleDoc] = useState<ArticleDoc>(emptyArticleDoc);
  const [bodyDoc, setBodyDoc] = useState<ArticleDoc>(emptyArticleDoc);
  const [excerpt, setExcerpt] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [published, setPublished] = useState(false);
  const [loading, setLoading] = useState(Boolean(articleId));
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [coverUploading, setCoverUploading] = useState(false);
  const [bodyUploading, setBodyUploading] = useState(false);
  const [preview, setPreview] = useState(false);
  const [status, setStatus] = useState<{ kind: 'info' | 'error' | 'success'; text: string }>({ kind: 'info', text: '' });
  const [recovery, setRecovery] = useState<FormSnapshot | null>(null);
  const [dirty, setDirty] = useState(false);
  const coverInput = useRef<HTMLInputElement>(null);
  const activeSnapshotKey = useMemo(() => snapshotKey(userId, activeId), [userId, activeId]);
  const dirtyRef = useRef(dirty);
  const recoveryRef = useRef(recovery);
  const snapshotRef = useRef<FormSnapshot | null>(null);
  const keyRef = useRef(activeSnapshotKey);
  const onDirtyChangeRef = useRef(onDirtyChange);
  const titleText = articlePlainText(titleDoc).replace(/\s+/g, ' ').trim();
  const snapshot: FormSnapshot = { titleDoc, bodyDoc, excerpt, coverUrl, published };
  dirtyRef.current = dirty;
  recoveryRef.current = recovery;
  snapshotRef.current = snapshot;
  keyRef.current = activeSnapshotKey;
  onDirtyChangeRef.current = onDirtyChange;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!articleId) {
        const candidate = readLocal(snapshotKey(userId, null));
        if (candidate) {
          try { setRecovery(JSON.parse(candidate) as FormSnapshot); } catch { removeLocal(snapshotKey(userId, null)); }
        }
        setLoading(false);
        return;
      }
      setLoading(true);
      setLoadError('');
      setStatus({ kind: 'info', text: 'Opening article…' });
      try {
        const response = await fetch(`/api/articles/${articleId}`, { credentials: 'include', cache: 'no-store' });
        const data = await response.json();
        if (!response.ok || !data.article) throw new Error(data.error || 'Could not open this article.');
        if (cancelled) return;
        const article = data.article as ArticleRecord;
        const content = readArticleContent(article.body);
        setTitleDoc(content?.titleDoc || legacyArticleDoc(article.title || ''));
        setBodyDoc(content?.bodyDoc || legacyArticleDoc(article.body || ''));
        setExcerpt(article.excerpt || '');
        setCoverUrl(article.cover_url || '');
        setPublished(Boolean(article.published));
        const candidate = readLocal(snapshotKey(userId, articleId));
        if (candidate) {
          try { setRecovery(JSON.parse(candidate) as FormSnapshot); } catch { removeLocal(snapshotKey(userId, articleId)); }
        }
        setStatus({ kind: 'info', text: article.published ? 'Published article · edits update this article.' : 'Draft · safe to keep shaping.' });
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'Could not open this article.';
          setLoadError(message);
          setStatus({ kind: 'error', text: message });
        }
      } finally { if (!cancelled) setLoading(false); }
    }
    void load();
    return () => { cancelled = true; };
  }, [articleId, userId]);

  useEffect(() => {
    if (loading || recovery || !dirty) return;
    const timer = window.setTimeout(() => {
      try { localStorage.setItem(activeSnapshotKey, JSON.stringify(snapshot)); } catch { /* Storage can be disabled; editing remains available. */ }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [activeSnapshotKey, bodyDoc, coverUrl, dirty, excerpt, loading, published, recovery, titleDoc]);

  useEffect(() => {
    onDirtyChangeRef.current?.(dirty);
  }, [dirty]);

  useEffect(() => () => {
    if (dirtyRef.current && !recoveryRef.current && snapshotRef.current) {
      try { localStorage.setItem(keyRef.current, JSON.stringify(snapshotRef.current)); } catch { /* Storage may be unavailable. */ }
    }
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [dirty]);

  const change = useCallback(<T,>(setter: (next: T) => void, next: T) => {
    setter(next);
    setDirty(true);
    setStatus({ kind: 'info', text: 'Unsaved changes' });
  }, []);

  function restoreLocal() {
    if (!recovery) return;
    setTitleDoc(recovery.titleDoc);
    setBodyDoc(recovery.bodyDoc);
    setExcerpt(recovery.excerpt);
    setCoverUrl(recovery.coverUrl);
    setPublished(Boolean(recovery.published));
    setRecovery(null);
    setDirty(true);
    setStatus({ kind: 'success', text: 'Recovered your unsaved work. Save when ready.' });
  }
  function discardLocal() {
    removeLocal(activeSnapshotKey);
    setRecovery(null);
    setStatus({ kind: 'info', text: 'Recovered copy discarded.' });
  }

  async function uploadCover(file: File) {
    if (file.size > 4 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type)) {
      setStatus({ kind: 'error', text: 'Choose a JPG, PNG, GIF or WebP image up to 4 MB.' });
      return;
    }
    setCoverUploading(true);
    setStatus({ kind: 'info', text: 'Uploading cover…' });
    try {
      const form = new FormData();
      form.set('file', file);
      const response = await fetch('/api/articles/images', { method: 'POST', body: form, credentials: 'include' });
      const result = await response.json();
      if (!response.ok || !result.url) throw new Error(result.error || 'Cover upload failed.');
      setCoverUrl(result.url);
      setDirty(true);
      setStatus({ kind: 'success', text: 'Cover uploaded. Save article to keep it.' });
    } catch (error) { setStatus({ kind: 'error', text: error instanceof Error ? error.message : 'Cover upload failed.' }); }
    finally { setCoverUploading(false); }
  }

  async function save(nextPublished: boolean) {
    if (saving || loading || coverUploading || bodyUploading) return;
    const payload = { titleDoc, bodyDoc, excerpt, coverUrl: coverUrl.trim(), published: nextPublished };
    if (nextPublished && (!titleText || !hasArticleBody(bodyDoc))) {
      setStatus({ kind: 'error', text: 'Add a title and some article text, image or video before publishing.' });
      return;
    }
    setSaving(true);
    setStatus({ kind: 'info', text: activeId ? 'Saving article…' : 'Saving draft…' });
    try {
      const response = await fetch(activeId ? `/api/articles/${activeId}` : '/api/articles', {
        method: activeId ? 'PUT' : 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to save article.');
      const savedId = result.id ?? activeId;
      setActiveId(savedId);
      setPublished(Boolean(result.published ?? nextPublished));
      setDirty(false);
      dirtyRef.current = false;
      removeLocal(activeSnapshotKey);
      setStatus({ kind: 'success', text: result.published ?? nextPublished ? 'Published. This article is now live.' : 'Draft saved. You can return to it any time.' });
      onSaved?.({ id: savedId, slug: result.slug, published: Boolean(result.published ?? nextPublished) });
    } catch (error) {
      setStatus({ kind: 'error', text: error instanceof Error ? error.message : 'Unable to save article. Your work is still here.' });
    } finally { setSaving(false); }
  }

  if (loading) return <div className="article-studio-panel-body" aria-busy="true"><div className="article-skeleton" /><p className="muted">Opening your writing desk…</p></div>;
  if (loadError) return <div className="article-studio-panel-body"><div className="notice warn" role="alert"><strong>Could not open this article.</strong><p>{loadError}</p><p>Your existing article has not been changed.</p></div><div className="article-form-actions"><button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>Try again</button>{onCancel && <button type="button" className="btn btn-ghost" onClick={onCancel}>Close editor</button>}</div></div>;
  return (
    <div className="article-studio-panel-body article-form-stack">
      {recovery && <aside className="notice warn" role="status"><strong>Unsaved work found on this device.</strong><p>It belongs to your staff account and this article only. Restore it or discard the saved copy.</p><div className="article-form-actions"><button type="button" className="btn btn-sm btn-primary" onClick={restoreLocal}><RotateCcw size={15} /> Restore work</button><button type="button" className="btn btn-sm btn-ghost" onClick={discardLocal}>Discard copy</button></div></aside>}
      <label className="article-field"><span>Headline</span><small>Inline formatting, links and alignment · up to 250 characters</small>
        <ArticleRichEditor mode="title" label="Article headline" value={titleDoc} onChange={value => change(setTitleDoc, value)} disabled={saving} />
      </label>
      <label className="article-field"><span>Short introduction</span><small>Optional · helps readers decide what to open</small><textarea maxLength={1000} value={excerpt} onChange={event => change(setExcerpt, event.target.value)} placeholder="The angle, stakes, or detail that makes this story matter…" disabled={saving} /></label>
      <label className="article-field"><span>Article body</span><small>Give the story room to breathe. Media can be added from the toolbar.</small>
        <ArticleRichEditor mode="body" label="Article body" value={bodyDoc} onChange={value => change(setBodyDoc, value)} disabled={saving} onUploadingChange={setBodyUploading} />
      </label>
      <div className="article-field"><span>Cover image</span><small>Upload a visual or use an existing public HTTP(S) image URL.</small>
        <input type="url" value={coverUrl} onChange={event => change(setCoverUrl, event.target.value)} placeholder="https://…" disabled={saving || coverUploading} aria-label="Cover image URL" />
        <div className="article-form-actions">
          <input ref={coverInput} type="file" accept="image/jpeg,image/png,image/gif,image/webp" hidden aria-label="Choose cover image" onChange={event => { const file = event.currentTarget.files?.[0]; if (file) void uploadCover(file); event.currentTarget.value = ''; }} />
          <button type="button" className="btn btn-sm" onClick={() => coverInput.current?.click()} disabled={coverUploading || saving}><ImagePlus size={15} /> {coverUploading ? 'Uploading…' : 'Upload cover'}</button>
          {coverUrl && <button type="button" className="btn btn-sm btn-ghost" onClick={() => change(setCoverUrl, '')} disabled={saving}>Remove cover</button>}
        </div>
        {coverUrl ? <figure className="article-cover-preview"><img src={coverUrl} alt="Cover preview" /><figcaption>Cover preview · shown above the article</figcaption></figure> : <div className="article-cover-placeholder">No cover selected</div>}
      </div>
      {preview && <section className="article-preview" aria-label="Article preview"><span className="eyebrow">Reader preview</span>{coverUrl && <img className="article-preview-cover" src={coverUrl} alt="" />}<ArticleRichText doc={titleDoc} title className="article-public-title" /><ArticleRichText doc={bodyDoc} /></section>}
      <div className="article-form-actions">
        <button type="button" className="btn btn-primary" disabled={saving || coverUploading || bodyUploading} onClick={() => void save(published)}><Save size={15} /> {saving ? 'Saving…' : published ? 'Save changes' : 'Save draft'}</button>
        <button type="button" className="btn" disabled={saving || coverUploading || bodyUploading} onClick={() => void save(!published)}>{published ? 'Move to draft' : 'Publish article'}</button>
        <button type="button" className="btn btn-ghost" onClick={() => setPreview(value => !value)} aria-pressed={preview}>{preview ? <EyeOff size={15} /> : <Eye size={15} />}{preview ? 'Hide preview' : 'Preview'}</button>
        {onCancel && <button type="button" className="btn btn-ghost" disabled={saving} onClick={onCancel}>Close editor</button>}
      </div>
      <div className="article-save-state" data-kind={status.kind} role="status" aria-live="polite">{status.text || (published ? 'Published article' : 'Draft not published')}</div>
    </div>
  );
}

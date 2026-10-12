'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, FilePlus2, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import AdminArticleForm from '@/components/AdminArticleForm';

type ArticleRow = {
  id: number | string;
  title: string;
  slug: string;
  excerpt: string;
  body: string;
  published: boolean;
  created_at: string;
  author?: string | null;
};

export default function AdminArticleManager({ userId }: { userId: string }) {
  const [articles, setArticles] = useState<ArticleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<number | string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ArticleRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [editorDirty, setEditorDirty] = useState(false);

  const loadArticles = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/articles', { credentials: 'include', cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load articles.');
      setArticles(Array.isArray(data.articles) ? data.articles : []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load articles.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void loadArticles(); }, [loadArticles]);

  async function deleteArticle() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setFeedback('');
    try {
      const response = await fetch(`/api/articles/${deleteTarget.id}`, { method: 'DELETE', credentials: 'include' });
      const data = await response.json();
      if (!response.ok || data.deleted !== true) throw new Error(data.error || 'Could not delete this article.');
      setDeleteTarget(null);
      setFeedback('Article permanently deleted.');
      window.setTimeout(() => localStorage.removeItem(`wtsl:article-editor:${encodeURIComponent(userId)}:${encodeURIComponent(String(deleteTarget.id))}`), 0);
      if (String(selectedId) === String(deleteTarget.id)) { setSelectedId(null); setCreating(false); setEditorDirty(false); }
      await loadArticles();
    } catch (cause) { setFeedback(cause instanceof Error ? cause.message : 'Could not delete this article.'); }
    finally { setDeleting(false); }
  }

  function startNew() {
    if ((creating || selectedId) && editorDirty && !window.confirm('This story has unsaved edits. They will be saved on this device for recovery. Switch to a new article?')) return;
    setSelectedId(null);
    setCreating(true);
    setEditorDirty(false);
    setFeedback('');
  }
  function openArticle(id: number | string) {
    if (String(selectedId) === String(id) && !creating) return;
    if ((creating || selectedId) && editorDirty && !window.confirm('This story has unsaved edits. They will be saved on this device for recovery. Open another article?')) return;
    setCreating(false);
    setSelectedId(id);
    setEditorDirty(false);
    setFeedback('');
  }
  function closeEditor() {
    if (editorDirty && !window.confirm('Your unsaved edits will be kept on this device for recovery. Close the editor?')) return;
    setCreating(false);
    setSelectedId(null);
    setEditorDirty(false);
  }

  return (
    <div className="article-studio">
      <header className="article-studio-head">
        <div><span className="eyebrow">WTSL · Staff publishing</span><h1>Article desk</h1><p className="muted">Build a match story, save it safely, and publish when it’s ready.</p></div>
        <div className="article-form-actions"><button type="button" className="btn btn-primary" onClick={startNew}><FilePlus2 size={16} /> New article</button><button type="button" className="btn btn-ghost" onClick={() => void loadArticles()} disabled={loading} aria-label="Refresh article list"><RefreshCw size={16} /> Refresh</button></div>
      </header>
      {feedback && <p className="article-save-state" role="status" aria-live="polite">{feedback}</p>}
      <div className="article-studio-grid">
        <section className="article-studio-panel article-manager" aria-labelledby="article-list-heading">
          <div className="article-studio-panel-head"><h2 id="article-list-heading">The story shelf</h2><span className="pill">{loading ? 'Loading' : `${articles.length} articles`}</span></div>
          {loading ? <div className="article-studio-panel-body" aria-busy="true"><div className="article-skeleton" /><div className="article-skeleton" /><div className="article-skeleton" /></div> : error ? <div className="article-manager-empty" role="alert"><strong>Article shelf unavailable</strong>{error}<br /><button type="button" className="btn btn-sm" onClick={() => void loadArticles()}>Try again</button></div> : articles.length ? articles.map(article => (
            <div className="article-manager-row" key={article.id}>
              <div><span className="article-manager-title">{article.title || 'Untitled article'}</span><div className="article-manager-meta"><span className={`pill ${article.published ? 'green' : 'pin'}`}>{article.published ? 'Published' : 'Draft'}</span><span>{article.author || 'WTSL staff'}</span><time>{article.created_at ? new Date(article.created_at).toLocaleDateString() : 'Date unavailable'}</time></div></div>
              <div className="article-manager-actions">
                {article.published && <a className="btn btn-sm btn-ghost" href={`/articles/${encodeURIComponent(article.slug)}`} target="_blank" rel="noreferrer" aria-label={`Open ${article.title} in a new tab`}>View <ArrowUpRight size={14} /></a>}
                <button type="button" className="btn btn-sm" onClick={() => openArticle(article.id)}><Pencil size={14} /> Edit</button>
                <button type="button" className="btn btn-sm btn-ghost article-delete-button" onClick={() => setDeleteTarget(article)}><Trash2 size={14} /> Delete</button>
              </div>
            </div>
          )) : <div className="article-manager-empty"><strong>Nothing on the shelf yet.</strong>Start with the story you’d want to read after the match.</div>}
        </section>
        <aside className="article-studio-panel" aria-label="Article editor">
          <div className="article-studio-panel-head"><h2>{creating ? 'New story' : selectedId ? 'Edit story' : 'Writing desk'}</h2>{(creating || selectedId) && <span className="pill cyan">Editor open</span>}</div>
          {creating || selectedId ? <AdminArticleForm key={`${userId}:${selectedId ?? 'new'}`} userId={userId} articleId={selectedId} onDirtyChange={setEditorDirty} onSaved={article => { setEditorDirty(false); setCreating(false); setSelectedId(article.id); void loadArticles(); }} onCancel={closeEditor} /> : <div className="article-studio-panel-body"><p className="notice">Choose a draft or published story to continue, or create a new article. Drafts are visible only to staff.</p><button type="button" className="btn btn-primary" onClick={startNew}><FilePlus2 size={16} /> Start a story</button></div>}
        </aside>
      </div>
      {deleteTarget && <div className="article-delete-confirm" role="alertdialog" aria-labelledby="article-delete-title" aria-describedby="article-delete-description">
        <h3 id="article-delete-title">Permanently delete this article?</h3><p id="article-delete-description"><strong>{deleteTarget.title || 'Untitled article'}</strong> will be removed for good. This cannot be undone.</p>
        <div className="article-form-actions"><button type="button" className="btn btn-danger" onClick={() => void deleteArticle()} disabled={deleting}>{deleting ? 'Deleting…' : 'Yes, delete permanently'}</button><button type="button" className="btn btn-ghost" onClick={() => setDeleteTarget(null)} disabled={deleting}>Keep article</button></div>
      </div>}
    </div>
  );
}

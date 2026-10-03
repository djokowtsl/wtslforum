'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CommunityNote } from '@/lib/communityNotes';
import RichText from './RichText';
import MentionTextarea from './MentionTextarea';

export default function CommunityNotes({
  targetType,
  targetId,
  notes,
  viewerId,
  canModerate = false,
}: {
  targetType: 'topic' | 'reply';
  targetId: number;
  notes: CommunityNote[];
  viewerId: string | null;
  canModerate?: boolean;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [formVersion, setFormVersion] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [privateNotes, setPrivateNotes] = useState<CommunityNote[]>([]);
  const [message, setMessage] = useState('');
  const publicNotes = notes.filter((note) => note.has_consensus);

  async function loadPrivateNotes() {
    if (!viewerId) return;
    setLoadingNotes(true);
    try {
      const query = new URLSearchParams({ targetType, targetId: String(targetId) });
      const response = await fetch(`/api/community-notes?${query}`, { cache: 'no-store' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(result.error || 'Unable to load private community notes.');
        return;
      }
      setPrivateNotes(Array.isArray(result.notes) ? result.notes : []);
    } catch {
      setMessage('Network problem — please try again.');
    } finally {
      setLoadingNotes(false);
    }
  }

  function openPrivateReply() {
    setMessage('');
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    setDialogOpen(true);
    void loadPrivateNotes();
  }

  function closePrivateReply() {
    dialogRef.current?.close();
    setDialogOpen(false);
  }

  async function rate(noteId: number, helpful: boolean) {
    setBusyId(noteId);
    setMessage('');
    try {
      const response = await fetch(`/api/community-notes/${noteId}/rating`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ helpful }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) { setMessage(result.error || 'Unable to save your rating.'); return; }
      setMessage('Your rating has been saved.');
      await loadPrivateNotes();
      router.refresh();
    } catch {
      setMessage('Network problem — please try again.');
    } finally {
      setBusyId(null);
    }
  }

  async function remove(noteId: number) {
    setBusyId(noteId);
    setMessage('');
    try {
      const response = await fetch('/api/admin/moderation/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'note', id: noteId, action: 'remove' }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) { setMessage(result.error || 'Unable to remove this note.'); return; }
      setMessage('The community note was removed.');
      if (dialogRef.current?.open) await loadPrivateNotes();
      router.refresh();
    } catch {
      setMessage('Network problem — please try again.');
    } finally {
      setBusyId(null);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const text = String(form.get('body') || '').trim();
    if (!text) { setMessage('Write a note before submitting.'); return; }
    setSubmitting(true);
    setMessage('');
    try {
      const response = await fetch('/api/community-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetType, targetId, body: text }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) { setMessage(result.error || 'Unable to submit the note.'); return; }
      formElement.reset();
      setFormVersion((version) => version + 1);
      setMessage(result.message || 'Your note was submitted.');
      await loadPrivateNotes();
      router.refresh();
    } catch {
      setMessage('Network problem — please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function renderNote(note: CommunityNote, inPrivateReview: boolean) {
    const isAuthor = viewerId !== null && String(note.author_id) === viewerId;
    return (
      <article className={note.has_consensus ? 'community-note' : 'community-note community-note-proposed'} key={note.id}>
        <div className="community-note-heading">
          <strong>{note.has_consensus ? 'Community note' : 'Private note · collecting member ratings'}</strong>
          <span>{note.helpful_count}/{note.rating_count} helpful</span>
        </div>
        <div className="community-note-body"><RichText text={note.body} /></div>
        <p className="community-note-author">Submitted by {note.author || 'Member'}</p>
        {inPrivateReview && viewerId && !isAuthor && (
          <div className="community-note-actions">
            <button type="button" className="btn btn-sm btn-ghost" disabled={busyId === note.id} aria-pressed={note.viewer_vote === true} onClick={() => rate(note.id, true)}>Helpful</button>
            <button type="button" className="btn btn-sm btn-ghost" disabled={busyId === note.id} aria-pressed={note.viewer_vote === false} onClick={() => rate(note.id, false)}>Not helpful</button>
          </div>
        )}
        {canModerate && <button type="button" className="btn btn-sm btn-ghost community-note-remove" disabled={busyId === note.id} onClick={() => remove(note.id)}>Remove note</button>}
      </article>
    );
  }

  if (!viewerId && publicNotes.length === 0) return null;

  return (
    <>
      {publicNotes.length > 0 && (
        <details className="community-note-public-flag">
          <summary><span className="pill cyan">Community note</span></summary>
          <div className="community-note-public-content">
            {publicNotes.map((note) => renderNote(note, false))}
          </div>
        </details>
      )}

      {viewerId && (
        <>
          <button
            type="button"
            className="btn btn-sm btn-ghost community-note-private-action"
            aria-haspopup="dialog"
            aria-expanded={dialogOpen}
            aria-controls={`community-note-dialog-${targetType}-${targetId}`}
            onClick={openPrivateReply}
          >
            Reply privately
          </button>
          <dialog
            ref={dialogRef}
            id={`community-note-dialog-${targetType}-${targetId}`}
            className="community-note-dialog"
            aria-labelledby={`community-note-dialog-title-${targetType}-${targetId}`}
            aria-describedby={`community-note-dialog-description-${targetType}-${targetId}`}
            onClose={() => setDialogOpen(false)}
            onClick={(event) => {
              if (event.target === event.currentTarget) closePrivateReply();
            }}
          >
            <div className="community-note-dialog-content">
              <header className="community-note-dialog-header">
                <div>
                  <p className="eyebrow">Private reply</p>
                  <h2 id={`community-note-dialog-title-${targetType}-${targetId}`}>Community note</h2>
                </div>
                <button type="button" className="btn btn-sm btn-ghost" onClick={closePrivateReply}>Close</button>
              </header>
              <p className="community-note-private-copy" id={`community-note-dialog-description-${targetType}-${targetId}`}>
                Pending notes are only available to signed-in members in this review panel. A flag appears on the post after a note receives at least five ratings and 80% helpful votes.
              </p>
              {loadingNotes ? (
                <p className="community-note-private-empty" role="status">Loading private notes…</p>
              ) : privateNotes.length > 0 ? (
                <div className="community-note-review-list">
                  {privateNotes.map((note) => renderNote(note, true))}
                </div>
              ) : (
                <p className="community-note-private-empty">No notes are waiting for community ratings.</p>
              )}
              <form className="community-note-form" onSubmit={submit}>
                <label>
                  Add context privately
                  <MentionTextarea key={formVersion} name="body" rows={3} maxLength={3000} placeholder="Add factual context for this discussion or reply…" enableSpoilers />
                </label>
                <button className="btn btn-sm" type="submit" disabled={submitting}>{submitting ? 'Sending…' : 'Send private note'}</button>
              </form>
              {message && <p className="notice" role="status">{message}</p>}
            </div>
          </dialog>
          {message && !dialogOpen && <p className="notice community-note-private-status" role="status">{message}</p>}
        </>
      )}
    </>
  );
}
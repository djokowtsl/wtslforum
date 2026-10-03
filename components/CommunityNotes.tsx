'use client';

import { useState } from 'react';
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
  const [busyId, setBusyId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formVersion, setFormVersion] = useState(0);
  const [message, setMessage] = useState('');

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
      router.refresh();
    } catch {
      setMessage('Network problem — please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="community-notes" aria-label="Community notes">
      <h3>Community notes</h3>
      {notes.length ? notes.map((note) => {
        const isAuthor = viewerId !== null && String(note.author_id) === viewerId;
        return (
          <article className={note.has_consensus ? 'community-note' : 'community-note community-note-proposed'} key={note.id}>
            <div className="community-note-heading">
              <strong>{note.has_consensus ? 'Community note' : 'Proposed note · collecting member ratings'}</strong>
              <span>{note.helpful_count}/{note.rating_count} helpful</span>
            </div>
            <div className="community-note-body"><RichText text={note.body} /></div>
            <p className="community-note-author">Submitted by {note.author || 'Member'}</p>
            {viewerId && !isAuthor && (
              <div className="community-note-actions">
                <button type="button" className="btn btn-sm btn-ghost" disabled={busyId === note.id} aria-pressed={note.viewer_vote === true} onClick={() => rate(note.id, true)}>Helpful</button>
                <button type="button" className="btn btn-sm btn-ghost" disabled={busyId === note.id} aria-pressed={note.viewer_vote === false} onClick={() => rate(note.id, false)}>Not helpful</button>
              </div>
            )}
            {canModerate && <button type="button" className="btn btn-sm btn-ghost community-note-remove" disabled={busyId === note.id} onClick={() => remove(note.id)}>Remove note</button>}
            {!note.has_consensus && <small>This note is shown to signed-in members so they can rate it; it appears publicly after five ratings and at least 80% helpful votes.</small>}
          </article>
        );
      }) : <p className="community-notes-empty">No community notes have reached consensus yet.</p>}

      {viewerId ? (
        <form className="community-note-form" onSubmit={submit}>
          <label>
            Add a community note
            <MentionTextarea key={formVersion} name="body" rows={3} maxLength={3000} placeholder="Add factual context for this discussion or reply…" enableSpoilers />
          </label>
          <button className="btn btn-sm" type="submit" disabled={submitting}>{submitting ? 'Submitting…' : 'Submit note'}</button>
        </form>
      ) : (
        <p className="community-notes-empty"><a href="/api/auth/discord">Sign in</a> to submit or rate a community note.</p>
      )}
      {message && <p className="notice" role="status">{message}</p>}
    </section>
  );
}
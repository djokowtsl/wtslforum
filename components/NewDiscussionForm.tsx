'use client';
import { useState } from 'react';
import MentionTextarea from './MentionTextarea';

type Props = {
  categories: any[];
  initialTitle?: string;
  initialBody?: string;
  matchKey?: string;
  tour?: string;
  initialCategoryId?: string | number;
};

export default function NewDiscussionForm({ categories, initialTitle, initialBody, matchKey, tour, initialCategoryId }: Props) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingMessage, setPendingMessage] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [submittedVideo, setSubmittedVideo] = useState<{ id: number; pending: boolean } | null>(null);
  const [successMessage, setSuccessMessage] = useState('');
  const [createdTopicId, setCreatedTopicId] = useState<number | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setPendingMessage('');
    setSuccessMessage('');
    const f = new FormData(e.currentTarget);
    const body = String(f.get('body') || '').trim();
    const title = String(f.get('title') || '').trim();
    // A match thread is only ever actually created once someone writes a real first post — an
    // auto-filled starter post left untouched (or cleared out) must not spawn a stale thread.
    if (matchKey && (!body || body === (initialBody || '').trim())) {
      setError('Add your own thoughts to the post before publishing this match thread.');
      setBusy(false);
      return;
    }
    try {
      let videoClipId: number | null = null;
      let videoPending = false;
      if (videoFile || videoUrl.trim()) {
        if (videoFile && !videoFile.type.startsWith('video/')) {
          setError('Choose a video file to attach.');
          setBusy(false);
          return;
        }
        if (submittedVideo) {
          videoClipId = submittedVideo.id;
          videoPending = submittedVideo.pending;
        }
        const mediaResponse = submittedVideo ? null : videoFile
          ? await fetch('/api/media', {
              method: 'POST',
              body: (() => {
                const form = new FormData();
                form.append('title', title.slice(0, 120));
                form.append('tour', tour || '');
                form.append('file', videoFile);
                return form;
              })(),
            })
          : await fetch('/api/media', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ title: title.slice(0, 120), url: videoUrl.trim(), tour: tour || undefined }),
            });
        if (mediaResponse) {
          const mediaData = await mediaResponse.json().catch(() => ({}));
          if (!mediaResponse.ok || !mediaData.ok || !Number.isSafeInteger(Number(mediaData.id))) {
            throw new Error(mediaData.error || 'The video could not be submitted.');
          }
          videoClipId = Number(mediaData.id);
          videoPending = !!mediaData.pending;
          setSubmittedVideo({ id: videoClipId, pending: videoPending });
        }
      }
      const r = await fetch('/api/topics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, categoryId: f.get('categoryId'), body, matchKey, tour, videoClipId }) });
      const x = await r.json().catch(() => ({}));
      if (r.ok && x.pending) {
        setPendingMessage(`${x.message || 'Your discussion is waiting for moderator review.'}${videoPending ? ' The video will remain private until a moderator approves it.' : ''}`);
      } else if (r.ok && videoPending) {
        setCreatedTopicId(Number(x.id));
        setSuccessMessage('Discussion published. Your video will remain private until a moderator approves it.');
      } else if (r.ok) location.href = '/discussions/' + x.id;
      else setError(x.error || 'Unable to publish your discussion.');
    } catch {
      setError('Network problem — please try again.');
    }
    setBusy(false);
  }

  return (
    <form className="form-card" onSubmit={submit}>
      {matchKey && <p className="notice">This will create the Match Talk thread for this match — write something below to publish it.</p>}
      <label>Title<input name="title" required maxLength={140} placeholder="e.g. US Open final — that second set" defaultValue={initialTitle || ''} readOnly={!!matchKey} /></label>
      {matchKey && initialCategoryId !== undefined ? (
        <input type="hidden" name="categoryId" value={String(initialCategoryId)} />
      ) : (
        <label>
          Category
          <select name="categoryId" required defaultValue={initialCategoryId !== undefined ? String(initialCategoryId) : undefined}>
            {categories.map((c) => <option value={c.id} key={c.id}>{c.name}</option>)}
          </select>
        </label>
      )}
      <label>Post<MentionTextarea name="body" required rows={11} maxLength={20000} placeholder="Write your post…" defaultValue={initialBody || ''} enableSpoilers /></label>
      {error && <p className="form-error">{error}</p>}
      {pendingMessage && <p className="notice" role="status">{pendingMessage}</p>}
      {successMessage && <p className="notice" role="status">{successMessage} {createdTopicId && <a href={`/discussions/${createdTopicId}`}>Open discussion →</a>}</p>}
      <label className="topic-video-attachment">
        Optional video link
        <input
          type="url"
          value={videoUrl}
          onChange={(event) => { setVideoUrl(event.target.value); setSubmittedVideo(null); if (event.target.value) setVideoFile(null); }}
          placeholder="https://youtube.com/…"
          disabled={busy || !!videoFile}
        />
        <span>Or upload a video (20 MB max). Video links and uploads stay private until moderator approval.</span>
      </label>
      <label className="topic-video-attachment">
        Upload a video
        <input
          type="file"
          accept="video/*"
          onChange={(event) => { setVideoFile(event.target.files?.[0] ?? null); setSubmittedVideo(null); if (event.target.files?.length) setVideoUrl(''); }}
          disabled={busy || !!videoUrl.trim()}
        />
      </label>
      <div><button className="btn btn-primary" type="submit" disabled={busy || !!pendingMessage || !!successMessage}>{busy ? 'Publishing…' : pendingMessage ? 'Awaiting review' : 'Publish discussion'}</button></div>
    </form>
  );
}

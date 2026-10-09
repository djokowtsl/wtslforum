'use client';

/** Content-change time, never the most recent polling/check time. */
export default function FeedUpdatedAt({ updatedAt }: { updatedAt?: string | null }) {
  const date = updatedAt ? new Date(updatedAt) : null;
  if (!date || !Number.isFinite(date.getTime())) {
    return <span>Update time unavailable</span>;
  }
  return <span title="When the Forum last received changed data for this feed.">Updated at <time dateTime={date.toISOString()}>{date.toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })}</time></span>;
}

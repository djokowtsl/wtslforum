'use client';

/** Content-change time, never the most recent polling/check time. */
export default function FeedUpdatedAt({ updatedAt, as: Tag = 'span', className }: {
  updatedAt?: string | null;
  as?: 'span' | 'p' | 'small';
  className?: string;
}) {
  const date = updatedAt ? new Date(updatedAt) : null;
  if (!date || !Number.isFinite(date.getTime())) {
    return null;
  }
  return <Tag className={className}>Last Updated <time dateTime={date.toISOString()}>{date.toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })}</time></Tag>;
}

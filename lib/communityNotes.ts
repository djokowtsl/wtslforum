import { sql } from '@/lib/db';
import { anonymizeCommunityNote, hasCommunityNoteConsensus, partitionCommunityNotes } from '@/lib/communityNotePolicy';

export type CommunityNote = {
  id: number;
  topic_id: number | null;
  reply_id: number | null;
  body: string;
  created_at: string;
  rating_count: number;
  helpful_count: number;
  viewer_vote: boolean | null;
  has_consensus: boolean;
  viewer_is_author: boolean;
};

function toCommunityNote(row: any, viewerId: string | null): CommunityNote {
  const ratingCount = Number(row.rating_count);
  const helpfulCount = Number(row.helpful_count);
  return anonymizeCommunityNote({
    id: Number(row.id),
    topic_id: row.topic_id == null ? null : Number(row.topic_id),
    reply_id: row.reply_id == null ? null : Number(row.reply_id),
    author_id: row.author_id == null ? null : Number(row.author_id),
    author: row.author == null ? null : String(row.author),
    body: String(row.body || ''),
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    rating_count: ratingCount,
    helpful_count: helpfulCount,
    viewer_vote: row.viewer_vote == null ? null : Boolean(Number(row.viewer_vote)),
    has_consensus: hasCommunityNoteConsensus(ratingCount, helpfulCount),
  }, viewerId);
}

export async function getThreadCommunityNotes(topicId: number, replyIds: number[], viewerId: string | null) {
  const rows = await sql`
    SELECT n.id,n.topic_id,n.reply_id,n.author_id,n.body,n.created_at,
      (COUNT(r.id) FILTER (WHERE n.author_id IS NULL OR r.user_id <> n.author_id))::int AS rating_count,
      (COUNT(r.id) FILTER (WHERE r.helpful AND (n.author_id IS NULL OR r.user_id <> n.author_id)))::int AS helpful_count,
      MAX(CASE
        WHEN r.user_id=${viewerId ? Number(viewerId) : 0}
          AND (n.author_id IS NULL OR r.user_id <> n.author_id)
        THEN CASE WHEN r.helpful THEN 1 ELSE 0 END
      END) AS viewer_vote
    FROM community_notes n
    LEFT JOIN community_note_ratings r ON r.note_id=n.id
    WHERE n.moderation_status='approved'
      AND (n.topic_id=${topicId} OR n.reply_id=ANY(${replyIds}::bigint[]))
    GROUP BY n.id
    ORDER BY n.created_at ASC
  `;

  const result = new Map<string, CommunityNote[]>();
  const publicNotes = partitionCommunityNotes(rows.map((row) => toCommunityNote(row, viewerId))).publicNotes;
  for (const note of publicNotes) {
    const key = note.topic_id ? `topic:${note.topic_id}` : `reply:${note.reply_id}`;
    result.set(key, [...(result.get(key) || []), note]);
  }
  return result;
}

export async function getPrivateCommunityNoteProposals(
  targetType: 'topic' | 'reply',
  targetId: number,
  viewerId: string,
) {
  const viewerUserId = Number(viewerId);
  const rows = await sql`
    SELECT n.id,n.topic_id,n.reply_id,n.author_id,n.body,n.created_at,
      (COUNT(r.id) FILTER (WHERE n.author_id IS NULL OR r.user_id <> n.author_id))::int AS rating_count,
      (COUNT(r.id) FILTER (WHERE r.helpful AND (n.author_id IS NULL OR r.user_id <> n.author_id)))::int AS helpful_count,
      MAX(CASE
        WHEN r.user_id=${viewerUserId}
          AND (n.author_id IS NULL OR r.user_id <> n.author_id)
        THEN CASE WHEN r.helpful THEN 1 ELSE 0 END
      END) AS viewer_vote
    FROM community_notes n
    LEFT JOIN community_note_ratings r ON r.note_id=n.id
    WHERE n.moderation_status='approved'
      AND (
        (${targetType === 'topic'} AND n.topic_id=${targetId})
        OR (${targetType === 'reply'} AND n.reply_id=${targetId})
      )
    GROUP BY n.id
    ORDER BY n.created_at ASC
  `;
  return partitionCommunityNotes(rows.map((row) => toCommunityNote(row, viewerId))).pendingNotes;
}
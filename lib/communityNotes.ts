import { sql } from '@/lib/db';
import { hasCommunityNoteConsensus } from '@/lib/communityNotePolicy';

export type CommunityNote = {
  id: number;
  topic_id: number | null;
  reply_id: number | null;
  author_id: number | null;
  author: string;
  body: string;
  created_at: string;
  rating_count: number;
  helpful_count: number;
  viewer_vote: boolean | null;
  has_consensus: boolean;
};

export async function getThreadCommunityNotes(topicId: number, replyIds: number[], viewerId: string | null) {
  const rows = await sql`
    SELECT n.id,n.topic_id,n.reply_id,n.author_id,u.display_name AS author,n.body,n.created_at,
      COUNT(r.id)::int AS rating_count,
      COUNT(r.id) FILTER (WHERE r.helpful)::int AS helpful_count,
      MAX(CASE WHEN r.user_id=${viewerId ? Number(viewerId) : 0} THEN CASE WHEN r.helpful THEN 1 ELSE 0 END END) AS viewer_vote
    FROM community_notes n
    LEFT JOIN users u ON u.id=n.author_id
    LEFT JOIN community_note_ratings r ON r.note_id=n.id
    WHERE n.moderation_status='approved'
      AND (n.topic_id=${topicId} OR n.reply_id=ANY(${replyIds}::bigint[]))
    GROUP BY n.id,u.display_name
    ORDER BY n.created_at ASC
  `;

  const result = new Map<string, CommunityNote[]>();
  for (const row of rows) {
    const ratingCount = Number(row.rating_count);
    const helpfulCount = Number(row.helpful_count);
    const hasConsensus = hasCommunityNoteConsensus(ratingCount, helpfulCount);
    if (!viewerId && !hasConsensus) continue;
    const note: CommunityNote = {
      ...row,
      id: Number(row.id),
      topic_id: row.topic_id == null ? null : Number(row.topic_id),
      reply_id: row.reply_id == null ? null : Number(row.reply_id),
      author_id: row.author_id == null ? null : Number(row.author_id),
      author: row.author || 'Member',
      body: String(row.body || ''),
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      rating_count: ratingCount,
      helpful_count: helpfulCount,
      viewer_vote: row.viewer_vote == null ? null : Boolean(Number(row.viewer_vote)),
      has_consensus: hasConsensus,
    };
    const key = note.topic_id ? `topic:${note.topic_id}` : `reply:${note.reply_id}`;
    result.set(key, [...(result.get(key) || []), note]);
  }
  return result;
}
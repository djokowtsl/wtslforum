import { sql } from './db';
import { isTournamentDiscussionEnabled, tournamentDiscussionContent, type TournamentDiscussion } from './tournamentDiscussionPolicy';

/** Reopens a deleted tournament thread, or creates one when its old topic was hard-deleted. */
export async function ensureTournamentDiscussion(tournament: TournamentDiscussion): Promise<number | null> {
  if (!isTournamentDiscussionEnabled(tournament)) return null;

  const content = tournamentDiscussionContent(tournament);
  if (tournament.discussion_topic_id) {
    const restored = await sql`
      UPDATE topics
      SET title=${content.title},body=${content.body},author_id=NULL,
        pinned=${content.pinned},locked=FALSE,views=0,moderation_status='approved',
        moderation_reason=NULL,moderated_by=NULL,moderated_at=NULL,
        created_at=NOW(),updated_at=NOW()
      WHERE id=${tournament.discussion_topic_id} AND moderation_status='deleted'
      RETURNING id
    `;
    if (restored[0]) return Number(restored[0].id);

    const existing = await sql`
      SELECT id FROM topics
      WHERE id=${tournament.discussion_topic_id} AND moderation_status='approved'
      LIMIT 1
    `;
    return existing[0] ? Number(existing[0].id) : null;
  }

  const slug = `tournament-${tournament.wtsl_tournament_key}`;
  const inserted = await sql`
    INSERT INTO topics(category_id,title,slug,body,pinned)
    SELECT c.id,${content.title},${slug},${content.body},${content.pinned}
    FROM categories c
    WHERE c.slug='tournaments'
    ON CONFLICT (slug) DO UPDATE SET
      title=EXCLUDED.title,body=EXCLUDED.body,author_id=NULL,
      pinned=EXCLUDED.pinned,locked=FALSE,views=0,moderation_status='approved',
      moderation_reason=NULL,moderated_by=NULL,moderated_at=NULL,
      created_at=NOW(),updated_at=NOW()
    WHERE topics.moderation_status='deleted'
    RETURNING id
  `;
  let topicId = inserted[0] ? Number(inserted[0].id) : null;

  // A concurrent page request may have inserted the same stable slug, or an earlier
  // request may have left its topic in place before linking it to the tournament row.
  if (!topicId) {
    const existing = await sql`
      SELECT id,moderation_status FROM topics WHERE slug=${slug} LIMIT 1
    `;
    if (existing[0]?.moderation_status === 'approved') topicId = Number(existing[0].id);
    else return null;
  }

  await sql`
    UPDATE tournaments SET discussion_topic_id=${topicId}
    WHERE id=${tournament.id} AND discussion_enabled=TRUE
      AND discussion_topic_id IS NULL
  `;
  const linked = await sql`
    SELECT discussion_topic_id FROM tournaments
    WHERE id=${tournament.id} AND discussion_enabled=TRUE
    LIMIT 1
  `;
  return Number(linked[0]?.discussion_topic_id) === topicId ? topicId : null;
}

/** Keep a deleted tournament topic as a private tombstone so its event can restore a blank thread. */
export async function deleteTopic(topicId: number) {
  const tombstoned = await sql`
    WITH tombstoned AS (
      UPDATE topics AS t
      SET title='Deleted tournament discussion',body='',author_id=NULL,
        pinned=FALSE,locked=TRUE,views=0,moderation_status='deleted',
        moderation_reason=NULL,moderated_by=NULL,moderated_at=NULL,updated_at=NOW()
      WHERE t.id=${topicId}
        AND EXISTS (SELECT 1 FROM tournaments WHERE discussion_topic_id=t.id)
      RETURNING t.id
    ),
    removed_replies AS (
      DELETE FROM replies r USING tombstoned t
      WHERE r.topic_id=t.id RETURNING r.id
    ),
    removed_reactions AS (
      DELETE FROM reactions reaction USING tombstoned t
      WHERE reaction.topic_id=t.id RETURNING reaction.id
    ),
    removed_notes AS (
      DELETE FROM community_notes note USING tombstoned t
      WHERE note.topic_id=t.id RETURNING note.id
    )
    SELECT id FROM tombstoned
  `;
  if (tombstoned[0]) return { deleted: true, restorable: true };

  const deleted = await sql`DELETE FROM topics WHERE id=${topicId} RETURNING id`;
  return { deleted: Boolean(deleted[0]), restorable: false };
}
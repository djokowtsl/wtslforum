import { sql } from './db';

/**
 * Finds the Match Talk thread already linked to this match/fixture. Returns null if nobody has
 * written the first post for this match yet — callers should NOT create a thread from this
 * alone, since an empty thread with nothing but auto-generated boilerplate would sit stale
 * forever if no one ever replies. The thread is only actually created once someone submits text
 * via `claimMatchThread` below.
 */
export async function findMatchThread(matchKey: string): Promise<number | null> {
  const rows = await sql`SELECT topic_id FROM match_threads WHERE match_key=${matchKey} LIMIT 1`;
  return rows[0] ? Number(rows[0].topic_id) : null;
}

/**
 * Links a freshly-created topic to a match as that match's one-and-only thread. If someone else
 * claimed the same match a moment earlier (two people writing the first post at once), the
 * earlier claim wins and this returns that topic id instead — the caller is expected to delete
 * its own just-created (and still reply-less) topic and redirect the user into the winning one.
 */
export async function claimMatchThread(matchKey: string, topicId: number): Promise<number> {
  await sql`INSERT INTO match_threads(match_key,topic_id) VALUES(${matchKey},${topicId}) ON CONFLICT (match_key) DO NOTHING`;
  const winner = await sql`SELECT topic_id FROM match_threads WHERE match_key=${matchKey} LIMIT 1`;
  return Number(winner[0].topic_id);
}

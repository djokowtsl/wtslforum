import { sql } from './db';

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 90);

/**
 * Finds the Match Talk thread already linked to this match/fixture, or creates one on first
 * click — using an auto-generated title/body built from the match itself, so nobody has to
 * come up with a thread title. Returns the topic id to redirect into.
 */
export async function getOrCreateMatchThread(matchKey: string, title: string, body: string): Promise<number> {
  const existing = await sql`SELECT topic_id FROM match_threads WHERE match_key=${matchKey} LIMIT 1`;
  if (existing[0]) return Number(existing[0].topic_id);

  const cat = (await sql`SELECT id FROM categories WHERE slug='match-talk' LIMIT 1`)[0];
  const slug = `${slugify(title)}-${Date.now()}`;
  const topic = await sql`INSERT INTO topics(category_id,title,slug,body) VALUES(${cat?.id ?? null},${title},${slug},${body}) RETURNING id`;
  const topicId = Number(topic[0].id);
  // ON CONFLICT guards the rare race where two people click "Discuss" on the same match at once.
  await sql`INSERT INTO match_threads(match_key,topic_id) VALUES(${matchKey},${topicId}) ON CONFLICT (match_key) DO NOTHING`;
  const winner = await sql`SELECT topic_id FROM match_threads WHERE match_key=${matchKey} LIMIT 1`;
  return Number(winner[0].topic_id);
}

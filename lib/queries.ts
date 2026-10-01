import { sql } from './db';

export async function getTopics(opts: { category?: string | null; limit?: number } = {}) {
  const cat = opts.category || null;
  const limit = opts.limit ?? 100;
  return sql`
    SELECT t.id,t.title,t.slug,t.pinned,t.locked,t.views,t.created_at,t.updated_at,
      c.name category,c.slug category_slug,
      u.display_name author,u.avatar_url avatar,
      tn.logo_url tournament_logo,
      (SELECT COUNT(*) FROM replies r WHERE r.topic_id=t.id)::int replies,
      (SELECT u2.display_name FROM replies r2 LEFT JOIN users u2 ON u2.id=r2.author_id WHERE r2.topic_id=t.id ORDER BY r2.created_at DESC LIMIT 1) last_author,
      (SELECT MAX(r3.created_at) FROM replies r3 WHERE r3.topic_id=t.id) last_reply_at
    FROM topics t
    LEFT JOIN categories c ON c.id=t.category_id
    LEFT JOIN users u ON u.id=t.author_id
    LEFT JOIN tournaments tn ON tn.discussion_topic_id=t.id
    WHERE (${cat}::text IS NULL OR c.slug=${cat})
    ORDER BY t.pinned DESC, COALESCE((SELECT MAX(r4.created_at) FROM replies r4 WHERE r4.topic_id=t.id), t.created_at) DESC
    LIMIT ${limit}`;
}

/** Accepts a numeric id or a slug (tournament threads link by slug). */
export async function getTopic(ref: string | number) {
  const isId = /^\d+$/.test(String(ref));
  const rows = isId
    ? await sql`SELECT t.*,c.name category,c.slug category_slug,u.id author_id,u.display_name author,u.avatar_url avatar,u.status author_status,tn.logo_url tournament_logo FROM topics t LEFT JOIN categories c ON c.id=t.category_id LEFT JOIN users u ON u.id=t.author_id LEFT JOIN tournaments tn ON tn.discussion_topic_id=t.id WHERE t.id=${Number(ref)} LIMIT 1`
    : await sql`SELECT t.*,c.name category,c.slug category_slug,u.id author_id,u.display_name author,u.avatar_url avatar,u.status author_status,tn.logo_url tournament_logo FROM topics t LEFT JOIN categories c ON c.id=t.category_id LEFT JOIN users u ON u.id=t.author_id LEFT JOIN tournaments tn ON tn.discussion_topic_id=t.id WHERE t.slug=${String(ref)} LIMIT 1`;
  const topic = rows[0];
  if (!topic) return null;
  await sql`UPDATE topics SET views=views+1 WHERE id=${topic.id}`;
  const replies = await sql`SELECT r.id,r.body,r.created_at,u.id author_id,u.display_name author,u.avatar_url avatar,u.is_admin,u.status author_status FROM replies r LEFT JOIN users u ON u.id=r.author_id WHERE r.topic_id=${topic.id} ORDER BY r.created_at ASC`;
  return { topic, replies };
}

export async function getCategories() {
  return sql`SELECT * FROM categories ORDER BY position`;
}

export async function getCategoriesWithCounts() {
  return sql`SELECT c.id,c.name,c.slug,c.description,c.position,(SELECT COUNT(*) FROM topics t WHERE t.category_id=c.id)::int topics FROM categories c ORDER BY c.position`;
}

export async function getArticles(publishedOnly = true, limit = 60) {
  return publishedOnly
    ? sql`SELECT a.*,u.display_name author FROM articles a LEFT JOIN users u ON u.id=a.author_id WHERE a.published=true ORDER BY a.created_at DESC LIMIT ${limit}`
    : sql`SELECT a.*,u.display_name author FROM articles a LEFT JOIN users u ON u.id=a.author_id ORDER BY a.created_at DESC LIMIT ${limit}`;
}

export async function getAwards() {
  return sql`SELECT * FROM awards ORDER BY season DESC, position ASC, id ASC`;
}

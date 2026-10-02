import { sql } from './db';

/** Per-emoji counts for one post, plus whether the current viewer has reacted with each. */
export type ReactionSummary = { emoji: string; count: number; reacted: boolean }[];

/** Reaction totals for a topic's opening post and every reply on the same thread, in one query —
 * grouped by (topic_id or reply_id, emoji) and checked against the signed-in viewer's own user id
 * so the UI can show "you reacted" state without a second round trip per post. */
export async function getThreadReactions(topicId: number, replyIds: number[], viewerId: string | number | null) {
  const vid = viewerId ? Number(viewerId) : null;
  const rows = await sql`
    SELECT topic_id, reply_id, emoji, COUNT(*)::int count,
      COALESCE(BOOL_OR(user_id = ${vid}::bigint), false) reacted
    FROM reactions
    WHERE topic_id = ${topicId} OR reply_id = ANY(${replyIds})
    GROUP BY topic_id, reply_id, emoji
  `;
  const topic: ReactionSummary = [];
  const replies: Record<number, ReactionSummary> = {};
  for (const r of rows as any[]) {
    const entry = { emoji: r.emoji, count: r.count, reacted: r.reacted };
    if (r.reply_id) (replies[r.reply_id] ??= []).push(entry);
    else topic.push(entry);
  }
  return { topic, replies };
}

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

/** Winner/runner-up/player_two are plain text, so these correlated lookups match them against
 * wtsl_players.name to show the same WTSL avatar used everywhere else on the site, instead of a
 * separate "awards identity". Falls back to no avatar (initials placeholder) if no match. */
/** Strips Discord emoji and an "aka <nickname>" suffix so a stored award name (plain text) can be
 * matched against the live WTSL rankings name for that player (which keeps its emoji/nickname
 * suffix as scraped, e.g. "Dani21 🛩 aka Halapeno"). */
const EMOJI_RE = /[\u{1F000}-\u{1FFFF}\u{2190}-\u{2BFF}\u{2600}-\u{27BF}\uFE0F\u200D]/gu;
export function normalizePlayerName(name?: string | null) {
  if (!name) return '';
  return name.replace(/\s+aka\s+.*$/i, '').replace(EMOJI_RE, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function displayAwardName(name?: string | null) {
  if (!name) return name ?? null;
  return name.replace(EMOJI_RE, '').replace(/\s+/g, ' ').trim();
}

/** Awards (hall of fame). Player avatars are matched in JS against the live rankings since award
 * winners are stored as plain names while rankings names keep their emoji/nickname suffix.
 * "Tournament of the Year" names a tournament, not a player, so its avatar comes from
 * `tournaments.logo_url` instead. */
export async function getAwards() {
  const [awards, players, tournamentsWithLogo] = await Promise.all([
    sql`SELECT * FROM awards ORDER BY season DESC, position ASC, id ASC`,
    sql`SELECT name, avatar_url FROM wtsl_players ORDER BY (tour='TE4') DESC, synced_at DESC`,
    sql`SELECT name, logo_url FROM tournaments WHERE logo_url IS NOT NULL ORDER BY last_synced_at DESC`,
  ]);
  const playerAvatar = new Map<string, string>();
  for (const p of players as any[]) {
    const key = normalizePlayerName(p.name);
    if (key && !playerAvatar.has(key)) playerAvatar.set(key, p.avatar_url);
  }
  const tourneyLogo = new Map<string, string>();
  for (const t of tournamentsWithLogo as any[]) {
    const key = (t.name || '').trim().toLowerCase();
    if (key && !tourneyLogo.has(key)) tourneyLogo.set(key, t.logo_url);
  }
  return (awards as any[]).map((a) => {
    const avatarFor = (n?: string | null) =>
      a.category === 'Tournament of the Year' ? tourneyLogo.get((n || '').trim().toLowerCase()) : playerAvatar.get(normalizePlayerName(n));
    return {
      ...a,
      winner: displayAwardName(a.winner) ?? a.winner,
      runner_up: displayAwardName(a.runner_up),
      player_two: displayAwardName(a.player_two),
      winner_avatar: avatarFor(a.winner),
      runner_up_avatar: avatarFor(a.runner_up),
      player_two_avatar: avatarFor(a.player_two),
    };
  });
}

/** Forum activity counts for one user's personal dashboard. */
export async function getContributionStats(userId: string) {
  const [topics, replies, articles] = await Promise.all([
    sql`SELECT COUNT(*)::int c FROM topics WHERE author_id=${userId}`,
    sql`SELECT COUNT(*)::int c FROM replies WHERE author_id=${userId}`,
    sql`SELECT COUNT(*)::int c FROM articles WHERE author_id=${userId}`,
  ]);
  return { topics: topics[0]?.c ?? 0, replies: replies[0]?.c ?? 0, articles: articles[0]?.c ?? 0 };
}

/** A user's most recently authored topics/replies, newest first, for a dashboard activity feed. */
export async function getRecentActivity(userId: string, limit = 6) {
  return sql`
    (SELECT 'topic' AS kind, t.id, t.title AS title, t.slug, t.created_at FROM topics t WHERE t.author_id=${userId})
    UNION ALL
    (SELECT 'reply' AS kind, r.topic_id AS id, tp.title AS title, tp.slug, r.created_at FROM replies r JOIN topics tp ON tp.id=r.topic_id WHERE r.author_id=${userId})
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
}

import { sql } from './db';

export type SearchResults = {
  discussions: { id: number; title: string; slug: string; snippet: string }[];
  articles: { title: string; slug: string; excerpt: string }[];
  players: { id: string; tour: string; name: string; avatar_url: string | null }[];
  tournaments: { slug: string; name: string; tour: string; status: string }[];
};

/** Simple ILIKE-based search across the forum's own content — discussions, articles, synced
 * WTSL players and tournaments. No full-text index needed at this content volume. */
export async function searchSite(qRaw: string): Promise<SearchResults> {
  const q = qRaw.trim();
  if (!q) return { discussions: [], articles: [], players: [], tournaments: [] };
  const like = `%${q}%`;

  const [discussions, articles, players, tournaments] = await Promise.all([
    sql`SELECT id, title, slug, LEFT(body, 160) snippet FROM topics WHERE title ILIKE ${like} OR body ILIKE ${like} ORDER BY created_at DESC LIMIT 10`,
    sql`SELECT title, slug, excerpt FROM articles WHERE published=true AND (title ILIKE ${like} OR excerpt ILIKE ${like}) ORDER BY created_at DESC LIMIT 10`,
    sql`SELECT DISTINCT ON (wtsl_player_id, tour) wtsl_player_id id, tour, name, avatar_url FROM wtsl_players WHERE name ILIKE ${like} ORDER BY wtsl_player_id, tour, synced_at DESC LIMIT 10`,
    sql`SELECT wtsl_tournament_key slug, name, tour, status FROM tournaments WHERE name ILIKE ${like} ORDER BY start_date DESC NULLS LAST LIMIT 10`,
  ]);

  return {
    discussions: discussions as any,
    articles: articles as any,
    players: players as any,
    tournaments: tournaments as any,
  };
}

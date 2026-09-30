import {sql} from './db';
import {fetchWTSLTournaments,fetchWTSLPlayer,fetchWTSLRankings} from './wtsl';

const PLAYER_UPSERT_NOTE = 'keeps existing avatar/flag/elo when a refresh omits them';

export async function syncPlayers() {
  const players = await fetchWTSLRankings();
  let upserted = 0;
  for (let i = 0; i < players.length; i += 10) {
    await Promise.all(players.slice(i, i + 10).map((p) => sql`INSERT INTO wtsl_players(wtsl_player_id,name,avatar_url,flag_url,country,rank,tour_elo,elo_label,official_url) VALUES(${p.id},${p.name},${p.avatarUrl},${p.flagUrl},${p.country},${p.rank},${p.tourElo},${p.eloLabel},${p.officialUrl}) ON CONFLICT(wtsl_player_id) DO UPDATE SET name=EXCLUDED.name,avatar_url=COALESCE(EXCLUDED.avatar_url,wtsl_players.avatar_url),flag_url=COALESCE(EXCLUDED.flag_url,wtsl_players.flag_url),country=COALESCE(NULLIF(EXCLUDED.country,''),wtsl_players.country),rank=EXCLUDED.rank,tour_elo=COALESCE(EXCLUDED.tour_elo,wtsl_players.tour_elo),elo_label=COALESCE(EXCLUDED.elo_label,wtsl_players.elo_label),official_url=EXCLUDED.official_url,synced_at=NOW()`));
    upserted += Math.min(10, players.length - i);
  }
  return { seen: players.length, upserted, note: PLAYER_UPSERT_NOTE };
}

/** Returns the WTSL player id for a champion link, fetching the player page if we have never seen them. */
async function ensureChampion(url: string | null): Promise<string | null> {
  if (!url) return null;
  let id: string | null = null;
  try { id = new URL(url).searchParams.get('player'); } catch { return null; }
  if (!id) return null;
  const existing = await sql`SELECT 1 FROM wtsl_players WHERE wtsl_player_id=${id} LIMIT 1`;
  if (!existing[0]) {
    try {
      const p = await fetchWTSLPlayer(url);
      await sql`INSERT INTO wtsl_players(wtsl_player_id,name,avatar_url,flag_url,country,rank,tour_elo,elo_label,official_url) VALUES(${p.id},${p.name},${p.avatarUrl},${p.flagUrl},${p.country},${p.rank},${p.tourElo},${p.eloLabel},${p.officialUrl}) ON CONFLICT(wtsl_player_id) DO NOTHING`;
    } catch { /* champion card simply stays blank until the next sync */ }
  }
  return id;
}

export async function syncTournaments() {
  const tournaments = await fetchWTSLTournaments();
  let created = 0, updated = 0;
  for (const t of tournaments) {
    const championId = await ensureChampion(t.championUrl);
    const rows = await sql`SELECT id, discussion_topic_id FROM tournaments WHERE wtsl_tournament_key=${t.key} LIMIT 1`;
    if (rows[0]) {
      await sql`UPDATE tournaments SET name=${t.name},location=${t.location},country=${t.country},category=${t.category},draw_size=${t.drawSize},surface=${t.surface},start_date=${t.startDate},status=${t.status},champion_player_id=${championId},official_url=${t.officialUrl},last_synced_at=NOW() WHERE id=${rows[0].id}`;
      updated++;
    } else {
      const inserted = await sql`INSERT INTO tournaments(wtsl_tournament_key,name,location,country,category,draw_size,surface,start_date,status,champion_player_id,official_url) VALUES(${t.key},${t.name},${t.location},${t.country},${t.category},${t.drawSize},${t.surface},${t.startDate},${t.status},${championId},${t.officialUrl}) RETURNING id`;
      const cat = (await sql`SELECT id FROM categories WHERE slug='tournaments' LIMIT 1`)[0];
      const topic = await sql`INSERT INTO topics(category_id,title,slug,body,pinned) VALUES(${cat?.id ?? null},${`🏆 ${t.name} — Tournament Discussion`},${`tournament-${t.key}`},${`Official community discussion for ${t.name}.\n\n${t.location}, ${t.country} · ${t.category} · ${t.surface}\n\n**Status:** ${t.status}\n\n[View the official WTSL tournament page](${t.officialUrl})`},${t.status==='ongoing'}) RETURNING id`;
      await sql`UPDATE tournaments SET discussion_topic_id=${topic[0].id} WHERE id=${inserted[0].id}`;
      created++;
    }
  }
  return { seen: tournaments.length, created, updated };
}

export async function getTournaments(status?:string) {
  if(status) return sql`SELECT * FROM tournaments WHERE status=${status} ORDER BY start_date DESC NULLS LAST,name`;
  return sql`SELECT * FROM tournaments ORDER BY CASE status WHEN 'ongoing' THEN 0 WHEN 'upcoming' THEN 1 WHEN 'completed' THEN 2 ELSE 3 END,start_date DESC NULLS LAST`;
}
export async function getTournament(slug:string) { const r=await sql`SELECT * FROM tournaments WHERE wtsl_tournament_key=${slug} LIMIT 1`; return r[0] ?? null; }

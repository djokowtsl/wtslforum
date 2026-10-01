import {sql} from './db';
import {fetchWTSLTournaments,fetchWTSLPlayer,fetchWTSLRankings,fetchWTSLTournamentLogo,TOURS,DEFAULT_TOUR,HISTORICAL_TOURNAMENT_YEARS,type TourCode} from './wtsl';

export {TOURS, DEFAULT_TOUR, HISTORICAL_TOURNAMENT_YEARS};
export type {TourCode};

const PLAYER_UPSERT_NOTE = 'keeps existing avatar/flag/elo when a refresh omits them';

export async function syncPlayers(tour: TourCode = DEFAULT_TOUR) {
  const players = await fetchWTSLRankings(tour);
  let upserted = 0;
  for (let i = 0; i < players.length; i += 10) {
    await Promise.all(players.slice(i, i + 10).map((p) => sql`INSERT INTO wtsl_players(wtsl_player_id,tour,name,avatar_url,flag_url,country,rank,tour_elo,elo_label,official_url) VALUES(${p.id},${tour},${p.name},${p.avatarUrl},${p.flagUrl},${p.country},${p.rank},${p.tourElo},${p.eloLabel},${p.officialUrl}) ON CONFLICT(wtsl_player_id,tour) DO UPDATE SET name=EXCLUDED.name,avatar_url=COALESCE(EXCLUDED.avatar_url,wtsl_players.avatar_url),flag_url=COALESCE(EXCLUDED.flag_url,wtsl_players.flag_url),country=COALESCE(NULLIF(EXCLUDED.country,''),wtsl_players.country),rank=EXCLUDED.rank,tour_elo=COALESCE(EXCLUDED.tour_elo,wtsl_players.tour_elo),elo_label=COALESCE(EXCLUDED.elo_label,wtsl_players.elo_label),official_url=EXCLUDED.official_url,synced_at=NOW()`));
    upserted += Math.min(10, players.length - i);
  }
  return { tour, seen: players.length, upserted, note: PLAYER_UPSERT_NOTE };
}

export async function syncPlayersAllTours() {
  const results = [];
  for (const t of TOURS) {
    try { results.push(await syncPlayers(t.code)); }
    catch (e) { results.push({ tour: t.code, error: e instanceof Error ? e.message : 'Sync failed' }); }
  }
  return results;
}

/** Returns the WTSL player id for a champion link, fetching the player page if we have never seen them. */
async function ensureChampion(url: string | null, tour: TourCode): Promise<string | null> {
  if (!url) return null;
  let id: string | null = null;
  try { id = new URL(url).searchParams.get('player'); } catch { return null; }
  if (!id) return null;
  const existing = await sql`SELECT 1 FROM wtsl_players WHERE wtsl_player_id=${id} AND tour=${tour} LIMIT 1`;
  if (!existing[0]) {
    try {
      const p = await fetchWTSLPlayer(url);
      await sql`INSERT INTO wtsl_players(wtsl_player_id,tour,name,avatar_url,flag_url,country,rank,tour_elo,elo_label,official_url) VALUES(${p.id},${tour},${p.name},${p.avatarUrl},${p.flagUrl},${p.country},${p.rank},${p.tourElo},${p.eloLabel},${p.officialUrl}) ON CONFLICT(wtsl_player_id,tour) DO NOTHING`;
    } catch { /* champion card simply stays blank until the next sync */ }
  }
  return id;
}

export async function syncTournaments(tour: TourCode = DEFAULT_TOUR, opts: { year?: string; createDiscussion?: boolean } = {}) {
  const { year, createDiscussion = true } = opts;
  const tournaments = await fetchWTSLTournaments(tour, year);
  let created = 0, updated = 0;
  for (const t of tournaments) {
    const championId = await ensureChampion(t.championUrl, tour);
    let rows = await sql`SELECT id, discussion_topic_id, logo_url FROM tournaments WHERE wtsl_tournament_key=${t.key} LIMIT 1`;
    // First sync after the key scheme changed (name+date -> stable site ID): adopt the existing
    // row for this tournament by name instead of inserting a second one for it. Picks the most
    // recently synced match in case stale duplicates from the old scheme are still around.
    if (!rows[0]) {
      rows = await sql`SELECT id, discussion_topic_id, logo_url FROM tournaments WHERE tour=${tour} AND name=${t.name} ORDER BY last_synced_at DESC LIMIT 1`;
      if (rows[0]) await sql`UPDATE tournaments SET wtsl_tournament_key=${t.key} WHERE id=${rows[0].id}`;
    }
    const logoUrl = rows[0]?.logo_url ?? await fetchWTSLTournamentLogo(t.officialUrl).catch(() => null);
    if (rows[0]) {
      await sql`UPDATE tournaments SET name=${t.name},tour=${tour},location=${t.location},country=${t.country},category=${t.category},draw_size=${t.drawSize},surface=${t.surface},start_date=${t.startDate},status=${t.status},champion_player_id=${championId},official_url=${t.officialUrl},logo_url=COALESCE(${logoUrl},logo_url),last_synced_at=NOW() WHERE id=${rows[0].id}`;
      updated++;
    } else {
      const inserted = await sql`INSERT INTO tournaments(wtsl_tournament_key,tour,name,location,country,category,draw_size,surface,start_date,status,champion_player_id,official_url,logo_url) VALUES(${t.key},${tour},${t.name},${t.location},${t.country},${t.category},${t.drawSize},${t.surface},${t.startDate},${t.status},${championId},${t.officialUrl},${logoUrl}) RETURNING id`;
      // Backfilling past seasons shouldn't spam the forum with a "Tournament Discussion" thread
      // for every historical event — only the live sync (current season) creates one.
      if (createDiscussion) {
        const cat = (await sql`SELECT id FROM categories WHERE slug='tournaments' LIMIT 1`)[0];
        const topic = await sql`INSERT INTO topics(category_id,title,slug,body,pinned) VALUES(${cat?.id ?? null},${`🏆 ${t.name} — Tournament Discussion`},${`tournament-${t.key}`},${`Community discussion for ${t.name}.\n\n${t.location}, ${t.country} · ${t.category} · ${t.surface}\n\n**Status:** ${t.status}\n\n[View the WTSL tournament page](${t.officialUrl})`},${t.status==='ongoing'}) RETURNING id`;
        await sql`UPDATE tournaments SET discussion_topic_id=${topic[0].id} WHERE id=${inserted[0].id}`;
      }
      created++;
    }
  }
  return { tour, year: year ?? 'current', seen: tournaments.length, created, updated };
}

/** One-time backfill of past tournament seasons (the site's calendar supports a `year=` filter
 * going back to 2022). Safe to re-run — syncTournaments upserts by the tournament's own stable
 * key, so already-imported events are just refreshed, not duplicated. */
export async function backfillTournamentHistory(tour: TourCode = DEFAULT_TOUR) {
  const results = [];
  for (const year of HISTORICAL_TOURNAMENT_YEARS) {
    try { results.push(await syncTournaments(tour, { year, createDiscussion: false })); }
    catch (e) { results.push({ tour, year, error: e instanceof Error ? e.message : 'Sync failed' }); }
  }
  return results;
}

export async function syncTournamentsAllTours() {
  const results = [];
  for (const t of TOURS) {
    try { results.push(await syncTournaments(t.code)); }
    catch (e) { results.push({ tour: t.code, error: e instanceof Error ? e.message : 'Sync failed' }); }
  }
  return results;
}

export async function getTournaments(tour: TourCode = DEFAULT_TOUR, status?:string) {
  if(status) return sql`SELECT * FROM tournaments WHERE tour=${tour} AND status=${status} ORDER BY start_date DESC NULLS LAST,name`;
  return sql`SELECT * FROM tournaments WHERE tour=${tour} ORDER BY CASE status WHEN 'ongoing' THEN 0 WHEN 'upcoming' THEN 1 WHEN 'completed' THEN 2 ELSE 3 END,start_date DESC NULLS LAST`;
}
export async function getTournament(slug:string) { const r=await sql`SELECT * FROM tournaments WHERE wtsl_tournament_key=${slug} LIMIT 1`; return r[0] ?? null; }

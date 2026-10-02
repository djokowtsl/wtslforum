import { sql } from './db';

export type BotRating = 'serve' | 'return' | 'pressure';
export type BotRatingRow = { player: string; playerId: string; matches: number; value: number };

const labels: Record<BotRating, string> = {
  serve: 'Serve (Overall)',
  return: 'Return (Overall)',
  pressure: 'Under Pressure',
};

async function ensureTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS bot_rating_leaderboards (
      tour TEXT NOT NULL,
      player_name TEXT NOT NULL,
      screenshots INT NOT NULL,
      serve NUMERIC,
      return_rating NUMERIC,
      pressure NUMERIC,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (tour, player_name)
    )
  `;
}

export async function replaceBotRatingLeaderboard(tour: string, rows: Array<{ player: string; matches: number; ratings: Record<string, unknown> }>) {
  await ensureTable();
  await sql`DELETE FROM bot_rating_leaderboards WHERE tour=${tour}`;
  let stored = 0;
  for (const row of rows) {
    const name = String(row.player ?? '').trim();
    const screenshots = Number(row.matches);
    if (!name || !Number.isInteger(screenshots) || screenshots < 0) continue;
    const value = (rating: BotRating) => {
      const number = Number(row.ratings?.[labels[rating]]);
      return Number.isFinite(number) ? number : null;
    };
    await sql`
      INSERT INTO bot_rating_leaderboards(tour,player_name,screenshots,serve,return_rating,pressure,updated_at)
      VALUES(${tour},${name},${screenshots},${value('serve')},${value('return')},${value('pressure')},NOW())
    `;
    stored++;
  }
  return { stored };
}

export async function botRatingLeaderboard(tour: string, metric: BotRating): Promise<BotRatingRow[]> {
  await ensureTable();
  const rows = metric === 'serve'
    ? await sql`SELECT b.player_name AS player, COALESCE(p.wtsl_player_id, b.player_name) AS "playerId", b.screenshots AS matches, b.serve AS value FROM bot_rating_leaderboards b LEFT JOIN wtsl_players p ON p.tour=b.tour AND lower(p.name)=lower(b.player_name) WHERE b.tour=${tour} AND b.serve IS NOT NULL ORDER BY b.serve DESC, b.player_name ASC`
    : metric === 'return'
      ? await sql`SELECT b.player_name AS player, COALESCE(p.wtsl_player_id, b.player_name) AS "playerId", b.screenshots AS matches, b.return_rating AS value FROM bot_rating_leaderboards b LEFT JOIN wtsl_players p ON p.tour=b.tour AND lower(p.name)=lower(b.player_name) WHERE b.tour=${tour} AND b.return_rating IS NOT NULL ORDER BY b.return_rating DESC, b.player_name ASC`
      : await sql`SELECT b.player_name AS player, COALESCE(p.wtsl_player_id, b.player_name) AS "playerId", b.screenshots AS matches, b.pressure AS value FROM bot_rating_leaderboards b LEFT JOIN wtsl_players p ON p.tour=b.tour AND lower(p.name)=lower(b.player_name) WHERE b.tour=${tour} AND b.pressure IS NOT NULL ORDER BY b.pressure DESC, b.player_name ASC`;
  return rows.map((row: any) => ({ player: row.player, playerId: String(row.playerId), matches: Number(row.matches), value: Number(row.value) }));
}

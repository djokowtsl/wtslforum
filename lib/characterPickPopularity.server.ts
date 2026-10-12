import { dbConfigured, sql } from '@/lib/db';
import {
  rankCharacterPickCounts,
  type CharacterPickCount,
  type CharacterPickRanking,
} from '@/lib/characterPickPopularity';

/**
 * The Forum's pick table mirrors the official ATP all-results feed. WTSL does
 * not publish equivalent WTA, doubles, or created-character pick history.
 */
export async function getCharacterPickRanking(
  character: string,
  expectedPicks: number,
): Promise<CharacterPickRanking | null> {
  if (!dbConfigured() || !character || expectedPicks <= 0) return null;

  const rows = await sql`
    SELECT MIN(BTRIM(character)) AS character, SUM(picks)::text AS picks
    FROM player_character_usage
    WHERE tour = 'TE4' AND picks > 0
    GROUP BY LOWER(BTRIM(character))
  `;
  return rankCharacterPickCounts(rows as CharacterPickCount[], character, expectedPicks);
}

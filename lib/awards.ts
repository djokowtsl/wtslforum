import { sql } from './db';

export async function getActiveCycle() {
  const rows = await sql`SELECT * FROM award_cycles ORDER BY created_at DESC LIMIT 1`;
  return rows[0] ?? null;
}

export async function getCategories(cycleId: number) {
  return sql`SELECT * FROM award_categories WHERE cycle_id=${cycleId} ORDER BY position,name`;
}

export async function getNominees(categoryId: number) {
  return sql`SELECT * FROM award_nominees WHERE category_id=${categoryId} ORDER BY position,name`;
}

export async function getNomineesForCategories(categoryIds: number[]) {
  if (!categoryIds.length) return [];
  return sql`SELECT * FROM award_nominees WHERE category_id = ANY(${categoryIds}) ORDER BY position,name`;
}

export async function getTally(categoryId: number) {
  return sql`
    SELECT n.id nominee_id, n.name, COUNT(v.id)::int votes
    FROM award_nominees n
    LEFT JOIN award_votes v ON v.nominee_id = n.id AND v.category_id = ${categoryId}
    WHERE n.category_id = ${categoryId}
    GROUP BY n.id, n.name
    ORDER BY votes DESC, n.name
  `;
}

export async function getWriteInTally(categoryId: number) {
  return sql`
    SELECT write_in, COUNT(*)::int votes
    FROM award_votes
    WHERE category_id=${categoryId} AND nominee_id IS NULL AND write_in IS NOT NULL AND write_in <> ''
    GROUP BY write_in
    ORDER BY votes DESC
  `;
}

export async function getUserVotes(cycleId: number, voterKey: string) {
  return sql`
    SELECT v.category_id, v.nominee_id, v.write_in
    FROM award_votes v
    JOIN award_categories c ON c.id = v.category_id
    WHERE c.cycle_id = ${cycleId} AND v.source = 'site' AND v.voter_key = ${voterKey}
  `;
}

export async function castVote(categoryId: number, voterKey: string, nomineeId: number | null, writeIn: string | null) {
  return sql`
    INSERT INTO award_votes(category_id,source,voter_key,nominee_id,write_in)
    VALUES (${categoryId},'site',${voterKey},${nomineeId},${writeIn})
    ON CONFLICT (category_id,source,voter_key)
    DO UPDATE SET nominee_id=EXCLUDED.nominee_id, write_in=EXCLUDED.write_in, created_at=NOW()
  `;
}

export async function setVotingOpen(cycleId: number, open: boolean) {
  return sql`UPDATE award_cycles SET voting_open=${open} WHERE id=${cycleId}`;
}

export async function addNominee(categoryId: number, name: string, note: string) {
  const rows = await sql`INSERT INTO award_nominees(category_id,name,note) VALUES (${categoryId},${name},${note}) RETURNING *`;
  return rows[0];
}

export async function removeNominee(nomineeId: number) {
  return sql`DELETE FROM award_nominees WHERE id=${nomineeId}`;
}

/** Imports rows exported from the linked Google Form: one vote per (category, voter) pair, source='google_form'. */
export async function importGoogleFormVotes(categoryId: number, rows: { voterKey: string; nomineeId?: number | null; writeIn?: string | null }[]) {
  let imported = 0;
  for (const r of rows) {
    if (!r.voterKey) continue;
    await sql`
      INSERT INTO award_votes(category_id,source,voter_key,nominee_id,write_in)
      VALUES (${categoryId},'google_form',${r.voterKey},${r.nomineeId ?? null},${r.writeIn ?? null})
      ON CONFLICT (category_id,source,voter_key)
      DO UPDATE SET nominee_id=EXCLUDED.nominee_id, write_in=EXCLUDED.write_in
    `;
    imported++;
  }
  return imported;
}

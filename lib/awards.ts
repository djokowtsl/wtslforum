import { sql } from './db';
import type { GoogleFormOptionQuestion } from './googleFormOptions';
import { findRenamedAwardOptions } from './awardOptionMatching';
import type { AwardVoteSheetRow } from './awardVoteSheetSync';

export async function getActiveCycle() {
  await closeExpiredAwardCycles();
  const rows = await sql`SELECT * FROM award_cycles ORDER BY created_at DESC LIMIT 1`;
  return rows[0] ?? null;
}

export async function closeExpiredAwardCycles() {
  return sql`
    UPDATE award_cycles
    SET voting_open=FALSE
    WHERE voting_open=TRUE
      AND voting_closes_at IS NOT NULL
      AND voting_closes_at <= NOW()
  `;
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

export async function getUserVotes(cycleId: number, voterKey: string) {
  return sql`
    SELECT v.category_id, v.nominee_id, v.write_in
    FROM award_votes v
    JOIN award_categories c ON c.id = v.category_id
    WHERE c.cycle_id = ${cycleId} AND v.source = 'site' AND v.voter_key = ${voterKey}
  `;
}

export async function castVote(categoryId: number, voterKey: string, nomineeId: number | null, writeIn: string | null): Promise<AwardVoteSheetRow | null> {
  const rows = await sql`
    WITH active_category AS (
      SELECT category.id
      FROM award_categories AS category
      JOIN award_cycles AS cycle ON cycle.id=category.cycle_id
      WHERE category.id=${categoryId}
        AND cycle.voting_open=TRUE
        AND (cycle.voting_closes_at IS NULL OR cycle.voting_closes_at > CLOCK_TIMESTAMP())
    ),
    saved_vote AS (
      INSERT INTO award_votes(category_id,source,voter_key,nominee_id,write_in)
      SELECT active_category.id,'site',${voterKey},${nomineeId},${writeIn}
      FROM active_category
      ON CONFLICT (category_id,source,voter_key)
      DO UPDATE SET nominee_id=EXCLUDED.nominee_id, write_in=EXCLUDED.write_in, created_at=CLOCK_TIMESTAMP()
      RETURNING id, category_id, nominee_id, write_in, created_at
    )
    SELECT
      saved_vote.id::text AS "voteId",
      cycle.season,
      category.name AS category,
      nominee.name AS nominee,
      saved_vote.write_in AS "writeIn",
      to_char(saved_vote.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "castAt"
    FROM saved_vote
    JOIN award_categories AS category ON category.id=saved_vote.category_id
    JOIN award_cycles AS cycle ON cycle.id=category.cycle_id
    LEFT JOIN award_nominees AS nominee ON nominee.id=saved_vote.nominee_id
  `;
  return (rows[0] as unknown as AwardVoteSheetRow | undefined) ?? null;
}

export async function getSiteAwardVotesForCycle(cycleId: number, afterVoteId: string, limit = 100): Promise<AwardVoteSheetRow[]> {
  const rows = await sql`
    SELECT
      vote.id::text AS "voteId",
      cycle.season,
      category.name AS category,
      nominee.name AS nominee,
      vote.write_in AS "writeIn",
      to_char(vote.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "castAt"
    FROM award_votes AS vote
    JOIN award_categories AS category ON category.id=vote.category_id
    JOIN award_cycles AS cycle ON cycle.id=category.cycle_id
    LEFT JOIN award_nominees AS nominee ON nominee.id=vote.nominee_id
    WHERE category.cycle_id=${cycleId}
      AND vote.source='site'
      AND vote.id > ${afterVoteId}::bigint
    ORDER BY vote.id
    LIMIT ${limit}
  `;
  return rows as unknown as AwardVoteSheetRow[];
}

export async function setVotingOpen(cycleId: number, open: boolean) {
  const rows = open
    ? await sql`
        UPDATE award_cycles
        SET voting_open=TRUE
        WHERE id=${cycleId}
          AND (voting_closes_at IS NULL OR voting_closes_at > NOW())
        RETURNING id
      `
    : await sql`
        UPDATE award_cycles
        SET voting_open=FALSE
        WHERE id=${cycleId}
        RETURNING id
      `;
  return rows[0] ?? null;
}

export async function setVotingClosesAt(cycleId: number, closesAt: string | null) {
  const rows = await sql`
    UPDATE award_cycles
    SET voting_closes_at=${closesAt}::timestamptz,
        voting_open=CASE
          WHEN ${closesAt}::timestamptz IS NOT NULL
            AND ${closesAt}::timestamptz <= NOW()
          THEN FALSE
          ELSE voting_open
        END
    WHERE id=${cycleId}
    RETURNING id, voting_open, voting_closes_at
  `;
  return rows[0] ?? null;
}

export async function setCategoryShuffleOverride(cycleId: number, categoryId: number, shuffleOptions: boolean | null) {
  const rows = await sql`
    UPDATE award_categories
    SET shuffle_options_override=${shuffleOptions}
    WHERE cycle_id=${cycleId} AND id=${categoryId}
    RETURNING id
  `;
  return rows[0] ?? null;
}

export async function addNominee(categoryId: number, name: string, note: string) {
  const rows = await sql`INSERT INTO award_nominees(category_id,name,note) VALUES (${categoryId},${name},${note}) RETURNING *`;
  return rows[0];
}

export async function removeNominee(nomineeId: number) {
  return sql`DELETE FROM award_nominees WHERE id=${nomineeId}`;
}

/** Adds Google Form choices to a Forum voting cycle without deleting existing options or votes. */
export async function importGoogleFormOptions(cycleId: number, questions: GoogleFormOptionQuestion[]) {
  let optionsAdded = 0;
  let optionsAlreadyPresent = 0;
  const renamedOptions: { category: string; from: string; to: string }[] = [];

  for (const [categoryPosition, question] of questions.entries()) {
    const categoryRows = await sql`
      INSERT INTO award_categories(cycle_id,name,slug,position,allow_write_in,shuffle_options,is_required)
      VALUES (${cycleId},${question.title},${question.slug},${categoryPosition + 1},${question.allowWriteIn},${question.shuffleOptions},${question.isRequired})
      ON CONFLICT (cycle_id,slug)
      DO UPDATE SET
        position=EXCLUDED.position,
        allow_write_in=EXCLUDED.allow_write_in,
        shuffle_options=EXCLUDED.shuffle_options,
        is_required=EXCLUDED.is_required
      RETURNING id
    `;
    const categoryId = categoryRows[0]?.id;
    if (!categoryId) throw new Error(`Could not create the “${question.title}” award category.`);

    const existingNominees = await sql`
      SELECT id, name
      FROM award_nominees
      WHERE category_id=${categoryId}
      ORDER BY position, id
    `;
    const renames = findRenamedAwardOptions(
      existingNominees as { id: number | string; name: string }[],
      question.options,
    );
    for (const rename of renames) {
      await sql`
        UPDATE award_nominees
        SET name=${rename.to}, position=${rename.position}
        WHERE id=${rename.id} AND category_id=${categoryId}
      `;
      renamedOptions.push({ category: question.title, from: rename.from, to: rename.to });
    }

    const optionsJson = JSON.stringify(question.options.map((name, index) => ({
      name,
      position: index + 1,
    })));
    const rows = await sql`
      WITH incoming AS (
        SELECT name, position::int
        FROM jsonb_to_recordset(${optionsJson}::jsonb) AS choice(name text, position int)
      ),
      updated AS (
        UPDATE award_nominees AS existing
        SET position=incoming.position
        FROM incoming
        WHERE existing.category_id=${categoryId}
          AND lower(trim(existing.name))=lower(trim(incoming.name))
        RETURNING existing.id
      ),
      inserted AS (
        INSERT INTO award_nominees(category_id,name,note,position)
        SELECT ${categoryId},incoming.name,'',incoming.position
        FROM incoming
        WHERE NOT EXISTS (
          SELECT 1 FROM award_nominees AS existing
          WHERE existing.category_id=${categoryId}
            AND lower(trim(existing.name))=lower(trim(incoming.name))
        )
        RETURNING id
      )
      SELECT COUNT(*)::int AS added FROM inserted
    `;
    const added = Number(rows[0]?.added ?? 0);
    optionsAdded += added;
    optionsAlreadyPresent += question.options.length - added;
  }

  return {
    categoriesImported: questions.length,
    optionsAdded,
    optionsAlreadyPresent,
    shuffleCategoriesImported: questions.filter((question) => question.shuffleOptions).length,
    requiredQuestionsImported: questions.filter((question) => question.isRequired).length,
    optionalQuestionsImported: questions.filter((question) => !question.isRequired).length,
    renamedOptions,
  };
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

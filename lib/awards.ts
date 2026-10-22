import { sql } from './db';
import type { GoogleFormOptionQuestion } from './googleFormOptions';
import { findRenamedAwardOptions } from './awardOptionMatching';
import type { AwardFormBallot, AwardFormAnswer } from './awardVoteFormSync';

export type SiteAwardBallot = AwardFormBallot & {
  syncCursor: string;
  isComplete: boolean;
  responseFingerprint: string | null;
  responseUpdatedAt: string | null;
};

type AwardBallotRow = {
  voterKey: string;
  syncCursor: string;
  season: string;
  category: string;
  questionId: string | null;
  isRequired: boolean;
  answer: string | null;
  updatedAt: string | null;
  previousResponseId: string | null;
  responseFingerprint: string | null;
  responseUpdatedAt: string | null;
};

function groupAwardBallotRows(rows: AwardBallotRow[]): SiteAwardBallot[] {
  const byVoter = new Map<string, SiteAwardBallot>();
  const requiredMissing = new Set<string>();

  for (const row of rows) {
    let ballot = byVoter.get(row.voterKey);
    if (!ballot) {
      ballot = {
        voterKey: row.voterKey,
        season: row.season,
        updatedAt: row.updatedAt ?? '',
        answers: [],
        previousResponseId: row.previousResponseId,
        previousResponseFingerprint: row.responseFingerprint,
        previousResponseUpdatedAt: row.responseUpdatedAt,
        responseFingerprint: row.responseFingerprint,
        responseUpdatedAt: row.responseUpdatedAt,
        syncCursor: row.syncCursor,
        isComplete: true,
      };
      byVoter.set(row.voterKey, ballot);
    }
    if (row.isRequired && !row.answer) requiredMissing.add(row.voterKey);
    if (row.answer) ballot.answers.push({ category: row.category, answer: row.answer, questionId: row.questionId });
    if (row.updatedAt && row.updatedAt > ballot.updatedAt) ballot.updatedAt = row.updatedAt;
  }

  return Array.from(byVoter.values(), (ballot) => ({
    ...ballot,
    isComplete: ballot.isComplete && !requiredMissing.has(ballot.voterKey) && ballot.answers.length > 0,
  }));
}

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

export async function getSiteAwardBallot(cycleId: number, voterKey: string): Promise<SiteAwardBallot | null> {
  const rows = await sql`
    SELECT
      vote.voter_key AS "voterKey",
      MIN(vote.id) OVER (PARTITION BY vote.voter_key)::text AS "syncCursor",
      cycle.season,
      category.name AS category,
      category.form_question_id AS "questionId",
      category.is_required AS "isRequired",
      COALESCE(nominee.name, NULLIF(vote.write_in, '')) AS answer,
      to_char(MAX(vote.created_at) OVER (PARTITION BY vote.voter_key) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAt",
      response_state.response_id AS "previousResponseId",
      response_state.response_fingerprint AS "responseFingerprint",
      to_char(response_state.response_updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "responseUpdatedAt"
    FROM award_votes AS vote
    JOIN award_categories AS category ON category.id=vote.category_id
    JOIN award_cycles AS cycle ON cycle.id=category.cycle_id
    LEFT JOIN award_nominees AS nominee ON nominee.id=vote.nominee_id
    LEFT JOIN award_form_response_state AS response_state
      ON response_state.cycle_id=cycle.id AND response_state.voter_key=vote.voter_key
    WHERE category.cycle_id=${cycleId}
      AND vote.source='site'
      AND vote.voter_key=${voterKey}
    ORDER BY category.position, category.name
  `;
  const ballots = groupAwardBallotRows(rows as unknown as AwardBallotRow[]);
  return ballots[0] ?? null;
}

export async function getSiteAwardBallotBatch(cycleId: number, afterCursor: string, limit = 20): Promise<SiteAwardBallot[]> {
  const rows = await sql`
    WITH voter_cursors AS (
      SELECT vote.voter_key, MIN(vote.id) AS sync_cursor
      FROM award_votes AS vote
      JOIN award_categories AS category ON category.id=vote.category_id
      WHERE category.cycle_id=${cycleId} AND vote.source='site'
      GROUP BY vote.voter_key
    ),
    voter_page AS (
      SELECT voter_key, sync_cursor
      FROM voter_cursors
      WHERE sync_cursor > ${afterCursor}::bigint
      ORDER BY sync_cursor
      LIMIT ${limit}
    )
    SELECT
      voter_page.voter_key AS "voterKey",
      voter_page.sync_cursor::text AS "syncCursor",
      cycle.season,
      category.name AS category,
      category.form_question_id AS "questionId",
      category.is_required AS "isRequired",
      COALESCE(nominee.name, NULLIF(vote.write_in, '')) AS answer,
      to_char(MAX(vote.created_at) OVER (PARTITION BY voter_page.voter_key) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAt",
      response_state.response_id AS "previousResponseId",
      response_state.response_fingerprint AS "responseFingerprint",
      to_char(response_state.response_updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "responseUpdatedAt"
    FROM voter_page
    JOIN award_cycles AS cycle ON cycle.id=${cycleId}
    JOIN award_categories AS category ON category.cycle_id=cycle.id
    LEFT JOIN award_votes AS vote
      ON vote.category_id=category.id AND vote.source='site' AND vote.voter_key=voter_page.voter_key
    LEFT JOIN award_nominees AS nominee ON nominee.id=vote.nominee_id
    LEFT JOIN award_form_response_state AS response_state
      ON response_state.cycle_id=cycle.id AND response_state.voter_key=voter_page.voter_key
    ORDER BY voter_page.sync_cursor, category.position, category.name
  `;
  return groupAwardBallotRows(rows as unknown as AwardBallotRow[]);
}

export async function saveAwardFormResponseState(cycleId: number, voterKey: string, responseId: string, fingerprint: string, updatedAt: string) {
  return sql`
    INSERT INTO award_form_response_state (
      cycle_id, voter_key, response_id, response_fingerprint, response_updated_at, synced_at
    )
    VALUES (${cycleId}, ${voterKey}, ${responseId}, ${fingerprint}, ${updatedAt}::timestamptz, NOW())
    ON CONFLICT (cycle_id, voter_key)
    DO UPDATE SET
      response_id=EXCLUDED.response_id,
      response_fingerprint=EXCLUDED.response_fingerprint,
      response_updated_at=EXCLUDED.response_updated_at,
      synced_at=NOW()
    WHERE award_form_response_state.response_updated_at <= EXCLUDED.response_updated_at
    RETURNING response_id
  `;
}

export async function castVote(categoryId: number, voterKey: string, nomineeId: number | null, writeIn: string | null): Promise<{ voteId: string } | null> {
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
      saved_vote.id::text AS "voteId"
    FROM saved_vote
  `;
  return (rows[0] as { voteId: string } | undefined) ?? null;
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
      INSERT INTO award_categories(cycle_id,name,slug,position,allow_write_in,shuffle_options,is_required,form_question_id)
      VALUES (${cycleId},${question.title},${question.slug},${categoryPosition + 1},${question.allowWriteIn},${question.shuffleOptions},${question.isRequired},${question.questionId})
      ON CONFLICT (cycle_id,slug)
      DO UPDATE SET
        name=EXCLUDED.name,
        position=EXCLUDED.position,
        allow_write_in=EXCLUDED.allow_write_in,
        shuffle_options=EXCLUDED.shuffle_options,
        is_required=EXCLUDED.is_required,
        form_question_id=COALESCE(EXCLUDED.form_question_id, award_categories.form_question_id)
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

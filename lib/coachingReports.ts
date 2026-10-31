import { sql } from './db';

export type PublicCoachingReport = {
  id: string;
  title: string;
  tournament: string;
  round_name: string;
  player1: string;
  player2: string;
  score: string;
  published_at: string | Date;
};

export type AdminCoachingReport = PublicCoachingReport & {
  submitter_consent: boolean;
  player1_consent: boolean;
  player2_consent: boolean;
  review_confirmed: boolean;
  submitter_consent_reference: string;
  player1_consent_reference: string;
  player2_consent_reference: string;
  consent_recorded_by_discord_id: string;
  consent_recorded_at: string | Date;
  reviewed_by_discord_id: string;
  reviewed_at: string | Date;
  unpublished_at: string | Date | null;
  unpublished_by_discord_id: string | null;
};

export async function getPublishedCoachingReports(limit = 50): Promise<PublicCoachingReport[]> {
  const boundedLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
  return sql`
    SELECT id::text, title, tournament, round_name, player1, player2, score, published_at
    FROM coaching_reports
    WHERE submitter_consent IS TRUE
      AND player1_consent IS TRUE
      AND player2_consent IS TRUE
      AND review_confirmed IS TRUE
      AND unpublished_at IS NULL
      AND replay_pathname IS NOT NULL
    ORDER BY published_at DESC, id DESC
    LIMIT ${boundedLimit}
  ` as Promise<PublicCoachingReport[]>;
}

export async function getPublishedCoachingReport(id: string): Promise<PublicCoachingReport | null> {
  const rows = await sql`
    SELECT id::text, title, tournament, round_name, player1, player2, score, published_at
    FROM coaching_reports
    WHERE id=${id}::uuid
      AND submitter_consent IS TRUE
      AND player1_consent IS TRUE
      AND player2_consent IS TRUE
      AND review_confirmed IS TRUE
      AND unpublished_at IS NULL
      AND replay_pathname IS NOT NULL
    LIMIT 1
  `;
  return rows[0] ? rows[0] as PublicCoachingReport : null;
}

export async function getPublishedCoachingReplayPath(id: string): Promise<string | null> {
  const rows = await sql`
    SELECT replay_pathname
    FROM coaching_reports
    WHERE id=${id}::uuid
      AND submitter_consent IS TRUE
      AND player1_consent IS TRUE
      AND player2_consent IS TRUE
      AND review_confirmed IS TRUE
      AND unpublished_at IS NULL
      AND replay_pathname IS NOT NULL
    LIMIT 1
  `;
  return typeof rows[0]?.replay_pathname === 'string' ? rows[0].replay_pathname : null;
}

export async function getAdminCoachingReports(): Promise<AdminCoachingReport[]> {
  return sql`
    SELECT
      id::text, title, tournament, round_name, player1, player2, score, published_at,
      submitter_consent, player1_consent, player2_consent, review_confirmed,
      submitter_consent_reference, player1_consent_reference, player2_consent_reference,
      consent_recorded_by_discord_id, consent_recorded_at,
      reviewed_by_discord_id, reviewed_at, unpublished_at, unpublished_by_discord_id
    FROM coaching_reports
    ORDER BY published_at DESC, id DESC
    LIMIT 200
  ` as Promise<AdminCoachingReport[]>;
}

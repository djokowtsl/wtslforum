import { sql } from '@/lib/db';
import type { DmoBackhandType, DmoPlayingHand } from '@/lib/dmoSubmissionPlayerStyle';

export type DmoSubmissionSource = 'discord' | 'forum';
export type DmoDiscordDeliveryStatus = 'pending' | 'sent' | 'failed';

export type DmoSubmission = {
  id: number | string;
  submitted_by: number | string | null;
  submitter_discord_id: string | null;
  submitter_name: string;
  source: DmoSubmissionSource;
  tournament: string;
  round_name: string;
  player1: string;
  player2: string;
  player1_character: string | null;
  player2_character: string | null;
  player1_handedness: DmoPlayingHand | null;
  player2_handedness: DmoPlayingHand | null;
  player1_backhand_type: DmoBackhandType | null;
  player2_backhand_type: DmoBackhandType | null;
  hidden_at: string | Date | null;
  hidden_by: string | null;
  file_name: string | null;
  public_share_consent: boolean;
  coach_group_share_consent: boolean;
  coach_share_url: string | null;
  private_blob_pathname: string | null;
  private_blob_content_type: string | null;
  external_url: string | null;
  source_discord_channel_id: string | null;
  source_discord_message_id: string | null;
  submission_thread_id: string | null;
  discord_message_id: string | null;
  discord_delivery_status: DmoDiscordDeliveryStatus;
  discord_delivery_error: string | null;
  submission_date: string | Date;
  created_at: string | Date;
  account_name?: string | null;
  public_replay_override_active?: boolean;
};

export type NewDmoSubmission = {
  submittedBy: number | null;
  submitterDiscordId: string | null;
  submitterName: string;
  source: DmoSubmissionSource;
  tournament: string;
  roundName: string;
  player1: string;
  player2: string;
  player1Character?: string | null;
  player2Character?: string | null;
  player1Handedness?: DmoPlayingHand | null;
  player2Handedness?: DmoPlayingHand | null;
  player1BackhandType?: DmoBackhandType | null;
  player2BackhandType?: DmoBackhandType | null;
  fileName?: string | null;
  publicShareConsent?: boolean;
  coachGroupShareConsent?: boolean;
  coachShareUrl?: string | null;
  privateBlobPathname?: string | null;
  privateBlobContentType?: string | null;
  externalUrl?: string | null;
  sourceDiscordChannelId?: string | null;
  sourceDiscordMessageId?: string | null;
  submissionThreadId?: string | null;
  discordMessageId?: string | null;
  discordDeliveryStatus?: DmoDiscordDeliveryStatus;
  submissionDate?: string | null;
};

export type DmoSubmissionTags = {
  tournament: string;
  roundName: string;
  player1: string;
  player2: string;
  submissionDate: string;
  coachShareUrl?: string | null;
  resetCoachGroupConsent?: boolean;
};

export function submissionDateInLondon(timestamp: unknown): string | null {
  const date = new Date(String(timestamp ?? ''));
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

let schemaReady: Promise<void> | null = null;

export async function ensureDmoSubmissionSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS dmo_submissions (
          id BIGSERIAL PRIMARY KEY,
          submitted_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
          submitter_discord_id TEXT,
          submitter_name TEXT NOT NULL,
          source TEXT NOT NULL CHECK (source IN ('discord','forum')),
          tournament TEXT NOT NULL,
          round_name TEXT NOT NULL,
          player1 TEXT NOT NULL,
          player2 TEXT NOT NULL,
          player1_character TEXT,
          player2_character TEXT,
          player1_handedness TEXT CHECK (player1_handedness IS NULL OR player1_handedness IN ('left','right')),
          player2_handedness TEXT CHECK (player2_handedness IS NULL OR player2_handedness IN ('left','right')),
          player1_backhand_type TEXT CHECK (player1_backhand_type IS NULL OR player1_backhand_type IN ('one-handed','two-handed')),
          player2_backhand_type TEXT CHECK (player2_backhand_type IS NULL OR player2_backhand_type IN ('one-handed','two-handed')),
          hidden_at TIMESTAMPTZ,
          hidden_by TEXT,
          file_name TEXT,
          public_share_consent BOOLEAN NOT NULL DEFAULT FALSE,
          coach_group_share_consent BOOLEAN NOT NULL DEFAULT FALSE,
          coach_share_url TEXT,
          private_blob_pathname TEXT,
          private_blob_content_type TEXT,
          external_url TEXT,
          source_discord_channel_id TEXT,
          source_discord_message_id TEXT,
          submission_thread_id TEXT,
          discord_message_id TEXT,
          discord_delivery_status TEXT NOT NULL DEFAULT 'pending'
            CHECK (discord_delivery_status IN ('pending','sent','failed')),
          discord_delivery_error TEXT,
          submission_date DATE NOT NULL DEFAULT CURRENT_DATE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT dmo_submissions_discord_source_unique
            UNIQUE (source_discord_channel_id, source_discord_message_id)
        )
      `;
      await sql`
        ALTER TABLE dmo_submissions
        ADD COLUMN IF NOT EXISTS public_share_consent BOOLEAN NOT NULL DEFAULT FALSE
      `;
      await sql`
        ALTER TABLE dmo_submissions
        ADD COLUMN IF NOT EXISTS coach_share_url TEXT
      `;
      await sql`
        ALTER TABLE dmo_submissions
        ADD COLUMN IF NOT EXISTS submission_date DATE
      `;
      await sql`
        UPDATE dmo_submissions
        SET submission_date=(created_at AT TIME ZONE 'Europe/London')::date
        WHERE submission_date IS NULL
      `;
      await sql`
        ALTER TABLE dmo_submissions
        ALTER COLUMN submission_date SET DEFAULT CURRENT_DATE
      `;
      await sql`
        ALTER TABLE dmo_submissions
        ALTER COLUMN submission_date SET NOT NULL
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS dmo_submissions_created_idx
        ON dmo_submissions(created_at DESC)
      `;
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
}

export async function findDmoSubmissionByDiscordMessage(
  channelId: string,
  messageId: string,
): Promise<DmoSubmission | null> {
  await ensureDmoSubmissionSchema();
  const rows = await sql`
    SELECT * FROM dmo_submissions
    WHERE source_discord_channel_id=${channelId}
      AND source_discord_message_id=${messageId}
    LIMIT 1
  `;
  return (rows[0] as DmoSubmission | undefined) ?? null;
}

export async function createDmoSubmission(
  input: NewDmoSubmission,
): Promise<DmoSubmission> {
  await ensureDmoSubmissionSchema();
  const rows = await sql`
    INSERT INTO dmo_submissions (
      submitted_by,submitter_discord_id,submitter_name,source,tournament,round_name,
      player1,player2,player1_character,player2_character,
      player1_handedness,player2_handedness,player1_backhand_type,player2_backhand_type,
      file_name,public_share_consent,coach_group_share_consent,
      coach_share_url,private_blob_pathname,private_blob_content_type,external_url,
      source_discord_channel_id,source_discord_message_id,
      submission_thread_id,discord_message_id,discord_delivery_status,submission_date
    ) VALUES (
      ${input.submittedBy},${input.submitterDiscordId},${input.submitterName},
      ${input.source},${input.tournament},${input.roundName},${input.player1},
      ${input.player2},${input.player1Character ?? null},${input.player2Character ?? null},
      ${input.player1Handedness ?? null},${input.player2Handedness ?? null},
      ${input.player1BackhandType ?? null},${input.player2BackhandType ?? null},
      ${input.fileName ?? null},${input.publicShareConsent ?? false},
      ${input.coachGroupShareConsent ?? false},${input.coachShareUrl ?? null},
      ${input.privateBlobPathname ?? null},
      ${input.privateBlobContentType ?? null},${input.externalUrl ?? null},
      ${input.sourceDiscordChannelId ?? null},${input.sourceDiscordMessageId ?? null},
      ${input.submissionThreadId ?? null},${input.discordMessageId ?? null},
      ${input.discordDeliveryStatus ?? 'pending'},
      COALESCE(${input.submissionDate ?? null}::date, CURRENT_DATE)
    )
    ON CONFLICT (source_discord_channel_id,source_discord_message_id) DO NOTHING
    RETURNING *
  `;
  if (rows[0]) return rows[0] as DmoSubmission;

  const existing = await findDmoSubmissionByDiscordMessage(
    input.sourceDiscordChannelId || '',
    input.sourceDiscordMessageId || '',
  );
  if (existing) return existing;
  throw new Error('The DMO submission could not be saved.');
}

export async function setDmoSubmissionPublicShareConsent(input: {
  discordChannelId: string;
  discordMessageId: string;
  submitterDiscordId: string;
  coachGroupShareConsent: boolean;
  coachShareUrl: string | null;
}): Promise<boolean> {
  await ensureDmoSubmissionSchema();
  const rows = await sql`
    UPDATE dmo_submissions
    SET public_share_consent=TRUE,
        coach_group_share_consent=(
          ${input.coachGroupShareConsent}
          AND coach_share_url IS NOT NULL
          AND coach_share_url=${input.coachShareUrl}
        )
    WHERE source='discord'
      AND source_discord_channel_id=${input.discordChannelId}
      AND source_discord_message_id=${input.discordMessageId}
      AND submitter_discord_id=${input.submitterDiscordId}
    RETURNING id
  `;
  return rows.length > 0;
}

export async function getDmoSubmission(id: number): Promise<DmoSubmission | null> {
  await ensureDmoSubmissionSchema();
  const rows = await sql`SELECT * FROM dmo_submissions WHERE id=${id} LIMIT 1`;
  return (rows[0] as DmoSubmission | undefined) ?? null;
}

export async function listDmoSubmissions(limit = 100): Promise<DmoSubmission[]> {
  await ensureDmoSubmissionSchema();
  const safeLimit = Math.max(1, Math.min(250, Math.floor(limit)));
  return await sql`
    SELECT s.*,COALESCE(u.display_name,s.submitter_name) AS account_name,
      EXISTS (
        SELECT 1
        FROM dmo_replay_publication_overrides AS publication_override
        WHERE publication_override.submission_id=s.id
          AND publication_override.revoked_at IS NULL
      ) AS public_replay_override_active
    FROM dmo_submissions s
    LEFT JOIN users u ON u.id=s.submitted_by
    ORDER BY s.created_at DESC
    LIMIT ${safeLimit}
  ` as DmoSubmission[];
}

export async function setDmoSubmissionHidden(input: {
  id: string;
  hidden: boolean;
  hiddenBy: string;
}): Promise<boolean> {
  await ensureDmoSubmissionSchema();
  const hiddenBy = input.hiddenBy.trim().slice(0, 100);
  if (input.hidden && !hiddenBy) return false;
  const rows = await sql`
    UPDATE dmo_submissions
    SET hidden_at=CASE
          WHEN ${input.hidden} THEN COALESCE(hidden_at,NOW())
          ELSE NULL
        END,
        hidden_by=CASE
          WHEN ${input.hidden} THEN COALESCE(hidden_by,${hiddenBy})
          ELSE NULL
        END
    WHERE id=${input.id}::bigint
    RETURNING id
  `;
  return rows.length > 0;
}

export async function updateDmoSubmissionTags(
  id: number,
  tags: DmoSubmissionTags,
): Promise<DmoSubmission | null> {
  await ensureDmoSubmissionSchema();
  const rows = await sql`
    UPDATE dmo_submissions
    SET tournament=${tags.tournament},
        round_name=${tags.roundName},
        player1=${tags.player1},
        player2=${tags.player2},
        submission_date=${tags.submissionDate}::date,
        coach_group_share_consent=CASE
          WHEN ${tags.resetCoachGroupConsent ?? false} THEN FALSE
          ELSE coach_group_share_consent
        END,
        coach_share_url=CASE
          WHEN ${tags.coachShareUrl !== undefined} THEN ${tags.coachShareUrl ?? null}
          ELSE coach_share_url
        END
    WHERE id=${id}
    RETURNING *
  `;
  return (rows[0] as DmoSubmission | undefined) ?? null;
}

export async function updateDmoDiscordDelivery(
  id: number,
  update: {
    status: DmoDiscordDeliveryStatus;
    messageId?: string | null;
    error?: string | null;
  },
) {
  await ensureDmoSubmissionSchema();
  await sql`
    UPDATE dmo_submissions
    SET discord_delivery_status=${update.status},
        discord_message_id=${update.messageId ?? null},
        discord_delivery_error=${update.error?.slice(0, 1000) ?? null}
    WHERE id=${id}
  `;
}

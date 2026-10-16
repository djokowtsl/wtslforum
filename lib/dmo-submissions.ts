import { sql } from '@/lib/db';

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
  file_name: string | null;
  private_blob_pathname: string | null;
  private_blob_content_type: string | null;
  external_url: string | null;
  source_discord_channel_id: string | null;
  source_discord_message_id: string | null;
  submission_thread_id: string | null;
  discord_message_id: string | null;
  discord_delivery_status: DmoDiscordDeliveryStatus;
  discord_delivery_error: string | null;
  created_at: string | Date;
  account_name?: string | null;
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
  fileName?: string | null;
  privateBlobPathname?: string | null;
  privateBlobContentType?: string | null;
  externalUrl?: string | null;
  sourceDiscordChannelId?: string | null;
  sourceDiscordMessageId?: string | null;
  submissionThreadId?: string | null;
  discordMessageId?: string | null;
  discordDeliveryStatus?: DmoDiscordDeliveryStatus;
};

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
          file_name TEXT,
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
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT dmo_submissions_discord_source_unique
            UNIQUE (source_discord_channel_id, source_discord_message_id)
        )
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
      player1,player2,file_name,private_blob_pathname,private_blob_content_type,
      external_url,source_discord_channel_id,source_discord_message_id,
      submission_thread_id,discord_message_id,discord_delivery_status
    ) VALUES (
      ${input.submittedBy},${input.submitterDiscordId},${input.submitterName},
      ${input.source},${input.tournament},${input.roundName},${input.player1},
      ${input.player2},${input.fileName ?? null},${input.privateBlobPathname ?? null},
      ${input.privateBlobContentType ?? null},${input.externalUrl ?? null},
      ${input.sourceDiscordChannelId ?? null},${input.sourceDiscordMessageId ?? null},
      ${input.submissionThreadId ?? null},${input.discordMessageId ?? null},
      ${input.discordDeliveryStatus ?? 'pending'}
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

export async function getDmoSubmission(id: number): Promise<DmoSubmission | null> {
  await ensureDmoSubmissionSchema();
  const rows = await sql`SELECT * FROM dmo_submissions WHERE id=${id} LIMIT 1`;
  return (rows[0] as DmoSubmission | undefined) ?? null;
}

export async function listDmoSubmissions(limit = 100): Promise<DmoSubmission[]> {
  await ensureDmoSubmissionSchema();
  const safeLimit = Math.max(1, Math.min(250, Math.floor(limit)));
  return await sql`
    SELECT s.*,COALESCE(u.display_name,s.submitter_name) AS account_name
    FROM dmo_submissions s
    LEFT JOIN users u ON u.id=s.submitted_by
    ORDER BY s.created_at DESC
    LIMIT ${safeLimit}
  ` as DmoSubmission[];
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

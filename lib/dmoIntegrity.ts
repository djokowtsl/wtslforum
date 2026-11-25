import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { get } from '@vercel/blob';
import { sql } from '@/lib/db';
import { getDmoSubmission, type DmoSubmission } from '@/lib/dmo-submissions';
import {
  assessDmoIntegrity,
  DMO_INTEGRITY_ANALYZER_VERSION,
  summarizeAnalyzerRun,
  type DmoIntegrityAssessment,
  type DmoIntegrityLevel,
  type DmoIntegritySummary,
} from '@/lib/dmoIntegrityScore.mjs';
import * as analyzer from '@/lib/te4InputAnalyzer/analyze-dmo.cjs';
import * as impactAnalyzer from '@/lib/te4InputAnalyzer/measure-aim-at-impact.cjs';

// Match integrity screening for submitted DMOs. Results are admin-only: they
// never appear on public pages, in Discord or in any player-facing API.

export type DmoIntegrityStatus = 'done' | 'unsupported' | 'failed' | 'no_file';

export type DmoIntegrityScan = {
  submission_id: number | string;
  status: DmoIntegrityStatus;
  level: DmoIntegrityLevel | null;
  score: number | null;
  summary: DmoIntegritySummary | null;
  assessment: DmoIntegrityAssessment | null;
  analyzer_version: string;
  file_sha256: string | null;
  error: string | null;
  duration_ms: number | null;
  scanned_at: string | Date;
};

export type DmoIntegrityRow = DmoIntegrityScan & {
  tournament: string;
  round_name: string;
  player1: string;
  player2: string;
  submission_date: string | Date;
  file_name: string | null;
  source: string;
  hidden_at: string | Date | null;
};

let schemaReady: Promise<void> | null = null;

export async function ensureDmoIntegritySchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS dmo_integrity_scans (
          submission_id BIGINT PRIMARY KEY REFERENCES dmo_submissions(id) ON DELETE CASCADE,
          status TEXT NOT NULL CHECK (status IN ('done','unsupported','failed','no_file')),
          level TEXT CHECK (level IS NULL OR level IN ('high','medium','weak','none')),
          score INTEGER,
          summary JSONB,
          assessment JSONB,
          analyzer_version TEXT NOT NULL,
          file_sha256 TEXT,
          error TEXT,
          duration_ms INTEGER,
          scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS dmo_integrity_scans_level_idx
        ON dmo_integrity_scans(level, score DESC)
      `;
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
}

export function hasScannableDmo(submission: Pick<DmoSubmission, 'private_blob_pathname' | 'file_name'>) {
  return Boolean(
    submission.private_blob_pathname
    && /\.dmo$/i.test(String(submission.file_name || submission.private_blob_pathname)),
  );
}

async function readSubmissionDmo(submission: DmoSubmission): Promise<Buffer | null> {
  const storeId = process.env.MODERATION_BLOB_STORE_ID;
  if (!storeId || !submission.private_blob_pathname) return null;
  const result = await get(submission.private_blob_pathname, { access: 'private', storeId, useCache: false });
  if (!result || result.statusCode !== 200 || !result.stream) return null;
  return Buffer.from(await new Response(result.stream).arrayBuffer());
}

function isAssertion(error: unknown) {
  return Boolean(error && typeof error === 'object' && (error as { code?: string }).code === 'ERR_ASSERTION');
}

function shortError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? 'Unknown error');
  return message.split('\n')[0].slice(0, 300);
}

/** Run the analyzer on one recording. Pure: no storage. */
export function screenDmoBuffer(bytes: Buffer) {
  const demo = analyzer.ReadDemo(bytes);
  const timing = analyzer.CalibrateTime(demo, null);
  const analysis = analyzer.Analyze(demo, timing);
  let impact: unknown;
  try {
    impact = impactAnalyzer.AnalyzeImpact(demo, timing);
  } catch (error) {
    if (!isAssertion(error)) throw error;
    impact = { Unavailable: shortError(error) };
  }
  const summary = summarizeAnalyzerRun({ demo, timing, analysis, impact });
  return { summary, assessment: assessDmoIntegrity(summary) };
}

async function saveScan(id: number, scan: Omit<DmoIntegrityScan, 'submission_id' | 'scanned_at'>) {
  await sql`
    INSERT INTO dmo_integrity_scans (
      submission_id,status,level,score,summary,assessment,analyzer_version,file_sha256,error,duration_ms,scanned_at
    ) VALUES (
      ${id},${scan.status},${scan.level},${scan.score},
      ${scan.summary ? JSON.stringify(scan.summary) : null}::jsonb,
      ${scan.assessment ? JSON.stringify(scan.assessment) : null}::jsonb,
      ${scan.analyzer_version},${scan.file_sha256},${scan.error},${scan.duration_ms},NOW()
    )
    ON CONFLICT (submission_id) DO UPDATE SET
      status=EXCLUDED.status,level=EXCLUDED.level,score=EXCLUDED.score,
      summary=EXCLUDED.summary,assessment=EXCLUDED.assessment,
      analyzer_version=EXCLUDED.analyzer_version,file_sha256=EXCLUDED.file_sha256,
      error=EXCLUDED.error,duration_ms=EXCLUDED.duration_ms,scanned_at=NOW()
  `;
}

/** Scan one submission and store the result. Never throws for a bad file. */
export async function scanDmoSubmission(id: number): Promise<DmoIntegrityStatus> {
  await ensureDmoIntegritySchema();
  const submission = await getDmoSubmission(id);
  if (!submission) throw new Error('Submission not found.');
  const base = { level: null, score: null, summary: null, assessment: null, analyzer_version: DMO_INTEGRITY_ANALYZER_VERSION, file_sha256: null, error: null, duration_ms: null };
  if (!hasScannableDmo(submission)) {
    await saveScan(id, { ...base, status: 'no_file', error: 'No private .dmo file was submitted.' });
    return 'no_file';
  }
  const started = Date.now();
  let bytes: Buffer | null = null;
  try {
    bytes = await readSubmissionDmo(submission);
  } catch (error) {
    await saveScan(id, { ...base, status: 'failed', error: `The private DMO could not be read: ${shortError(error)}` });
    return 'failed';
  }
  if (!bytes) {
    await saveScan(id, { ...base, status: 'failed', error: 'The private DMO file is unavailable.' });
    return 'failed';
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  try {
    const { summary, assessment } = screenDmoBuffer(bytes);
    await saveScan(id, {
      ...base,
      status: 'done',
      level: assessment.level,
      score: assessment.score,
      summary,
      assessment,
      file_sha256: sha256,
      duration_ms: Date.now() - started,
    });
    return 'done';
  } catch (error) {
    // The analyzer fails closed on anything it can't validate (other builds,
    // doubles, resumed matches, truncated files): that's "unsupported", not a bug.
    const status: DmoIntegrityStatus = isAssertion(error) ? 'unsupported' : 'failed';
    await saveScan(id, { ...base, status, file_sha256: sha256, error: shortError(error), duration_ms: Date.now() - started });
    if (status === 'failed') console.error('[dmo-integrity] scan failed', { id, errorType: error instanceof Error ? error.name : 'UnknownError' });
    return status;
  }
}

/** Submission ids with no scan yet, or a scan from an older analyzer/rubric. */
export async function listPendingIntegrityScans(limit = 50): Promise<number[]> {
  await ensureDmoIntegritySchema();
  const rows = await sql`
    SELECT s.id
    FROM dmo_submissions s
    LEFT JOIN dmo_integrity_scans i ON i.submission_id=s.id
    WHERE i.submission_id IS NULL
      OR (i.analyzer_version<>${DMO_INTEGRITY_ANALYZER_VERSION} AND i.status<>'no_file')
    ORDER BY s.created_at DESC
    LIMIT ${Math.max(1, Math.min(500, Math.floor(limit)))}
  `;
  return rows.map((row) => Number(row.id));
}

export async function countPendingIntegrityScans(): Promise<number> {
  await ensureDmoIntegritySchema();
  const rows = await sql`
    SELECT COUNT(*)::int AS count
    FROM dmo_submissions s
    LEFT JOIN dmo_integrity_scans i ON i.submission_id=s.id
    WHERE i.submission_id IS NULL
      OR (i.analyzer_version<>${DMO_INTEGRITY_ANALYZER_VERSION} AND i.status<>'no_file')
  `;
  return Number(rows[0]?.count ?? 0);
}

export async function listDmoIntegrityScans(limit = 500): Promise<DmoIntegrityRow[]> {
  await ensureDmoIntegritySchema();
  return await sql`
    SELECT i.*,s.tournament,s.round_name,s.player1,s.player2,s.submission_date,
      s.file_name,s.source,s.hidden_at
    FROM dmo_integrity_scans i
    JOIN dmo_submissions s ON s.id=i.submission_id
    WHERE i.status<>'no_file'
    ORDER BY s.submission_date DESC, s.created_at DESC
    LIMIT ${Math.max(1, Math.min(1000, Math.floor(limit)))}
  ` as DmoIntegrityRow[];
}

export async function getDmoIntegrityLevels(ids: number[]): Promise<Map<number, Pick<DmoIntegrityScan, 'status' | 'level' | 'score'>>> {
  await ensureDmoIntegritySchema();
  if (!ids.length) return new Map();
  const rows = await sql`
    SELECT submission_id,status,level,score
    FROM dmo_integrity_scans
    WHERE submission_id = ANY(${ids}::bigint[])
  `;
  return new Map(rows.map((row) => [Number(row.submission_id), {
    status: row.status as DmoIntegrityStatus,
    level: (row.level ?? null) as DmoIntegrityLevel | null,
    score: row.score === null ? null : Number(row.score),
  }]));
}

/**
 * The analyzer's own interactive HTML report for one submission: the same
 * page admins got by running the tool by hand (charts, point inspector,
 * flagged passages, CSV/JSON export). Built on request, never stored.
 */
export async function buildDmoIntegrityReport(id: number): Promise<string | null> {
  const submission = await getDmoSubmission(id);
  if (!submission || !hasScannableDmo(submission)) return null;
  const bytes = await readSubmissionDmo(submission);
  if (!bytes) return null;
  const demo = analyzer.ReadDemo(bytes);
  const timing = analyzer.CalibrateTime(demo, null);
  const analysis = analyzer.Analyze(demo, timing);
  try {
    analysis.Impact = impactAnalyzer.AnalyzeImpact(demo, timing);
  } catch (error) {
    if (!isAssertion(error)) throw error;
    analysis.Impact = { Unavailable: `Impact timing could not be validated. ${shortError(error)}` };
  }
  const sourceName = path.basename(String(submission.file_name || `match-${submission.id}.dmo`))
    .replace(/[^\w .()[\]-]/g, '_');
  const output = path.join(tmpdir(), `dmo-integrity-${randomUUID()}.html`);
  try {
    analyzer.WriteReport(output, sourceName, bytes, demo, timing, analysis, [
      'Run by the WTSL Forum on the private submitted file. Structural stream and timing checks always run.',
    ]);
    return await readFile(output, 'utf8');
  } finally {
    await unlink(output).catch(() => {});
  }
}

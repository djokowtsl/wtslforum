import { NextRequest, NextResponse } from 'next/server';
import {
  SCREENSHOT_RECORD_FIELDS,
  SCREENSHOT_METRIC_FIELDS,
} from '@/lib/screenshotRecordFields';
import {
  upsertScreenshotRecordBatch,
  type ScreenshotRecordInput,
  type ScreenshotTour,
} from '@/lib/screenshotRecords';

export const dynamic = 'force-dynamic';

function authorized(req: NextRequest) {
  const secret = process.env.WTSL_SYNC_SECRET;
  if (secret && req.headers.get('x-wtsl-sync-secret') === secret) return true;
  const cronSecret = process.env.CRON_SECRET;
  return Boolean(cronSecret && req.headers.get('authorization') === `Bearer ${cronSecret}`);
}

function isTour(value: unknown): value is ScreenshotTour {
  return value === 'TE4' || value === 'TE4_(F)';
}

function publicData(value: unknown): Record<string, string | number> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const numeric = new Set<string>(['ELO', 'Opponent ELO', ...SCREENSHOT_METRIC_FIELDS]);
  const data: Record<string, string | number> = {};
  for (const field of SCREENSHOT_RECORD_FIELDS) {
    const item = source[field];
    if (typeof item === 'number' && Number.isFinite(item)) {
      data[field] = item;
    } else if (typeof item === 'string') {
      data[field] = item.slice(0, 500);
    } else if (item !== undefined && item !== null) {
      return null;
    }
    if (numeric.has(field) && data[field] !== undefined && typeof data[field] !== 'number') {
      const parsed = Number(data[field]);
      if (!Number.isFinite(parsed)) delete data[field];
      else data[field] = parsed;
    }
  }
  return data;
}

function dateOnly(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    parsed.getUTCFullYear() !== Number(year)
    || parsed.getUTCMonth() + 1 !== Number(month)
    || parsed.getUTCDate() !== Number(day)
  ) return null;
  return `${year}-${month}-${day}`;
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!isTour(body?.tour)) return NextResponse.json({ error: 'Invalid tour' }, { status: 400 });
  if (typeof body?.syncId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(body.syncId)) {
    return NextResponse.json({ error: 'Invalid sync ID' }, { status: 400 });
  }
  if (!Array.isArray(body?.records) || body.records.length < 1 || body.records.length > 200) {
    return NextResponse.json({ error: 'Expected 1–200 screenshot rows' }, { status: 400 });
  }

  const rows: ScreenshotRecordInput[] = [];
  for (const item of body.records) {
    const data = publicData(item?.data);
    const recordId = typeof item?.recordId === 'string' ? item.recordId.trim() : '';
    const sourceRow = Number(item?.sourceRow);
    const playerName = typeof data?.Player === 'string' ? data.Player.trim() : '';
    const opponentName = typeof data?.Opponent === 'string' ? data.Opponent.trim() : '';
    const score = typeof data?.Result === 'string' ? data.Result.trim() : '';
    if (
      !data || !recordId || recordId.length > 100
      || !Number.isInteger(sourceRow) || sourceRow < 2
      || !playerName || !opponentName || !score
    ) {
      return NextResponse.json({ error: 'Invalid screenshot row in batch' }, { status: 400 });
    }
    const date = typeof data.Date === 'string' ? data.Date.slice(0, 80) : '';
    const reviewStatus = typeof data['Review Status'] === 'string'
      ? data['Review Status'].trim().slice(0, 80)
      : '';
    data['Review Status'] = reviewStatus;
    rows.push({
      recordId,
      sourceRow,
      playerName: playerName.slice(0, 160),
      opponentName: opponentName.slice(0, 160),
      tournamentName: typeof data.Tournament === 'string' ? data.Tournament.slice(0, 200) : '',
      date,
      playedOn: dateOnly(date),
      score: score.slice(0, 200),
      reviewStatus,
      data,
    });
  }
  if (new Set(rows.map((row) => row.recordId)).size !== rows.length) {
    return NextResponse.json({ error: 'Duplicate row IDs in batch' }, { status: 400 });
  }

  try {
    const stored = await upsertScreenshotRecordBatch(body.tour, body.syncId, rows);
    return NextResponse.json({ ok: true, stored });
  } catch {
    return NextResponse.json({ error: 'Screenshot rows could not be stored' }, { status: 500 });
  }
}
import { sql } from '@/lib/db';

export type SiteSnapshot<T> = {
  payload: T;
  checkedAt: string;
  source?: 'snapshot' | 'live';
};

let tableSetup: Promise<void> | null = null;
const inFlightPublicLoads = new Map<string, Promise<SiteSnapshot<unknown>>>();

async function ensureSiteSnapshotTable() {
  if (!tableSetup) {
    const setup = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS forum_public_page_snapshots (
          snapshot_key TEXT PRIMARY KEY,
          payload JSONB NOT NULL,
          checked_at TIMESTAMPTZ NOT NULL,
          stored_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS forum_public_page_snapshots_checked_idx
        ON forum_public_page_snapshots (checked_at DESC)
      `;
    })();
    tableSetup = setup;
    setup.catch(() => {
      if (tableSetup === setup) tableSetup = null;
    });
  }

  await tableSetup;
}

/**
 * These snapshots contain only public upstream data. Never use this store for
 * account balances, bet ledgers, messages, or other user-specific content.
 */
export async function readSiteSnapshot<T>(key: string): Promise<SiteSnapshot<T> | null> {
  await ensureSiteSnapshotTable();
  const rows = await sql`
    SELECT payload, checked_at
    FROM forum_public_page_snapshots
    WHERE snapshot_key = ${key}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;

  const checkedAt = new Date(row.checked_at);
  if (!Number.isFinite(checkedAt.getTime())) {
    throw new Error(`Invalid checked_at value in public page snapshot: ${key}`);
  }

  const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
  return { payload: payload as T, checkedAt: checkedAt.toISOString(), source: 'snapshot' };
}

export async function writeSiteSnapshot<T>(
  key: string,
  payload: T,
  checkedAt: string | Date = new Date(),
): Promise<void> {
  const timestamp = new Date(checkedAt);
  if (!Number.isFinite(timestamp.getTime())) {
    throw new Error(`Invalid snapshot source timestamp: ${key}`);
  }
  const serialized = JSON.stringify(payload);
  if (serialized === undefined) {
    throw new Error(`Public page snapshot is not JSON serializable: ${key}`);
  }

  await ensureSiteSnapshotTable();
  await sql`
    INSERT INTO forum_public_page_snapshots (snapshot_key, payload, checked_at, stored_at)
    VALUES (${key}, ${serialized}::jsonb, ${timestamp.toISOString()}, NOW())
    ON CONFLICT (snapshot_key) DO UPDATE SET
      payload = EXCLUDED.payload,
      checked_at = EXCLUDED.checked_at,
      stored_at = NOW()
    WHERE forum_public_page_snapshots.checked_at <= EXCLUDED.checked_at
  `;
}

/**
 * Serve a saved public snapshot when available. On a fresh deployment, load a
 * verified public source once and save it for subsequent first renders.
 */
export async function getPublicSiteSnapshot<T>(
  key: string,
  load: () => Promise<T>,
): Promise<SiteSnapshot<T>> {
  try {
    const snapshot = await readSiteSnapshot<T>(key);
    if (snapshot) return snapshot;
  } catch (error) {
    console.warn('[public-page-snapshots] Snapshot read failed', {
      key,
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
  }

  let pending = inFlightPublicLoads.get(key);
  if (!pending) {
    pending = (async () => {
      const payload = await load();
      const sourceTime = (payload as { checkedAt?: unknown } | null)?.checkedAt;
      const parsedSourceTime = typeof sourceTime === 'string' ? new Date(sourceTime) : null;
      const checkedAt = parsedSourceTime && Number.isFinite(parsedSourceTime.getTime())
        ? parsedSourceTime.toISOString()
        : new Date().toISOString();
      try {
        await writeSiteSnapshot(key, payload, checkedAt);
      } catch (error) {
        console.warn('[public-page-snapshots] Initial snapshot write failed', {
          key,
          errorType: error instanceof Error ? error.name : 'UnknownError',
        });
      }
      return { payload, checkedAt, source: 'live' };
    })();
    inFlightPublicLoads.set(key, pending);
  }

  try {
    return await pending as SiteSnapshot<T>;
  } finally {
    if (inFlightPublicLoads.get(key) === pending) inFlightPublicLoads.delete(key);
  }
}

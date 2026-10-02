'use client';
import { useState } from 'react';

// Keep this in sync with lib/wtsl.ts TOURS — duplicated as plain data so this client
// component doesn't need to bundle the server-side scraping module.
const TOURS: { code: string; label: string }[] = [
  { code: 'TE4', label: 'ATP' },
  { code: 'TE4_(F)', label: 'WTA' },
  { code: 'TE4_CD', label: 'Competitive Doubles' },
  { code: 'TE4_Coop', label: 'Cooperative Doubles' },
  { code: 'TE4_P', label: 'Created' },
];
const CATEGORIES: { key: string; label: string }[] = [
  { key: 'players', label: 'Players' },
  { key: 'tournaments', label: 'Tournaments' },
  { key: 'playerStats', label: 'Player stats' },
];
// Separate, opt-in action: backfills the 2022-2025 tournament calendar from the official site's
// `year=` filter. Only needs to run once (or after the backfill itself times out on a tour) since
// those seasons never change — kept out of the regular "Run sync now" loop so routine syncs stay
// fast and don't spend time re-scraping years of history nobody's waiting on.
const HISTORY_TOURS = TOURS;
// Keep in sync with lib/wtsl.ts HISTORICAL_TOURNAMENT_YEARS.
const HISTORY_YEARS = ['2025', '2024', '2023', '2022'];

type TourResult = {
  tour?: string; error?: string; seen?: number; upserted?: number; created?: number; updated?: number; failed?: number;
  matchesRecorded?: number; lastError?: string; clutchUpdated?: number;
  characterUsage?: { playersUpdated: number; charactersWritten: number; matchesCounted: number };
};

function summarize(tourLabel: string, result: TourResult | undefined): string {
  if (!result) return `${tourLabel}: no result`;
  if (result.error) return `${tourLabel} failed (${result.error})`;
  // `upserted` is the real "how many actually wrote to the DB" count for player/stat syncs.
  // Tournaments report `created`/`updated` instead. Checking `!== undefined` (not `??`/`||`)
  // matters: a genuine 0 upserted (every row failed to write, e.g. a missing DB column) must
  // stay 0 and not silently fall back to `seen`, which used to make a total failure look
  // identical to a full success in this log.
  const count = result.upserted !== undefined ? result.upserted : (result.created ?? 0) + (result.updated ?? 0) || result.seen || 0;
  const seen = result.seen ?? 0;
  const failed = result.failed ?? (seen && result.upserted !== undefined ? Math.max(seen - result.upserted, 0) : 0);
  let line = `${tourLabel}: ${count}${seen ? ` / ${seen}` : ''}`;
  if (failed > 0) line += ` (${failed} failed${result.lastError ? `: ${result.lastError}` : ''})`;
  // Player stats syncs also populate match_stats as a side effect (one row per completed
  // match found on a player's recent-results page) — surfacing it here is the only way to
  // tell "matches are being synced" from "matches page is empty for some other reason".
  if (result.matchesRecorded !== undefined) line += ` · ${result.matchesRecorded} new match${result.matchesRecorded === 1 ? '' : 'es'} recorded`;
  if (result.clutchUpdated !== undefined) line += ` · clutch stats updated for ${result.clutchUpdated}`;
  // Character usage is scraped from a feed WTSL only publishes for ATP (TE4) — a separate pass
  // bundled into the TE4 player-stats sync, so it only ever shows up on that one tour's line.
  if (result.characterUsage) line += ` · ${result.characterUsage.playersUpdated} players' character usage (${result.characterUsage.matchesCounted} matches)`;
  return line;
}

export default function AdminSyncButton() {
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [lines, setLines] = useState<string[]>([]);
  const [step, setStep] = useState(0);
  const total = CATEGORIES.length * TOURS.length;

  const [historyState, setHistoryState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [historyLines, setHistoryLines] = useState<string[]>([]);
  const [historyStep, setHistoryStep] = useState(0);
  const historyTotal = HISTORY_TOURS.length * HISTORY_YEARS.length;

  // Runs 15 small requests (5 tours x 3 categories) one at a time instead of one giant
  // request. Scraping every player's profile across every tour in a single serverless
  // invocation easily exceeds Vercel's function time limit, which used to kill the whole sync
  // mid-way and show a generic "check your connection" error with nothing to show for it.
  // Doing it in small steps means each request finishes quickly, a single slow/failing
  // tour can't block the rest, and the admin sees real progress as it goes.
  async function run() {
    setState('running');
    setLines([]);
    setStep(0);
    let anyError = false;
    let done = 0;
    for (const cat of CATEGORIES) {
      setLines((prev) => [...prev, `— ${cat.label} —`]);
      for (const t of TOURS) {
        try {
          const r = await fetch('/api/admin/sync', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ category: cat.key, tour: t.code }),
          });
          const data = await r.json();
          if (!data.ok) anyError = true;
          setLines((prev) => [...prev, summarize(t.label, data.result)]);
        } catch {
          anyError = true;
          setLines((prev) => [...prev, `${t.label} failed (request error — check your connection)`]);
        }
        done++;
        setStep(done);
      }
    }
    setState(anyError ? 'error' : 'done');
  }

  // One-time (or occasional re-run) backfill of the 2022-2025 tournament calendars. Runs 20
  // small requests (5 tours x 4 years) — one per (tour, year) pair — for the same reason the
  // regular sync above is split up: scraping a whole historical season plus its champions in
  // one request stays well inside the 60s function limit, and a single slow/failing year can't
  // block the rest of the backfill.
  async function runHistory() {
    setHistoryState('running');
    setHistoryLines([]);
    setHistoryStep(0);
    let anyError = false;
    let done = 0;
    for (const t of HISTORY_TOURS) {
      setHistoryLines((prev) => [...prev, `— ${t.label} —`]);
      for (const year of HISTORY_YEARS) {
        try {
          const r = await fetch('/api/admin/sync', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ category: 'tournamentHistory', tour: t.code, year }),
          });
          const data = await r.json();
          if (!data.ok) anyError = true;
          setHistoryLines((prev) => [...prev, summarize(`${year}`, data.result)]);
        } catch {
          anyError = true;
          setHistoryLines((prev) => [...prev, `${year} failed (request error — check your connection)`]);
        }
        done++;
        setHistoryStep(done);
      }
    }
    setHistoryState(anyError ? 'error' : 'done');
  }

  return (
    <div>
      <button className="btn btn-sm" onClick={run} disabled={state === 'running'}>
        {state === 'running' ? `Syncing… (${step} / ${total})` : 'Run sync now'}
      </button>
      {state === 'running' && (
        <div style={{ marginTop: 10, height: 6, borderRadius: 3, background: 'var(--line)', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${(step / total) * 100}%`, background: 'var(--lime)', transition: 'width 0.2s' }} />
        </div>
      )}
      {(state === 'done' || state === 'error') && (
        <div
          className="notice"
          style={{
            marginTop: 10,
            fontWeight: 700,
            borderLeft: `4px solid ${state === 'error' ? '#e5533d' : 'var(--lime)'}`,
          }}
        >
          {state === 'error' ? '⚠️ Sync finished with errors — see log below.' : '✅ Sync complete — all steps finished.'}
        </div>
      )}
      {lines.length > 0 && (
        <div className="notice" style={{ marginTop: 10 }}>
          {lines.map((l, i) => <p key={i} style={{ margin: '4px 0' }}>{l}</p>)}
        </div>
      )}

      <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
        <p style={{ margin: '0 0 8px', fontSize: '0.85rem', opacity: 0.8 }}>
          One-time backfill: imports the 2022-2025 tournament calendars (completed seasons only — no discussion threads are created).
        </p>
        <button className="btn btn-sm" onClick={runHistory} disabled={historyState === 'running'}>
          {historyState === 'running' ? `Backfilling… (${historyStep} / ${historyTotal})` : 'Backfill tournament history (2022-2025)'}
        </button>
        {historyState === 'running' && (
          <div style={{ marginTop: 10, height: 6, borderRadius: 3, background: 'var(--line)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${(historyStep / historyTotal) * 100}%`, background: 'var(--lime)', transition: 'width 0.2s' }} />
          </div>
        )}
        {(historyState === 'done' || historyState === 'error') && (
          <div
            className="notice"
            style={{
              marginTop: 10,
              fontWeight: 700,
              borderLeft: `4px solid ${historyState === 'error' ? '#e5533d' : 'var(--lime)'}`,
            }}
          >
            {historyState === 'error' ? '⚠️ Backfill finished with errors — see log below.' : '✅ Backfill complete — all seasons imported.'}
          </div>
        )}
        {historyLines.length > 0 && (
          <div className="notice" style={{ marginTop: 10 }}>
            {historyLines.map((l, i) => <p key={i} style={{ margin: '4px 0' }}>{l}</p>)}
          </div>
        )}
      </div>
    </div>
  );
}


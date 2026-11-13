import { createHash } from 'node:crypto';
import { get, put } from '@vercel/blob';
import { sql } from '@/lib/db';
import { getDmoCommentaryContext } from '@/lib/liveScores';
import { surfaceForDmoTournament } from '@/lib/te4DmoSurface';
import {
  buildDmoLivePhrasebook,
  DMO_PHRASEBOOK_VERSION,
  isDmoCommentaryLineAllowed,
} from '@/lib/dmoCommentaryPhrasebook.mjs';
import { DMO_COMMENTARY_SPEED, DMO_COMMENTARY_VOICES } from '@/lib/dmoCommentaryScript.mjs';
import {
  dmoCommentaryClipExists,
  dmoCommentaryClipKey,
  generateDmoCommentaryClip,
  readDmoCommentaryClip,
} from '@/lib/dmoCommentaryTrack';

/**
 * Live-match commentary from stored clips.
 *
 * Each broadcast gets a phrasebook: the lines its players' matches are most
 * likely to need. They are turned into stored clips while the broadcast page
 * is open, before and during the match, so most calls play instantly. Any
 * other line is made once when first needed, so every viewer shares it.
 * Clips are the same files replays use (named by voice and text).
 */

export type LiveCommentaryBroadcast = {
  id: string;
  names: [string, string];
  tournament: string;
  round: string;
  isWta: boolean;
  surface: string;
  bestOf: 1 | 3 | 5;
};

export type LivePhrasebookEntry = { voice: string; speed: number; text: string; clip: string };
export type StoredLivePhrasebook = {
  version: number;
  key: string;
  lines: LivePhrasebookEntry[];
  vocabulary: string[];
  /** Lines before this index are known to be stored. */
  prepared?: number;
  complete?: boolean;
};

const record = (value: unknown) => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
);
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

/** A broadcast that can currently be watched (the live replay route's rule). */
export async function findLiveCommentaryBroadcast(id: string): Promise<LiveCommentaryBroadcast | null> {
  const rows = await sql`
    SELECT payload
    FROM dmo_live_broadcasts
    WHERE id=${id}::uuid AND status IN ('live', 'ended') AND expires_at > NOW()
    LIMIT 1
  `;
  const payload = record(rows[0]?.payload);
  const snapshot = record(payload.snapshot);
  const players = Array.isArray(payload.players) ? payload.players : snapshot.players;
  if (!Array.isArray(players) || players.length !== 2) return null;
  const names: [string, string] = [text(players[0]), text(players[1])];
  if (!names[0] || !names[1]) return null;
  const bestOf = snapshot.bestOf === 1 || snapshot.bestOf === 5 ? snapshot.bestOf : 3;
  return {
    id,
    names,
    tournament: text(payload.tournamentName),
    round: text(payload.tournamentRound) || 'auto',
    isWta: payload.isWta === true,
    surface: surfaceForDmoTournament(typeof snapshot.stadium === 'string' ? snapshot.stadium : null),
    bestOf,
  };
}

function phrasebookKey(broadcast: LiveCommentaryBroadcast) {
  return createHash('sha256')
    .update(JSON.stringify([DMO_PHRASEBOOK_VERSION, broadcast.names, broadcast.tournament,
      broadcast.round, broadcast.surface, broadcast.bestOf, broadcast.isWta]))
    .digest('hex')
    .slice(0, 24);
}

const phrasebookPath = (broadcast: LiveCommentaryBroadcast) => (
  `dmo-commentary/live/${broadcast.id}-${phrasebookKey(broadcast)}.json`
);

const recentPhrasebooks = new Map<string, StoredLivePhrasebook>();
function remember(path: string, book: StoredLivePhrasebook) {
  recentPhrasebooks.delete(path);
  recentPhrasebooks.set(path, book);
  while (recentPhrasebooks.size > 30) recentPhrasebooks.delete(recentPhrasebooks.keys().next().value!);
  return book;
}

/** The broadcast's phrasebook, built (in well under a second) and stored on first use. */
export async function getDmoLivePhrasebook(
  broadcast: LiveCommentaryBroadcast,
  storeId: string,
): Promise<StoredLivePhrasebook> {
  const path = phrasebookPath(broadcast);
  const cached = recentPhrasebooks.get(path);
  if (cached) return cached;
  const stored = await get(path, { access: 'private', storeId, useCache: false }).catch(() => null);
  if (stored?.statusCode === 200 && stored.stream) {
    const book = await new Response(stored.stream).json().catch(() => null) as StoredLivePhrasebook | null;
    if (book?.version === DMO_PHRASEBOOK_VERSION && Array.isArray(book.lines) && Array.isArray(book.vocabulary)) {
      return remember(path, book);
    }
  }
  const context = await getDmoCommentaryContext(broadcast.names, broadcast.isWta).catch(() => null);
  const built = buildDmoLivePhrasebook({
    names: broadcast.names,
    tournament: broadcast.tournament,
    surface: broadcast.surface,
    round: broadcast.round,
    context,
    bestOf: broadcast.bestOf,
  });
  const book: StoredLivePhrasebook = {
    version: built.version,
    key: phrasebookKey(broadcast),
    lines: built.lines.map((line) => ({ ...line, clip: dmoCommentaryClipKey(line) })),
    vocabulary: built.vocabulary,
  };
  await put(path, JSON.stringify(book), {
    access: 'private',
    storeId,
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  });
  return remember(path, book);
}

const preparing = new Map<string, number>();

/**
 * Store the phrasebook's clips in order (opening and game calls first) until
 * the time budget runs out. Pages keep calling this while a broadcast is open,
 * so the whole phrasebook is ready within minutes, usually before play starts.
 */
export async function prepareDmoLivePhrasebook(
  broadcast: LiveCommentaryBroadcast,
  book: StoredLivePhrasebook,
  storeId: string,
  budgetMs = 45_000,
) {
  const total = book.lines.length;
  if (book.complete) return { ready: total, total };
  const path = phrasebookPath(broadcast);
  // One preparation per broadcast at a time on this server instance.
  if ((preparing.get(path) ?? 0) > Date.now()) return { ready: 0, total };
  preparing.set(path, Date.now() + budgetMs + 5_000);
  const deadline = Date.now() + budgetMs;
  // Carry on from where the last run stopped instead of re-checking.
  let ready = Math.min(Math.max(book.prepared ?? 0, 0), total);
  const startedAt = ready;
  try {
    while (ready < total && Date.now() <= deadline) {
      const line = book.lines[ready];
      if (!(await dmoCommentaryClipExists(line.clip, storeId))) {
        try {
          await generateDmoCommentaryClip(line, storeId);
        } catch {
          break; // The bot is unavailable; the next call carries on.
        }
      }
      ready += 1;
    }
    if (ready > startedAt) {
      const progress = remember(path, { ...book, prepared: ready, complete: ready === total });
      await put(path, JSON.stringify(progress), {
        access: 'private',
        storeId,
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json',
      }).catch(() => undefined);
    }
  } finally {
    preparing.delete(path);
  }
  return { ready, total };
}

/**
 * A live commentary line as MP3: stored if it was made before, otherwise made
 * now and stored. Lines outside the phrasebook must pass the vocabulary check.
 */
export async function getDmoLiveCommentaryClip(
  book: StoredLivePhrasebook,
  request: { text: string; voice: string },
  storeId: string,
) {
  const voices: string[] = Object.values(DMO_COMMENTARY_VOICES);
  if (!voices.includes(request.voice)) return null;
  const line = { text: request.text, voice: request.voice, speed: DMO_COMMENTARY_SPEED };
  const clip = dmoCommentaryClipKey(line);
  const known = book.lines.some((entry) => entry.clip === clip);
  if (!known && !isDmoCommentaryLineAllowed(line.text, book.vocabulary)) return null;
  return (await readDmoCommentaryClip(clip, storeId)) ?? generateDmoCommentaryClip({ ...line, clip }, storeId);
}

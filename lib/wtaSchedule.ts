import { fetchWTSLTournaments, type WTSLTournament } from './wtsl';

const SCHEDULE_TTL_MS = 15 * 60 * 1000;
const scheduleCache = new Map<
  number,
  { expiresAt: number; promise: Promise<WTSLTournament[]> }
>();

export function tournamentIdFromOfficialUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url, 'https://www.playwtsl.com').searchParams.get('tournament');
  } catch {
    return null;
  }
}

export async function officialWtaScheduleForYear(year: number): Promise<WTSLTournament[]> {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error(`Invalid WTA schedule year: ${year}`);
  }
  const cached = scheduleCache.get(year);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const promise = fetchWTSLTournaments('TE4_(F)', String(year)).then((events) =>
    events.filter((event) => event.tour === 'TE4_(F)'),
  );
  scheduleCache.set(year, { expiresAt: Date.now() + SCHEDULE_TTL_MS, promise });
  try {
    return await promise;
  } catch (error) {
    if (scheduleCache.get(year)?.promise === promise) scheduleCache.delete(year);
    throw error;
  }
}

function yearOf(value: string | null | undefined): number | null {
  const year = /^(\d{4})/.exec(value?.trim() ?? '')?.[1];
  return year ? Number(year) : null;
}

function eventMatchesYear(event: WTSLTournament, year: number): boolean {
  return yearOf(event.startDate) === year;
}

export function officialWtaEventByTournamentKey(
  tournamentKey: string | null | undefined,
  playedAt: string | null | undefined,
  events: WTSLTournament[],
): WTSLTournament | null {
  const key = tournamentKey?.trim();
  const year = yearOf(playedAt);
  if (!key || !year) return null;
  return events.find((event) =>
    eventMatchesYear(event, year)
    && (
      event.key === key
      || tournamentIdFromOfficialUrl(event.officialUrl) === key
    ),
  ) ?? null;
}

function normalizedEventWords(value: string): string[] {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/tennis\s*elbow\s*4/g, ' ')
    .replace(/\bao\b/g, ' australian open ')
    .replace(/\brg\b/g, ' roland garros ')
    .replace(/\bdoha\b/g, ' qatar open ')
    .replace(/\broma\b/g, ' rome ')
    .replace(/\b(?:atp|wta|wtsl|characters?|female|women)\b/g, ' ')
    .replace(/\b(?:1000|500|250|125|20\d{2})\b/g, ' ')
    .replace(/\b(?:lr?|round)\s*[- ]?\d+\b/g, ' ')
    .replace(/\b(?:court|day|night|session|stadium|arena)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((word) => word && word !== 'f');
}

export function officialWtaEventByName(
  tournamentName: string | null | undefined,
  playedAt: string | null | undefined,
  events: WTSLTournament[],
): WTSLTournament | null {
  const name = tournamentName?.trim() ?? '';
  const year = yearOf(playedAt);
  if (!name || !year || /\batp\b/i.test(name)) return null;

  const sourceWords = new Set(normalizedEventWords(name));
  if (!sourceWords.size) return null;
  const matches = events.filter((event) => {
    if (!eventMatchesYear(event, year)) return false;
    const eventWords = normalizedEventWords(event.name);
    return eventWords.length > 0 && eventWords.every((word) => sourceWords.has(word));
  });
  return matches.length === 1 ? matches[0] : null;
}
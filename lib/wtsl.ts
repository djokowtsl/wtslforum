const WTSL_BASE = 'https://www.playwtsl.com/TE4/pages';

export type TourCode = 'TE4' | 'TE4_(F)' | 'TE4_CD' | 'TE4_Coop' | 'TE4_P';
export const DEFAULT_TOUR: TourCode = 'TE4';
export const TOURS: { code: TourCode; label: string; short: string }[] = [
  { code: 'TE4', label: 'ATP Characters', short: 'ATP' },
  { code: 'TE4_(F)', label: 'WTA Characters', short: 'WTA' },
  { code: 'TE4_CD', label: 'Competitive Doubles', short: 'Doubles' },
  { code: 'TE4_Coop', label: 'Cooperative Doubles League', short: 'Coop' },
  { code: 'TE4_P', label: 'Created Characters', short: 'Created' },
];
export function isTourCode(value: string | undefined | null): value is TourCode {
  return !!value && TOURS.some((t) => t.code === value);
}
/** Past seasons the official site's tournament calendar still has a `year=` filter for — the
 * default (no `year` param) always shows the current season. Confirmed against the site's own
 * year dropdown on the tournaments page. */
export const HISTORICAL_TOURNAMENT_YEARS = ['2025', '2024', '2023', '2022'];
export function tourLabel(tour: string) {
  return TOURS.find((t) => t.code === tour)?.short ?? tour;
}
function tournamentsUrl(tour: TourCode, year?: string) {
  const y = year ? `&year=${encodeURIComponent(year)}` : '';
  return `${WTSL_BASE}/tournaments.php?tour=${encodeURIComponent(tour)}${y}`;
}
function rankingsUrl(tour: TourCode) {
  return `${WTSL_BASE}/rankings.php?tour=${encodeURIComponent(tour)}`;
}
export const TOURNAMENTS_URL = tournamentsUrl(DEFAULT_TOUR);

function cleanHtml(value: string) {
  return value
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ').trim();
}
function abs(url: string, base = TOURNAMENTS_URL) {
  try { return new URL(url, base).toString(); } catch { return url; }
}
function attr(tag: string, name: string) {
  const re = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i');
  return re.exec(tag)?.[1] ?? null;
}

export type WTSLTournament = {
  key:string; name:string; location:string; country:string; category:string; drawSize:number|null;
  surface:string; startDate:string|null; status:'ongoing'|'upcoming'|'completed'|'cancelled'; champion:string|null; championUrl:string|null;
  officialUrl:string; tour:TourCode;
};

export async function fetchWTSLTournaments(tour: TourCode = DEFAULT_TOUR, year?: string): Promise<WTSLTournament[]> {
  const url = tournamentsUrl(tour, year);
  const res = await fetch(url, { cache:'no-store', headers:{'user-agent':'WTSL-Community-Bridge/1.0'} });
  if (!res.ok) throw new Error(`WTSL tournaments request failed: ${res.status}`);
  const html = await res.text();
  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  const out:WTSLTournament[] = [];
  for (const row of rows) {
    const cells = row.match(/<td[\s\S]*?<\/td>/gi) ?? [];
    if (cells.length < 7) continue;
    const links = [...row.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
    const nameLink = links.find(x => !/SignUp|Finished|Ongoing|Cancelled/i.test(cleanHtml(x[2])));
    const name = cleanHtml(nameLink?.[2] ?? cells[0] ?? '');
    if (!name || /Tournament/i.test(name)) continue;
    const officialUrl = abs(nameLink?.[1] ?? '#', url);
    const locationText = cleanHtml(cells[1]).replace(/^.*?\s(?=[A-Za-zÀ-ÿ' -]+\s*,)/, '');
    const parts = locationText.split(',').map(s=>s.trim()).filter(Boolean);
    const country = parts.at(-1) ?? '';
    const location = parts.slice(0,-1).join(', ') || locationText;
    const category = cleanHtml(cells[2]);
    const drawSize = parseInt(cleanHtml(cells[3]),10); 
    const surface = cleanHtml(cells[4]);
    const rawDate = cleanHtml(cells[5]);
    const m = rawDate.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    const startDate = m ? `${m[3]}-${m[2]}-${m[1]}` : null;
    const statusText = cleanHtml(cells[6]).toLowerCase();
    const status = statusText.includes('ongoing') ? 'ongoing' : statusText.includes('signup') || statusText.includes('upcoming') ? 'upcoming' : statusText.includes('cancelled') ? 'cancelled' : 'completed';
    const championCell = cells[7] ?? '';
    const championLink = [...championCell.matchAll(/<a[^>]+href=[\"']([^\"']+)[\"'][^>]*>([\s\S]*?)<\/a>/gi)][0];
    const champion = cleanHtml(championLink?.[2] ?? championCell).replace(/^N\/A$/i,'') || null;
    const championHref = championLink?.[1] ?? null;
    const championUrl = championHref ? abs(championHref, url) : null;
    // The site's own `tournament=` query param (e.g. "Jinan_2026_TE4") is a stable WTSL-assigned
    // ID for this exact event. The old key derived from name+startDate broke whenever a
    // tournament's start date was rescheduled after signups opened — the key changed mid-event,
    // orphaning the original DB row and inserting a second one for the same tournament (hence
    // cities like Tokyo/Jinan/Hangzhou showing up twice). Falls back to the old scheme only if
    // the site ever omits that query param.
    const idMatch = (nameLink?.[1] ?? '').match(/tournament=([^&"']+)/i);
    const key = idMatch
      ? `${tour.toLowerCase().replace(/[^a-z0-9]+/g,'-')}-${decodeURIComponent(idMatch[1]).toLowerCase().replace(/[^a-z0-9]+/g,'-')}`
      : `${tour.toLowerCase().replace(/[^a-z0-9]+/g,'-')}-${name.toLowerCase().replace(/[^a-z0-9]+/g,'-')}-${startDate ?? 'unknown'}`;
    out.push({key,name,location,country,category,drawSize:Number.isFinite(drawSize)?drawSize:null,surface,startDate,status,champion,championUrl,officialUrl,tour});
  }
  return out;
}

/** Scrapes the dedicated tournament event logo ("Logo" row) from a tournament's official page. */
export async function fetchWTSLTournamentLogo(officialUrl: string): Promise<string | null> {
  const res = await fetch(officialUrl, { cache: 'no-store', headers: { 'user-agent': 'WTSL-Community-Bridge/1.0' } });
  if (!res.ok) return null;
  const html = await res.text();
  const src = html.match(/<th>\s*Logo\s*<\/th>\s*<td>\s*<img\s+src=['"]([^'"]+)['"]/i)?.[1];
  return src ? abs(src, officialUrl) : null;
}

export async function fetchWTSLPlayer(playerUrl: string) {
  const res = await fetch(playerUrl,{cache:'no-store',headers:{'user-agent':'WTSL-Community-Bridge/1.0'}});
  if (!res.ok) throw new Error(`Player request failed: ${res.status}`);
  const html = await res.text();
  const id = new URL(playerUrl).searchParams.get('player') ?? '';
  const h1 = cleanHtml(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '');
  const name = h1 || cleanHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').replace(/\s*-\s*WTSL.*$/i,'');
  const avatar = [...html.matchAll(/<img([^>]+)>/gi)].map(x=>x[1]).map(tag=>({src:attr(tag,'src'),alt:attr(tag,'alt')})).find(x=>x.alt && x.alt.toLowerCase().includes(name.toLowerCase()));
  const flag = [...html.matchAll(/<img([^>]+)>/gi)].map(x=>x[1]).map(tag=>({src:attr(tag,'src'),alt:attr(tag,'alt')})).find(x=>/flag/i.test(x.alt ?? ''));
  const text = cleanHtml(html);
  const rank = text.match(/Rank\s+(\d+)/i)?.[1];
  const elo = text.match(/Tour Elo\s+(\d+)/i)?.[1];
  const eloLabel = text.match(/Tour Elo\s+\d+\s*\(([^)]+)\)/i)?.[1] ?? null;
  const nationality = text.match(/Nationality\s+([^\s]+(?:\s+[^\s]+){0,3})\s+Rank/i)?.[1] ?? '';
  // Real win/loss record and season form, scraped from the player's official WTSL profile (player_page.php).
  const careerWL = text.match(/Career Wins\/Losses\s+(\d+)\s*\/\s*(\d+)/i);
  const careerWinPct = text.match(/Career Win Percentage\s+(\d+)/i)?.[1];
  const ytdWL = text.match(/YTD Wins\/Losses\s+(\d+)\s*\/\s*(\d+)/i);
  const ytdWinPct = text.match(/YTD Win Percentage\s+(\d+)/i)?.[1];
  const titlesMain = text.match(/Career Titles \(Finals\) - Main Tour\s+(\d+)\s*\((\d+)\)/i);
  const prizeMoney = text.match(/Career Prize Money\s+([\d,]+)\s*([A-Z]{2,4})/i);
  const form = text.match(/Form \(Last 10 Matches\)\s*((?:[WL]\s*){1,10})/i)?.[1]?.replace(/\s+/g,'') ?? null;
  const recentResults = parsePlayerRecentResults(html, playerUrl);
  return {
    id,name,avatarUrl:avatar?.src?abs(avatar.src,playerUrl):null,flagUrl:flag?.src?abs(flag.src,playerUrl):null,country:nationality,
    rank:rank?Number(rank):null,tourElo:elo?Number(elo):null,eloLabel,officialUrl:playerUrl,
    careerWins:careerWL?Number(careerWL[1]):null,careerLosses:careerWL?Number(careerWL[2]):null,careerWinPct:careerWinPct?Number(careerWinPct):null,
    ytdWins:ytdWL?Number(ytdWL[1]):null,ytdLosses:ytdWL?Number(ytdWL[2]):null,ytdWinPct:ytdWinPct?Number(ytdWinPct):null,
    titlesMain:titlesMain?Number(titlesMain[1]):null,finalsMain:titlesMain?Number(titlesMain[2]):null,
    prizeMoney:prizeMoney?Number(prizeMoney[1].replace(/,/g,'')):null,prizeCurrency:prizeMoney?.[2] ?? null,
    form,recentResults,
  };
}

export type WTSLRecentResult = {
  tournamentKey: string|null; tournamentName: string; round: string; opponentId: string|null; opponentName: string;
  date: string|null; score: string;
};

/** Parses the "Recent Results" table on a player's profile page (tournament/round/opponent/date/score). */
function parsePlayerRecentResults(html: string, base: string): WTSLRecentResult[] {
  const section = html.match(/Recent Results[\s\S]*?<table[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/i)?.[1] ?? '';
  const rows = section.match(/<tr>[\s\S]*?<\/tr>/gi) ?? [];
  const out: WTSLRecentResult[] = [];
  for (const row of rows) {
    const cells = row.match(/<td[\s\S]*?<\/td>/gi) ?? [];
    if (cells.length < 6) continue;
    const tournamentLink = cells[1].match(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    const opponentLink = cells[3].match(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    const tournamentKey = tournamentLink ? (() => { try { return new URL(abs(tournamentLink[1].replace(/&amp;/g,'&'), base)).searchParams.get('tournament'); } catch { return null; } })() : null;
    const opponentId = opponentLink ? (() => { try { return new URL(abs(opponentLink[1].replace(/&amp;/g,'&'), base)).searchParams.get('player'); } catch { return null; } })() : null;
    const rawDate = cleanHtml(cells[4]);
    const m = rawDate.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    out.push({
      tournamentKey, tournamentName: cleanHtml(tournamentLink?.[2] ?? cells[1]), round: cleanHtml(cells[2]),
      opponentId, opponentName: cleanHtml(opponentLink?.[2] ?? cells[3]), date: m ? `${m[3]}-${m[2]}-${m[1]}` : null,
      score: cleanHtml(cells[5]),
    });
  }
  return out;
}

/* ---------- Player statistics table (averages per match: serve/rally/return) ---------- */
export type WTSLPlayerStatLine = {
  playerId: string; name: string; firstServePct: number|null; avgAces: number|null; avgDoubleFaults: number|null;
  avgFirstServeSpeed: number|null; avgSecondServeSpeed: number|null; avgNetPointsPct: number|null; avgWinners: number|null;
  avgForcedErrors: number|null; avgUnforcedErrors: number|null; avgBpConversionPct: number|null; avgShortRalliesPct: number|null;
  avgMediumRalliesPct: number|null; avgLongRalliesPct: number|null; avgFirstServeWonPct: number|null; avgSecondServeWonPct: number|null;
  avgReturnWonPct: number|null; avgRallyLength: number|null;
};

function statsUrl(tour: TourCode) {
  return `${WTSL_BASE}/player_stats.php?tour=${encodeURIComponent(tour)}`;
}

function num(s: string | undefined): number | null {
  if (!s) return null;
  const n = parseFloat(s.replace(/[^0-9.-]/g,''));
  return Number.isFinite(n) ? n : null;
}

/** Parses the per-tour "Player Statistics" table. The markup never closes its <tr> tags, so rows
 * are split on the literal `<tr>` marker instead of matched with a `<tr>...</tr>` regex. */
export function parsePlayerStatsTable(html: string): WTSLPlayerStatLine[] {
  const body = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i)?.[1] ?? '';
  const rows = body.split(/<tr>/i).slice(1);
  const out: WTSLPlayerStatLine[] = [];
  for (const row of rows) {
    const cells = (row.match(/<td[\s\S]*?<\/td>/gi) ?? []).map(cleanHtml);
    if (cells.length < 18) continue;
    const link = row.match(/<a[^>]+href=["']([^"']*player=[^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue; // skips the synthetic "Tour average" row
    let playerId = '';
    try { playerId = new URL(abs(link[1].replace(/&amp;/g,'&'))).searchParams.get('player') ?? ''; } catch { continue; }
    if (!playerId) continue;
    const [, firstServePct, avgAces, avgDoubleFaults, avgFirstServeSpeed, avgSecondServeSpeed, avgNetPointsPct, avgWinners,
      avgForcedErrors, avgUnforcedErrors, avgBpConversionPct, avgShortRalliesPct, avgMediumRalliesPct, avgLongRalliesPct,
      avgFirstServeWonPct, avgSecondServeWonPct, avgReturnWonPct, avgRallyLength] = cells;
    out.push({
      playerId, name: cleanHtml(link[2]),
      firstServePct: num(firstServePct), avgAces: num(avgAces), avgDoubleFaults: num(avgDoubleFaults),
      avgFirstServeSpeed: num(avgFirstServeSpeed), avgSecondServeSpeed: num(avgSecondServeSpeed), avgNetPointsPct: num(avgNetPointsPct),
      avgWinners: num(avgWinners), avgForcedErrors: num(avgForcedErrors), avgUnforcedErrors: num(avgUnforcedErrors),
      avgBpConversionPct: num(avgBpConversionPct), avgShortRalliesPct: num(avgShortRalliesPct), avgMediumRalliesPct: num(avgMediumRalliesPct),
      avgLongRalliesPct: num(avgLongRalliesPct), avgFirstServeWonPct: num(avgFirstServeWonPct), avgSecondServeWonPct: num(avgSecondServeWonPct),
      avgReturnWonPct: num(avgReturnWonPct), avgRallyLength: num(avgRallyLength),
    });
  }
  return out;
}

export async function fetchWTSLPlayerStatsTable(tour: TourCode = DEFAULT_TOUR): Promise<WTSLPlayerStatLine[]> {
  const res = await fetch(statsUrl(tour), { cache:'no-store', headers:{'user-agent':'WTSL-Community-Bridge/1.0'} });
  if (!res.ok) throw new Error(`WTSL player stats request failed: ${res.status}`);
  return parsePlayerStatsTable(await res.text());
}

/* ---------- Rankings (full player list) ---------- */
export const RANKINGS_URL = rankingsUrl(DEFAULT_TOUR);

export type WTSLRankedPlayer = {
  id: string; name: string; rank: number | null; tourElo: number | null; eloLabel: string | null;
  country: string | null; avatarUrl: string | null; flagUrl: string | null; officialUrl: string; tour: TourCode;
};

/**
 * Defensive parser: finds every table row that links to a player page (?player=ID), reads the
 * Rank / Elo / Country columns by their <th> header text, and falls back to sensible guesses.
 */
export function parseRankings(html: string, base = RANKINGS_URL, tour: TourCode = DEFAULT_TOUR): WTSLRankedPlayer[] {
  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  const cols: { rank?: number; elo?: number; country?: number } = {};
  const out: WTSLRankedPlayer[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const heads = row.match(/<th[\s\S]*?<\/th>/gi);
    if (heads && !/player=/i.test(row)) {
      heads.forEach((h, i) => {
        const t = cleanHtml(h).toLowerCase();
        if (/^(#|rank|pos)/.test(t) && cols.rank === undefined) cols.rank = i;
        else if (/elo/.test(t) && cols.elo === undefined) cols.elo = i;
        else if (/(country|nation)/.test(t) && cols.country === undefined) cols.country = i;
      });
      continue;
    }
    const links = [...row.matchAll(/<a[^>]+href=["']([^"']*player=[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
    if (!links.length) continue;
    const officialUrl = abs(links[0][1].replace(/&amp;/g, '&'), base);
    let id = '';
    try { id = new URL(officialUrl).searchParams.get('player') ?? ''; } catch { /* ignore */ }
    if (!id || seen.has(id)) continue;

    const cells = (row.match(/<td[\s\S]*?<\/td>/gi) ?? []).map(cleanHtml);
    const imgs = [...row.matchAll(/<img([^>]+)>/gi)].map((m) => ({ src: attr(m[1], 'src'), alt: attr(m[1], 'alt') }));
    const flag = imgs.find((i) => /flag/i.test(i.src ?? '') || /flag/i.test(i.alt ?? ''));
    const avatar = imgs.find((i) => i !== flag && i.src);

    const name = links.map((l) => cleanHtml(l[2])).find(Boolean) || avatar?.alt || '';
    if (!name) continue;

    const rankText = cols.rank !== undefined ? cells[cols.rank] : cells[0];
    const rank = /^\d+$/.test((rankText ?? '').trim()) ? Number(rankText) : null;
    const rowText = cleanHtml(row);
    const eloText = cols.elo !== undefined ? cells[cols.elo] ?? '' : (rowText.match(/Elo\s*(\d+(?:\s*\([^)]*\))?)/i)?.[1] ?? '');
    const tourElo = eloText.match(/\d+/)?.[0] ? Number(eloText.match(/\d+/)![0]) : null;
    const eloLabel = eloText.match(/\(([^)]+)\)/)?.[1] ?? null;
    const country = (cols.country !== undefined ? cells[cols.country] : '') || (flag?.alt ?? '').replace(/flag/i, '').trim() || null;

    seen.add(id);
    out.push({ id, name, rank, tourElo, eloLabel, country, avatarUrl: avatar?.src ? abs(avatar.src, base) : null, flagUrl: flag?.src ? abs(flag.src, base) : null, officialUrl, tour });
  }
  return out;
}

export async function fetchWTSLRankings(tour: TourCode = DEFAULT_TOUR): Promise<WTSLRankedPlayer[]> {
  const url = rankingsUrl(tour);
  const res = await fetch(url, { cache: 'no-store', headers: { 'user-agent': 'WTSL-Community-Bridge/1.0' } });
  if (!res.ok) throw new Error(`WTSL rankings request failed: ${res.status}`);
  const players = parseRankings(await res.text(), url, tour);
  if (!players.length) throw new Error('Rankings page returned no parsable players (run the sync with ?debug=1)');
  return players;
}

/*
 * ---------- All-results feed (character usage) ----------
 * This is the same public page the Discord bot scrapes to track which Tennis Elbow 4 character
 * each player picked for every match. It only ever returns "ATP Characters" rows — appending
 * ?tour=TE4_(F) (or any other tour code) to the URL is silently ignored and returns identical
 * content — so WTSL does not publish per-match character data for WTA/Doubles/Coop/Created
 * anywhere public. Character tracking below is therefore ATP (TE4) only.
 */
const ALL_RESULTS_URL = `${WTSL_BASE}/all_results_fetch.php`;

export type WTSLAllResultRow = {
  tournamentName: string; round: string;
  player1Id: string; player1Name: string; player1Character: string | null;
  player2Id: string; player2Name: string; player2Character: string | null;
  date: string | null; score: string;
};

/** Parses a "Name (Character)" cell, where Character is empty `()` when nothing was recorded. */
function parseNameCharacterCell(cell: string): { id: string | null; name: string; character: string | null } {
  const link = cell.match(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
  let id: string | null = null;
  if (link) { try { id = new URL(abs(link[1].replace(/&amp;/g, '&'), ALL_RESULTS_URL)).searchParams.get('player'); } catch { /* ignore */ } }
  const name = cleanHtml(link?.[2] ?? '');
  const rest = cleanHtml(cell.replace(link?.[0] ?? '', ''));
  const character = rest.match(/\(([^)]+)\)/)?.[1]?.trim() || null;
  return { id, name, character };
}

export function parseAllResults(html: string): WTSLAllResultRow[] {
  const body = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i)?.[1] ?? '';
  const rows = body.match(/<tr>[\s\S]*?<\/tr>/gi) ?? [];
  const out: WTSLAllResultRow[] = [];
  for (const row of rows) {
    const cells = row.match(/<td[\s\S]*?<\/td>/gi) ?? [];
    if (cells.length < 8) continue;
    const tournamentLink = cells[1].match(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    const p1 = parseNameCharacterCell(cells[3]);
    const p2 = parseNameCharacterCell(cells[4]);
    if (!p1.id || !p2.id) continue;
    const rawDate = cleanHtml(cells[5]);
    const m = rawDate.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    out.push({
      tournamentName: cleanHtml(tournamentLink?.[2] ?? cells[1]), round: cleanHtml(cells[2]),
      player1Id: p1.id, player1Name: p1.name, player1Character: p1.character,
      player2Id: p2.id, player2Name: p2.name, player2Character: p2.character,
      date: m ? `${m[3]}-${m[2]}-${m[1]}` : null, score: cleanHtml(cells[7]),
    });
  }
  return out;
}

export async function fetchWTSLAllResults(): Promise<WTSLAllResultRow[]> {
  const res = await fetch(ALL_RESULTS_URL, { cache: 'no-store', headers: { 'user-agent': 'WTSL-Community-Bridge/1.0' } });
  if (!res.ok) throw new Error(`WTSL all-results request failed: ${res.status}`);
  return parseAllResults(await res.text());
}

/** Diagnostic used by /api/sync/wtsl?debug=1 — shows what was fetched and what the parser made of it. */
export async function inspectWTSLRankings(tour: TourCode = DEFAULT_TOUR) {
  const url = rankingsUrl(tour);
  const res = await fetch(url, { cache: 'no-store', headers: { 'user-agent': 'WTSL-Community-Bridge/1.0' } });
  const html = await res.text();
  const players = parseRankings(html, url, tour);
  return {
    status: res.status, htmlLength: html.length, tableRows: (html.match(/<tr/gi) ?? []).length, parsed: players.length,
    sample: players.slice(0, 5),
    firstRowsHtml: (html.match(/<tr[\s\S]*?<\/tr>/gi) ?? []).slice(0, 3).map((r) => r.slice(0, 700)),
  };
}

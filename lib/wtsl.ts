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
export function tourLabel(tour: string) {
  return TOURS.find((t) => t.code === tour)?.short ?? tour;
}
function tournamentsUrl(tour: TourCode) {
  return `${WTSL_BASE}/tournaments.php?tour=${encodeURIComponent(tour)}`;
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

export async function fetchWTSLTournaments(tour: TourCode = DEFAULT_TOUR): Promise<WTSLTournament[]> {
  const url = tournamentsUrl(tour);
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
    const key = `${tour.toLowerCase().replace(/[^a-z0-9]+/g,'-')}-${name.toLowerCase().replace(/[^a-z0-9]+/g,'-')}-${startDate ?? 'unknown'}`;
    out.push({key,name,location,country,category,drawSize:Number.isFinite(drawSize)?drawSize:null,surface,startDate,status,champion,championUrl,officialUrl,tour});
  }
  return out;
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
  return {id,name,avatarUrl:avatar?.src?abs(avatar.src,playerUrl):null,flagUrl:flag?.src?abs(flag.src,playerUrl):null,country:nationality,rank:rank?Number(rank):null,tourElo:elo?Number(elo):null,eloLabel,officialUrl:playerUrl};
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

const WTSL_BASE = 'https://www.playwtsl.com/TE4/pages';
export const TOURNAMENTS_URL = `${WTSL_BASE}/tournaments.php?tour=TE4`;

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
  officialUrl:string;
};

export async function fetchWTSLTournaments(): Promise<WTSLTournament[]> {
  const res = await fetch(TOURNAMENTS_URL, { cache:'no-store', headers:{'user-agent':'WTSL-Community-Bridge/1.0'} });
  if (!res.ok) throw new Error(`WTSL tournaments request failed: ${res.status}`);
  const html = await res.text();
  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  const out:WTSLTournament[] = [];
  for (const row of rows) {
    const cells = row.match(/<td[\s\S]*?<\/td>/gi) ?? [];
    if (cells.length < 7) continue;
    const links = [...row.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
    const nameLink = links.find(x => !/SignUp|Finished|Ongoing|Cancelled/i.test(cleanHtml(x[2])));
    const name = cleanHtml(nameLink?.[2] ?? cells[0]);
    if (!name || /Tournament/i.test(name)) continue;
    const officialUrl = abs(nameLink?.[1] ?? '#');
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
    const championUrl = championHref ? abs(championHref) : null;
    const key = `${name.toLowerCase().replace(/[^a-z0-9]+/g,'-')}-${startDate ?? 'unknown'}`;
    out.push({key,name,location,country,category,drawSize:Number.isFinite(drawSize)?drawSize:null,surface,startDate,status,champion,championUrl,officialUrl});
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

const TE4_COACH_ORIGIN = 'https://replays.knowthew.net';

export type Te4CoachShareUrlResult =
  | { valid: true; url: string | null }
  | { valid: false; url: null };

function invalidShareUrl(): Te4CoachShareUrlResult {
  return { valid: false, url: null };
}

export function parseTe4CoachShareUrl(value: unknown): Te4CoachShareUrlResult {
  if (value === null || value === undefined) return { valid: true, url: null };
  if (typeof value !== 'string' || value.length > 500) return invalidShareUrl();
  const raw = value.trim();
  if (!raw) return { valid: true, url: null };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return invalidShareUrl();
  }

  if (
    url.origin !== TE4_COACH_ORIGIN
    || url.username
    || url.password
    || url.port
    || url.hash
  ) {
    return invalidShareUrl();
  }

  if (/^\/(?:m|tv)\/[A-Za-z0-9_-]{1,80}\/?$/.test(url.pathname)) {
    return [...url.searchParams].length === 0
      ? { valid: true, url: url.toString() }
      : invalidShareUrl();
  }

  if (!/^\/w\/[A-Za-z0-9]{24}\/?$/.test(url.pathname)) return invalidShareUrl();
  const keys = [...url.searchParams.keys()];
  const matchNumbers = url.searchParams.getAll('m');
  const points = url.searchParams.getAll('p');
  if (
    keys.some((key) => key !== 'm' && key !== 'p')
    || matchNumbers.length !== 1
    || !/^[1-9]\d{0,8}$/.test(matchNumbers[0])
    || points.length > 1
    || (points.length === 1 && !/^(0|[1-9]\d{0,8})$/.test(points[0]))
  ) {
    return invalidShareUrl();
  }

  return { valid: true, url: url.toString() };
}

export function buildTe4CoachEmbedUrl(value: unknown): string | null {
  const share = parseTe4CoachShareUrl(value);
  if (!share.valid || !share.url) return null;
  const embed = new URL('/embed', TE4_COACH_ORIGIN);
  embed.searchParams.set('share', share.url);
  return embed.toString();
}

export function buildTe4CoachAnalysisUrl(value: unknown): string | null {
  const share = parseTe4CoachShareUrl(value);
  if (!share.valid || !share.url) return null;
  const analysis = new URL('/', TE4_COACH_ORIGIN);
  analysis.searchParams.set('share', share.url);
  return analysis.toString();
}

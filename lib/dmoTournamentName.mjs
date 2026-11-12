const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

const eventAliases = [
  [/\b(?:philippe|phillipe|philipe)\s+(?:chatrier|chartrier|chatrie[r]?)\b/i, 'Roland-Garros'],
  [/\b(?:roland[-\s]?garros|french open)\b/i, 'Roland-Garros'],
  [/\b(?:rod laver|melbourne park|australian open)\b/i, 'Australian Open'],
  [/\b(?:wimbledon|all england|centre court|center court)\b/i, 'Wimbledon'],
  [/\b(?:arthur ashe|flushing meadows|us open)\b/i, 'US Open'],
  [/\bshanghai(?:\s+(?:masters|atp\s*1000))?\b/i, 'Shanghai Masters'],
  [/\bparis\s+(?:masters|atp\s*1000)\b/i, 'Paris Masters'],
  [/\b(?:indian wells|bn[p]? paribas open)\b/i, 'BNP Paribas Open'],
  [/\brome\s+(?:atp\s*1000|masters)\b/i, 'Italian Open'],
  [/\bmadrid\s+(?:atp\s*1000|masters)\b/i, 'Madrid Open'],
  [/\bmonte[-\s]?carlo\s+(?:atp\s*1000|masters)\b/i, 'Monte-Carlo Masters'],
  [/\b(?:toronto|montreal|canada)\s+(?:atp\s*1000|wta\s*1000|masters)\b/i, 'Canadian Open'],
];

const venueOnly = /^(?:court|stadium|arena|centre court|center court|tennis centre|tennis center)\b/i;

/**
 * Convert TE4 venue-like labels to an event name, or omit labels that cannot
 * be safely identified as a tournament.
 */
export function normalizeDmoTournamentName(value) {
  const raw = clean(value);
  if (!raw) return null;

  const withoutCode = raw.replace(/^\d{2,5}\s+/, '').trim();
  for (const [pattern, officialName] of eventAliases) {
    if (pattern.test(withoutCode)) return officialName;
  }

  if (venueOnly.test(withoutCode) || /^\d{2,5}$/.test(withoutCode)) return null;
  return withoutCode || null;
}

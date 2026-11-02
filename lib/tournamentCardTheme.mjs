function normalize(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

/**
 * Choose a restrained card palette from the real event identity, then its court surface.
 * Unrecognized events keep a neutral WTSL theme rather than being guessed.
 *
 * @param {unknown} name
 * @param {unknown} surface
 * @returns {'australian-open' | 'roland-garros' | 'wimbledon' | 'us-open' | 'indian-wells' | 'indoor' | 'grass' | 'clay' | 'hard' | 'classic'}
 */
export function tournamentCardTheme(name, surface) {
  const eventName = normalize(name);
  if (/\baustralian open\b/.test(eventName)) return 'australian-open';
  if (/\broland[\s-]?garros\b|\bfrench open\b/.test(eventName)) return 'roland-garros';
  if (/\bwimbledon\b/.test(eventName)) return 'wimbledon';
  if (/\bus open\b|\bflushing meadows\b/.test(eventName)) return 'us-open';
  if (/\bindian wells\b/.test(eventName)) return 'indian-wells';

  const court = normalize(surface);
  if (/\bindoor\b|\bcarpet\b/.test(court)) return 'indoor';
  if (/\bgrass\b/.test(court)) return 'grass';
  if (/\bclay\b/.test(court)) return 'clay';
  if (/\bhard\b/.test(court)) return 'hard';
  return 'classic';
}

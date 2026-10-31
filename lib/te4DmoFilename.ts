export function parseDmoFilename(filename: string): { names: [string, string]; score: string | null } {
  const leaf = filename.split(/[\\/]/).at(-1) || filename;
  const normalized = leaf
    .replace(/\.dmo$/i, '')
    .replaceAll('_', ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const scoreMatch = /(?:^|\s)((?:\d{1,2}-\d{1,2}(?:\(\d{1,2}\))?)(?:\s+\d{1,2}-\d{1,2}(?:\(\d{1,2}\))?)*)$/.exec(normalized);
  const matchLabel = scoreMatch
    ? normalized.slice(0, scoreMatch.index).trim()
    : normalized;
  const match = /^(.+?)\s+(?:vs?\.?|v)\s+(.+)$/i.exec(matchLabel);
  if (!match) return { names: ['Player 1', 'Player 2'], score: null };
  const player1 = match[1].split(/\s+[-–—]\s+/).at(-1)?.trim() || '';
  const player2 = match[2].trim();
  if (!player1 || !player2) return { names: ['Player 1', 'Player 2'], score: null };
  return {
    names: [player1, player2],
    score: scoreMatch?.[1].trim() || null,
  };
}

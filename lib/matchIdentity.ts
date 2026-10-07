export type ParsedSetScore = readonly [number, number];

function normalizeIdentityToken(value: unknown) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

const PLACEHOLDER_PLAYER_NAMES = new Set([
  'tbc',
  'tba',
  'tbd',
  'tobeconfirmed',
  'tobeannounced',
]);

export function isPlaceholderPlayerName(value: unknown) {
  const normalized = normalizeIdentityToken(value);
  return !normalized || PLACEHOLDER_PLAYER_NAMES.has(normalized);
}

/** Returns the score from the stable, sorted-player perspective. */
export function scoreSignatureForPlayerOrder(
  sets: ParsedSetScore[],
  reverse: boolean,
) {
  return sets
    .map(([first, second]) => reverse ? [second, first] : [first, second])
    .map(([first, second]) => `${first}-${second}`)
    .join(' ');
}

/** Reorients a display score while retaining any tiebreak points in parentheses. */
export function orientScoreForPlayerOrder(score: string, reverse: boolean) {
  const normalized = score
    .replace(/\//g, '-')
    .replace(/[,;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!reverse) return normalized;

  return normalized.split(' ').map((set) => {
    const match = set.match(/^(\d+)-(\d+)(.*)$/);
    return match ? `${match[2]}-${match[1]}${match[3]}` : set;
  }).join(' ');
}

export function buildImportedMatchSourceId(input: {
  tour: string;
  tournamentKey: string | null;
  tournamentName: string;
  round: string | null;
  playedAt: string | null;
  playerOneId: string;
  playerTwoId: string;
  winnerId: string;
  scoreSignature: string;
}) {
  const pair = [input.playerOneId, input.playerTwoId].sort();
  const date = input.playedAt?.slice(0, 10) ?? '';
  const eventKey = input.tournamentKey
    ? `key-${input.tournamentKey}`
    : date
      ? 'dated'
      : `name-${normalizeIdentityToken(input.tournamentName) || 'unknown'}`;
  const roundKey = date
    ? ''
    : normalizeIdentityToken(input.round) || 'unknown';
  const parts = [
    input.tour,
    eventKey,
    date || 'undated',
    roundKey,
    pair[0],
    pair[1],
    input.winnerId,
    input.scoreSignature,
  ];
  return `import:v2:${parts.map((part) => encodeURIComponent(part)).join(':')}`;
}

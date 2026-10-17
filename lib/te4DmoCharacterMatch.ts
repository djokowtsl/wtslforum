import type { WTSLAllResultRow } from './wtsl';
import type {
  Te4AnalysisResult,
  Te4CharacterAttribution,
} from './te4DmoTypes';

type DmoMatchEvidence = Pick<
  Te4AnalysisResult,
  'names' | 'score' | 'sets' | 'viewer'
>;

function comparisonKey(value: string): string {
  return value
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function tournamentKey(value: string): string {
  return comparisonKey(value.replace(/^\s*\d{3,4}\s+/, ''));
}

function playerKey(value: string): string {
  const withoutDecoration = value
    .replace(/\s+aka\s+.*$/i, '')
    .replace(/[\u{1F000}-\u{1FFFF}\u{2190}-\u{2BFF}\u{2600}-\u{27BF}\uFE0F\u200D]/gu, '');
  return comparisonKey(withoutDecoration);
}

function scoreKey(value: string): string | null {
  const withoutTiebreakPoints = value
    .normalize('NFKC')
    .replace(/[–—]/g, '-')
    .replace(/\(\s*\d+\s*\)/g, '');
  const pairPattern = /(\d{1,2})\s*-\s*(\d{1,2})/g;
  const pairs = [...withoutTiebreakPoints.matchAll(pairPattern)];
  const remainder = withoutTiebreakPoints
    .replace(pairPattern, '')
    .replace(/[\s,;|_]/g, '');
  if (!pairs.length || remainder) return null;
  return pairs
    .map(([, first, second]) => `${Number(first)}-${Number(second)}`)
    .join(' ');
}

function safeCharacterName(value: string | null): string | null {
  const name = value?.trim().slice(0, 120) || '';
  return name || null;
}

function emptyAttribution(
  status: Te4CharacterAttribution['status'],
  source: Te4CharacterAttribution['source'] = null,
): Te4CharacterAttribution {
  return { status, source, match: null, players: null };
}

export function resolveDmoCharacterMatch(
  analysis: DmoMatchEvidence,
  rows: readonly WTSLAllResultRow[],
): Te4CharacterAttribution {
  const names = analysis.names;
  const playerNames = Array.isArray(names) && names.length === 2
    ? names.map((name) => playerKey(String(name || '')))
    : [];
  const tournament = typeof analysis.viewer?.tournament === 'string'
    ? tournamentKey(analysis.viewer.tournament)
    : '';
  const dmoScore = typeof analysis.score === 'string'
    ? scoreKey(analysis.score)
    : null;
  const reconstructedScore = Array.isArray(analysis.sets)
    ? scoreKey(analysis.sets.map(([first, second]) => `${first}-${second}`).join(' '))
    : null;

  if (
    playerNames.length !== 2
    || playerNames.some((name) => !name || /^player\s*[12]$/.test(name))
    || playerNames[0] === playerNames[1]
    || !tournament
    || !dmoScore
    || !reconstructedScore
    || dmoScore !== reconstructedScore
  ) {
    return emptyAttribution('insufficient_metadata');
  }

  const matches: Array<{
    row: WTSLAllResultRow;
    reversed: boolean;
  }> = [];

  for (const row of rows) {
    if (!row.player1Id || !row.player2Id || row.player1Id === row.player2Id) continue;
    if (tournamentKey(row.tournamentName) !== tournament) continue;

    const first = playerKey(row.player1Name);
    const second = playerKey(row.player2Name);
    const sameOrder = first === playerNames[0] && second === playerNames[1];
    const reversed = first === playerNames[1] && second === playerNames[0];
    if (!sameOrder && !reversed) continue;

    const rowScore = scoreKey(row.score);
    if (!rowScore) continue;
    const scoreInDmoOrder = reversed
      ? rowScore
        .split(' ')
        .map((set) => {
          const [left, right] = set.split('-');
          return `${right}-${left}`;
        })
        .join(' ')
      : rowScore;
    if (scoreInDmoOrder !== dmoScore) continue;
    matches.push({ row, reversed });
  }

  if (!matches.length) return emptyAttribution('not_found', 'WTSL all-results');
  if (matches.length !== 1) return emptyAttribution('ambiguous', 'WTSL all-results');

  const { row, reversed } = matches[0];
  const playerCharacters: [string | null, string | null] = reversed
    ? [safeCharacterName(row.player2Character), safeCharacterName(row.player1Character)]
    : [safeCharacterName(row.player1Character), safeCharacterName(row.player2Character)];

  return {
    status: 'matched',
    source: 'WTSL all-results',
    match: {
      tournamentName: row.tournamentName,
      round: row.round,
      date: row.date,
    },
    players: [
      { character: playerCharacters[0], profile: null },
      { character: playerCharacters[1], profile: null },
    ],
  };
}

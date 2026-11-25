import type { BracketMatch, BracketRound, TournamentBracketData } from '@/lib/challongeBracketData';
import styles from './TournamentBracket.module.css';

const TOP_PADDING = 34;
const ROUND_WIDTH = 219;
const ROUND_HEIGHT = 76;
const MATCH_WIDTH = 204;
const MATCH_HEIGHT = 52;

function roundTitleLines(name: string): string[] {
  const title = name.split(/\s+-\s+/)[0].trim();
  const lines: string[] = [];
  let current = '';
  for (const word of title.split(/\s+/)) {
    const next = current ? `${current} ${word}` : word;
    if (current && next.length > 24) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  if (lines.length > 2) lines.splice(1, lines.length - 1, `${lines.slice(1).join(' ').slice(0, 21)}…`);
  return lines;
}

function sectionTitle(side: string): string {
  if (side === 'winners') return 'WINNERS BRACKET';
  if (side === 'losers') return 'LOSERS BRACKET';
  return 'TOURNAMENT DRAW';
}

function roundHeader(round: BracketRound) {
  const titleLines = roundTitleLines(round.name);
  return (
    <g key={round.key} transform={`translate(${round.x} ${round.sectionY})`} className={styles.round}>
      <title>{round.name}</title>
      <rect className={styles.roundBackground} width={ROUND_WIDTH} height={ROUND_HEIGHT} rx="3" />
      {titleLines.map((line, index) => (
        <text
          className={styles.roundTitle}
          key={`${round.key}-title-${index}`}
          x={ROUND_WIDTH / 2}
          y={titleLines.length > 1 ? 22 + index * 14 : 29}
          textAnchor="middle"
        >
          {line}
        </text>
      ))}
      {round.bestOf && (
        <text
          className={styles.roundFormat}
          x={ROUND_WIDTH / 2}
          y={titleLines.length > 1 ? 61 : 56}
          textAnchor="middle"
        >
          {round.bestOf.toUpperCase()}
        </text>
      )}
    </g>
  );
}

function accessiblePlayer(name: string, seed: string | null): string {
  return [seed ? `seed ${seed}` : '', name].filter(Boolean).join(' ') || 'unannounced player';
}

function matchLabel(match: BracketMatch): string {
  const score = match.scores.some(Boolean)
    ? `, score ${match.scores.filter(Boolean).join(' to ')}`
    : '';
  return `${accessiblePlayer(match.team1, match.team1Seed)} versus ${accessiblePlayer(match.team2, match.team2Seed)}${score}`;
}

function bracketMatch(match: BracketMatch) {
  const players = [
    { name: match.team1, seed: match.team1Seed, score: match.scores[0], y: 17, winner: match.winner === 1 },
    { name: match.team2, seed: match.team2Seed, score: match.scores[1], y: 43, winner: match.winner === 2 },
  ];
  return (
    <g
      key={match.matchId}
      className={styles.match}
      transform={`translate(${match.x} ${match.y})`}
      role="group"
      aria-label={matchLabel(match)}
    >
      <title>{matchLabel(match)}</title>
      <rect className={styles.matchBackground} width={MATCH_WIDTH} height={MATCH_HEIGHT} rx="3" />
      <line className={styles.matchDivider} x1="0" x2={MATCH_WIDTH} y1={MATCH_HEIGHT / 2} y2={MATCH_HEIGHT / 2} />
      {players.map((player, index) => (
        <g key={`${match.matchId}-${index}`}>
          <text className={`${styles.playerName}${player.winner ? ` ${styles.winner}` : ''}`} x="8" y={player.y}>
            {player.seed && <tspan className={styles.seed}>({player.seed}) </tspan>}
            {player.name}
          </text>
          {player.score !== null && (
            <text
              className={`${styles.playerScore}${player.winner ? ` ${styles.winner}` : ''}`}
              x={MATCH_WIDTH - 8}
              y={player.y}
              textAnchor="end"
            >
              {player.score}
            </text>
          )}
        </g>
      ))}
    </g>
  );
}

export default function TournamentBracketDiagram({
  bracket,
  tournamentName,
  zoom,
}: {
  bracket: TournamentBracketData;
  tournamentName: string;
  zoom: number;
}) {
  const rounds = [...bracket.winners, ...bracket.losers, ...bracket.main];
  return (
    <svg
      className={styles.diagram}
      width={bracket.width}
      height={bracket.height + TOP_PADDING}
      viewBox={`0 0 ${bracket.width} ${bracket.height + TOP_PADDING}`}
      preserveAspectRatio="xMinYMin meet"
      style={{ width: `${zoom * 100}%` }}
      role="img"
      aria-label={`${tournamentName} bracket with player character picks`}
    >
      <title>{`${tournamentName} tournament bracket`}</title>
      <desc>Our interactive bracket rendering, showing players, character picks, scores, rounds, and match progression.</desc>
      <g transform={`translate(0 ${TOP_PADDING})`}>
        {bracket.connectors.map((connector, index) => (
          <path
            className={styles.connector}
            key={`connector-${index}`}
            d={connector.path}
            transform={`translate(${connector.x} ${connector.y})`}
          />
        ))}
        {bracket.sections.map((section) => (
          <text
            className={styles.sectionLabel}
            key={`section-${section.index}`}
            x="0"
            y={section.offsetY - 11}
          >
            {sectionTitle(section.side)}
          </text>
        ))}
        {rounds.map(roundHeader)}
        {rounds.flatMap((round) => round.matches).map(bracketMatch)}
      </g>
    </svg>
  );
}

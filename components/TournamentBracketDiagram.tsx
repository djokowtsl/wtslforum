import type { BracketMatch, BracketRound, TournamentBracketData } from '@/lib/challongeBracketData';
import { displayBracketScore } from '@/lib/tournamentBracketResults';
import styles from './TournamentBracket.module.css';
import type { KeyboardEvent } from 'react';

const TOP_PADDING = 34;
const ROUND_WIDTH = 216;
const ROUND_HEIGHT = 76;
const MATCH_WIDTH = 204;
const MATCH_HEIGHT = 72;
const VERTICAL_SPACING_SCALE = 1.4;

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
    <g
      key={round.key}
      transform={`translate(${round.x} ${round.sectionY * VERTICAL_SPACING_SCALE})`}
      className={styles.round}
    >
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
  const displayedScore = displayBracketScore(match);
  const score = displayedScore ? `, score ${displayedScore}` : '';
  return `${accessiblePlayer(match.team1, match.team1Seed)} versus ${accessiblePlayer(match.team2, match.team2Seed)}${score}`;
}

function bracketMatch(match: BracketMatch, onSelect: (match: BracketMatch) => void) {
  const players = [
    { name: match.team1, seed: match.team1Seed, y: 20, winner: match.winner === 1 },
    { name: match.team2, seed: match.team2Seed, y: 44, winner: match.winner === 2 },
  ];
  const fullScore = displayBracketScore(match);
  return (
    <g
      key={match.matchId}
      className={styles.match}
      transform={`translate(${match.x} ${match.y})`}
      role="button"
      tabIndex={0}
      aria-label={`${matchLabel(match)}. View matchup details.`}
      onClick={() => onSelect(match)}
      onKeyDown={(event: KeyboardEvent<SVGGElement>) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(match);
        }
      }}
    >
      <title>{matchLabel(match)}</title>
      <rect className={styles.matchBackground} width={MATCH_WIDTH} height={MATCH_HEIGHT} rx="3" />
      <line className={styles.matchDivider} x1="0" x2={MATCH_WIDTH} y1="32" y2="32" />
      {players.map((player, index) => (
        <g key={`${match.matchId}-${index}`}>
          <text
            className={`${styles.playerName}${player.winner ? ` ${styles.winner}` : ''}`}
            x="8"
            y={player.y}
            textLength={Math.min(MATCH_WIDTH - 34, Math.max(8, `${player.seed ? `(${player.seed}) ` : ''}${player.name}`.length * 5.6))}
            lengthAdjust="spacingAndGlyphs"
          >
            {player.seed && <tspan className={styles.seed}>({player.seed}) </tspan>}
            {player.name}
          </text>
          {player.winner && (
            <text className={styles.winnerCheck} x={MATCH_WIDTH - 8} y={player.y} textAnchor="end" aria-hidden="true">
              ✓
            </text>
          )}
        </g>
      ))}
      {fullScore && (
        <text className={styles.matchSetScore} x="8" y="64" textLength={Math.min(MATCH_WIDTH - 16, Math.max(24, fullScore.length * 5.4))} lengthAdjust="spacingAndGlyphs">
          {fullScore}
        </text>
      )}
    </g>
  );
}

export default function TournamentBracketDiagram({
  bracket,
  tournamentName,
  zoom,
  onMatchSelect,
}: {
  bracket: TournamentBracketData;
  tournamentName: string;
  zoom: number;
  onMatchSelect: (match: BracketMatch) => void;
}) {
  const rounds = [...bracket.winners, ...bracket.losers, ...bracket.main];
  const diagramWidth = Math.max(
    bracket.width,
    ...rounds.map((round) => round.x + Math.max(ROUND_WIDTH, MATCH_WIDTH)),
  );
  const diagramHeight = Math.max(
    bracket.height * VERTICAL_SPACING_SCALE,
    ...rounds.flatMap((round) =>
      round.matches.map((match) => match.y * VERTICAL_SPACING_SCALE + MATCH_HEIGHT),
    ),
  );
  return (
    <svg
      className={styles.diagram}
      width={diagramWidth}
      height={diagramHeight + TOP_PADDING}
      viewBox={`0 0 ${diagramWidth} ${diagramHeight + TOP_PADDING}`}
      preserveAspectRatio="xMinYMin meet"
      style={{ width: `${zoom * 100}%` }}
      role="img"
      aria-label={`${tournamentName} bracket with player character picks`}
    >
      <title>{`${tournamentName} tournament bracket`}</title>
      <desc>Tournament rounds, players, scores and match progression.</desc>
      <g transform={`translate(0 ${TOP_PADDING})`}>
        {bracket.connectors.map((connector, index) => (
          <path
            className={styles.connector}
            key={`connector-${index}`}
            d={connector.path}
            transform={`translate(${connector.x} ${connector.y * VERTICAL_SPACING_SCALE}) scale(1 ${VERTICAL_SPACING_SCALE})`}
          />
        ))}
        {bracket.sections.map((section) => (
          <text
            className={styles.sectionLabel}
            key={`section-${section.index}`}
            x="0"
            y={section.offsetY * VERTICAL_SPACING_SCALE - 11}
          >
            {sectionTitle(section.side)}
          </text>
        ))}
        {rounds.map(roundHeader)}
        {rounds.flatMap((round) => round.matches).map((match) =>
          bracketMatch(
            { ...match, y: match.y * VERTICAL_SPACING_SCALE },
            onMatchSelect,
          ),
        )}
      </g>
    </svg>
  );
}

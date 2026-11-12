const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

function rankingLine(player, tour) {
  const rank = Number.isInteger(player?.rank) && player.rank > 0
    ? `is ranked No. ${player.rank} in the WTSL ${tour}`
    : '';
  const elo = Number.isFinite(player?.tourElo)
    ? `has a WTSL Tour Elo of ${Math.round(player.tourElo)}`
    : '';
  if (!rank && !elo) return '';
  const detail = rank && elo ? `${rank} and ${elo}` : rank || elo;
  return `${player.name} ${detail}.`;
}

export function buildDmoCommentaryIntroduction({
  names = [],
  tournament = '',
  surface = '',
  round = '',
  context = null,
} = {}) {
  const players = [clean(names[0]) || 'Player one', clean(names[1]) || 'Player two'];
  const venue = clean(tournament);
  const court = clean(surface).toLowerCase();
  const stage = clean(round);
  const lines = [];

  const surfaceDetail = court && court !== 'unknown' ? ` on ${court} court` : '';
  const roundDetail = stage && stage.toLowerCase() !== 'auto' ? `, ${stage}` : '';
  if (venue) {
    lines.push(`We are at ${venue}${surfaceDetail}${roundDetail} for ${players[0]} against ${players[1]}.`);
  } else if (surfaceDetail) {
    lines.push(`${players[0]} faces ${players[1]}${surfaceDetail}${roundDetail}.`);
  } else {
    lines.push(`${players[0]} faces ${players[1]}.`);
  }

  const facts = buildDmoCommentaryFacts({ names: players, context });
  if (facts) lines.push(facts);
  return lines.join(' ');
}

export function buildDmoCommentaryFacts({ names = [], context = null } = {}) {
  const players = [clean(names[0]) || 'Player one', clean(names[1]) || 'Player two'];
  const lines = [];
  const tour = context?.tour === 'WTA' ? 'WTA' : context?.tour === 'ATP' ? 'ATP' : null;
  const ranked = context?.players;
  if (tour && Array.isArray(ranked)) {
    const first = rankingLine({ ...ranked[0], name: players[0] }, tour);
    const second = rankingLine({ ...ranked[1], name: players[1] }, tour);
    if (first) lines.push(first);
    if (second) lines.push(second);
  }

  const record = context?.headToHead;
  if (
    Number.isInteger(record?.matches)
    && record.matches > 0
    && Number.isInteger(record?.firstWins)
    && Number.isInteger(record?.secondWins)
    && record.firstWins + record.secondWins === record.matches
  ) {
    lines.push(
      `Their official WTSL head-to-head stands at ${players[0]} ${record.firstWins}, ${players[1]} ${record.secondWins}.`,
    );
  }
  return lines.join(' ');
}

export function buildDmoPointCommentary(point, names = []) {
  const winner = point?.winner === 1 || point?.winner === 2 ? point.winner : null;
  if (!winner) return '';
  const winnerName = clean(names[winner - 1]) || `Player ${winner}`;
  const server = point?.server === 1 || point?.server === 2 ? point.server : null;
  const rallyHits = Number.isInteger(point?.rallyHits) && point.rallyHits >= 0
    ? point.rallyHits
    : null;
  const score = clean(point?.scoreLabel);
  let line;

  if (rallyHits !== null && rallyHits >= 10) {
    line = `An extended ${rallyHits}-shot point, and ${winnerName} wins the exchange.`;
  } else if (server !== null && server !== winner) {
    line = `A strong return point from ${winnerName}.`;
  } else if (server === winner) {
    line = `The server, ${winnerName}, claims the point.`;
  } else {
    line = `${winnerName} takes the point.`;
  }

  return score ? `${line} The point began at ${score}.` : line;
}

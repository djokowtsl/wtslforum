const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

const formattedElo = (value) => Math.round(value).toLocaleString('en-GB');

function surfacePhrase(surface) {
  const court = clean(surface).toLowerCase();
  if (court === 'hard') return ' on the hard courts';
  if (court === 'grass') return ' on grass';
  if (court === 'clay') return ' on clay';
  return '';
}

export function buildDmoCommentaryIntroduction({
  names = [],
  tournament = '',
  surface = '',
  round = '',
} = {}) {
  const players = [clean(names[0]) || 'Player one', clean(names[1]) || 'Player two'];
  const venue = clean(tournament);
  const stage = clean(round);
  const roundPhrase = stage && stage.toLowerCase() !== 'auto'
    ? ` in the ${stage.toLowerCase()}`
    : '';
  const court = surfacePhrase(surface);
  if (venue) {
    return `At ${venue}, ${players[0]} takes on ${players[1]}${court}${roundPhrase}.`;
  }
  return `${players[0]} takes on ${players[1]}${court}${roundPhrase}.`;
}

export function buildDmoCommentaryFacts({ names = [], context = null } = {}) {
  const players = [clean(names[0]) || 'Player one', clean(names[1]) || 'Player two'];
  const lines = [];
  const tour = context?.tour === 'WTA' ? 'WTA' : context?.tour === 'ATP' ? 'ATP' : null;
  const ranked = context?.players;
  if (tour && Array.isArray(ranked)) {
    const firstRank = Number.isInteger(ranked[0]?.rank) && ranked[0].rank > 0
      ? ranked[0].rank
      : null;
    const secondRank = Number.isInteger(ranked[1]?.rank) && ranked[1].rank > 0
      ? ranked[1].rank
      : null;
    if (firstRank && secondRank) {
      lines.push(
        `The WTSL ${tour} rankings have ${players[0]} at No. ${firstRank} and ${players[1]} at No. ${secondRank}.`,
      );
    } else if (firstRank || secondRank) {
      const index = firstRank ? 0 : 1;
      lines.push(
        `The WTSL ${tour} rankings have ${players[index]} at No. ${firstRank ?? secondRank}.`,
      );
    }

    if (!firstRank && !secondRank) {
      const firstElo = Number.isFinite(ranked[0]?.tourElo)
        ? formattedElo(ranked[0].tourElo)
        : null;
      const secondElo = Number.isFinite(ranked[1]?.tourElo)
        ? formattedElo(ranked[1].tourElo)
        : null;
      if (firstElo && secondElo) {
        lines.push(`Their WTSL Tour Elo ratings are ${firstElo} and ${secondElo}.`);
      } else if (firstElo || secondElo) {
        const index = firstElo ? 0 : 1;
        lines.push(`${players[index]}'s WTSL Tour Elo is ${firstElo ?? secondElo}.`);
      }
    }
  }

  const record = context?.headToHead;
  if (
    Number.isInteger(record?.matches)
    && record.matches > 0
    && Number.isInteger(record?.firstWins)
    && Number.isInteger(record?.secondWins)
    && record.firstWins + record.secondWins === record.matches
  ) {
    if (record.firstWins === record.secondWins) {
      lines.push(`Their WTSL meetings are level at ${record.firstWins} apiece.`);
    } else {
      const leader = record.firstWins > record.secondWins ? players[0] : players[1];
      const leaderWins = Math.max(record.firstWins, record.secondWins);
      const otherWins = Math.min(record.firstWins, record.secondWins);
      lines.push(`${leader} leads their WTSL meetings, ${leaderWins}–${otherWins}.`);
    }
  }
  return lines.join(' ');
}

function pointsAtStart(scoreLabel) {
  const label = clean(scoreLabel).match(/\(([^()]*)\)\s*$/)?.[1]
    ?? clean(scoreLabel);
  const normalized = label.toUpperCase().replace(/\s+/g, ' ').trim();
  if (normalized === 'DEUCE') return ['40', '40'];

  const advantage = normalized.match(/^AD\s*([12])$/);
  if (advantage) return advantage[1] === '1' ? ['AD', '40'] : ['40', 'AD'];

  const pair = normalized.match(
    /^(AD|ADV|A|0|15|30|40)\s*[-–]\s*(AD|ADV|A|0|15|30|40)$/,
  );
  if (!pair) return null;
  const value = (part) => ['AD', 'ADV', 'A'].includes(part) ? 'AD' : part;
  return [value(pair[1]), value(pair[2])];
}

function isBreakPoint(points, server) {
  const serverIndex = server - 1;
  const receiverPoint = points[1 - serverIndex];
  const serverPoint = points[serverIndex];
  return (receiverPoint === '40' && ['0', '15', '30'].includes(serverPoint))
    || (receiverPoint === 'AD' && serverPoint === '40');
}

function isGamePoint(points, server) {
  const serverIndex = server - 1;
  const serverPoint = points[serverIndex];
  const receiverPoint = points[1 - serverIndex];
  return (serverPoint === '40' && ['0', '15', '30'].includes(receiverPoint))
    || (serverPoint === 'AD' && receiverPoint === '40');
}

export function buildDmoPointCommentary(point, names = []) {
  const winner = point?.winner === 1 || point?.winner === 2 ? point.winner : null;
  if (!winner) return '';
  const winnerName = clean(names[winner - 1]) || `Player ${winner}`;
  const server = point?.server === 1 || point?.server === 2 ? point.server : null;
  const serverName = server ? clean(names[server - 1]) || `Player ${server}` : '';
  const rallyHits = Number.isInteger(point?.rallyHits) && point.rallyHits >= 0
    ? point.rallyHits
    : null;
  const points = pointsAtStart(point?.scoreBeforeLabel);

  if (server !== null && points && isBreakPoint(points, server)) {
    return winner === server
      ? `${serverName} saves the break point.`
      : `And that's the break for ${winnerName}.`;
  }

  if (server !== null && winner === server && points && isGamePoint(points, server)) {
    return `That's the game for ${winnerName}.`;
  }

  if (rallyHits === null || rallyHits < 8) return '';
  const lines = [
    `A terrific exchange — ${winnerName} has the last word.`,
    `What a rally! ${winnerName} comes away with it.`,
    `A wonderful rally, finished off by ${winnerName}.`,
  ];
  return lines[(Number.isInteger(point.number) ? point.number : rallyHits) % lines.length];
}

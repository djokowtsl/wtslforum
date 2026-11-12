const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

const formattedElo = (value) => Math.round(value).toLocaleString('en-GB');

function browserVoiceScore(voice) {
  const lang = clean(voice?.lang).toLowerCase();
  const name = clean(voice?.name).toLowerCase();
  let score = lang === 'en-gb' ? 50
    : lang === 'en-au' ? 45
      : lang === 'en-ie' ? 40
        : lang === 'en-us' ? 35
          : lang.startsWith('en-') ? 30
            : lang === 'en' ? 25 : 0;

  if (/neural|natural|enhanced|premium/i.test(name)) score += 35;
  if (/google/i.test(name)) score += 20;
  if (/microsoft/i.test(name)) score += 15;
  if (voice?.localService === false) score += 5;
  return score;
}

export function rankDmoBrowserVoices(voices = []) {
  return voices
    .filter((voice) => /^en(?:-|$)/i.test(clean(voice?.lang)))
    .slice()
    .sort((first, second) => (
      browserVoiceScore(second) - browserVoiceScore(first)
      || clean(first?.name).localeCompare(clean(second?.name), 'en')
    ));
}

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
  const court = surfacePhrase(surface);
  const lines = [];
  if (venue) lines.push(`We're at ${venue}.`);
  if (stage && stage.toLowerCase() !== 'auto') {
    lines.push(`${stage} action: ${players[0]} against ${players[1]}${court}.`);
  } else {
    lines.push(`${players[0]} against ${players[1]}${court}.`);
  }
  return lines.join(' ');
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
        `In the WTSL ${tour} rankings, ${players[0]} is number ${firstRank}, with ${players[1]} at number ${secondRank}.`,
      );
    } else if (firstRank || secondRank) {
      const index = firstRank ? 0 : 1;
      lines.push(
        `In the WTSL ${tour} rankings, ${players[index]} is number ${firstRank ?? secondRank}.`,
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
      lines.push(`There's nothing between them in WTSL play: ${record.firstWins} ${record.firstWins === 1 ? 'win' : 'wins'} apiece.`);
    } else {
      const leader = record.firstWins > record.secondWins ? players[0] : players[1];
      const leaderWins = Math.max(record.firstWins, record.secondWins);
      const otherWins = Math.min(record.firstWins, record.secondWins);
      lines.push(`There's a little history here: ${leader} leads their WTSL head-to-head, ${leaderWins} to ${otherWins}.`);
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
    const lines = winner === server
      ? [
        `${serverName} holds firm — break point saved.`,
        `Big response from ${serverName}. Break point gone.`,
        `The pressure stays on, but ${serverName} saves the break point.`,
      ]
      : [
        `And that's the break for ${winnerName}!`,
        `Break point converted — ${winnerName} takes the service game.`,
        `The opening was there, and ${winnerName} takes the break.`,
      ];
    return lines[(Number.isInteger(point.number) ? point.number : rallyHits ?? 0) % lines.length];
  }

  if (server !== null && winner === server && points && isGamePoint(points, server)) {
    const lines = [
      `Game point converted — ${winnerName} closes it out.`,
      `That's the hold for ${winnerName}!`,
      `The game is sealed. ${winnerName} holds.`,
    ];
    return lines[(Number.isInteger(point.number) ? point.number : rallyHits ?? 0) % lines.length];
  }

  if (rallyHits === null || rallyHits < 8) return '';
  const lines = [
    `What a battle! ${winnerName} wins the exchange.`,
    `Shot after shot, and ${winnerName} comes through.`,
    `A real test of legs and nerve — ${winnerName} takes it.`,
    `The rally keeps building, and ${winnerName} answers last.`,
    `A terrific exchange, and ${winnerName} gets the point.`,
  ];
  return lines[(Number.isInteger(point.number) ? point.number : rallyHits) % lines.length];
}

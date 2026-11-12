const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const spokenName = (value) => clean(value)
  .replace(/_+/g, ' ')
  .replace(/([a-z])([A-Z])/g, '$1 $2')
  .replace(/\s+/g, ' ')
  .trim();

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

  // Quality takes precedence over accent: a natural US voice is preferable
  // to a basic UK system voice. Voice labels are hints, not an audio guarantee.
  if (/neural|natural|enhanced|premium/i.test(name)) score += 200;
  else if (/google/i.test(name)) score += 100;
  if (voice?.localService === false) score += 5;
  return score;
}

export function chooseDmoCommentaryVoice(voices = []) {
  const candidates = rankDmoBrowserVoices(voices);
  return candidates[0] ?? null;
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
  const players = [spokenName(names[0]), spokenName(names[1])];
  if (!players[0] || !players[1]) return '';
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
  const players = [spokenName(names[0]), spokenName(names[1])];
  if (!players[0] || !players[1]) return '';
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

export function withDmoCommentaryHistory(point, history = []) {
  let winningStreak = 1;
  let expected = point.number - 1;
  for (const previous of history.filter((item) => item.number < point.number)
    .slice().sort((a, b) => b.number - a.number)) {
    if (previous.number !== expected || previous.inferred || previous.winner !== point.winner) break;
    winningStreak += 1;
    expected -= 1;
  }
  return { ...point, winningStreak };
}

function tacticalDetail(point, winnerName) {
  // These are measured bounce positions, not the animation's inferred
  // forehand/backhand, slice, volley or spin cues. TE4 units are centimetres.
  const shots = Array.isArray(point.shots) ? point.shots : [];
  const landed = shots.filter((shot) => shot.p === point.winner && shot.k === 'r'
    && Number.isFinite(shot.bx) && Number.isFinite(shot.by)
    && Math.abs(shot.bx) <= 1189 && Math.abs(shot.by) <= 411.5
    && (point.shotEndTime == null || (Number.isFinite(shot.bt) && shot.bt <= point.shotEndTime)));
  const wide = landed.filter((shot) => Math.abs(shot.by) >= 275);
  if (wide.some((shot) => shot.by > 0) && wide.some((shot) => shot.by < 0)) {
    return `${winnerName} found wide targets on both sides in that exchange. Making use of the whole court.`;
  }
  const deep = landed.filter((shot) => Math.abs(shot.bx) >= 900);
  if (deep.length >= 3) {
    return `${winnerName} landed ${deep.length} balls in the last three metres of the court. That depth is worth watching.`;
  }
  if (wide.length >= 3) {
    return `${winnerName} kept finding the outer third of the court. A narrow target, and it paid off in this rally.`;
  }
  return '';
}

export function buildDmoPointCommentary(point, names = []) {
  const winner = point?.winner === 1 || point?.winner === 2 ? point.winner : null;
  if (!winner || point?.inferred === true) return '';
  const winnerName = spokenName(names[winner - 1]);
  if (!winnerName) return '';
  const server = point?.server === 1 || point?.server === 2 ? point.server : null;
  const serverName = server ? spokenName(names[server - 1]) : '';
  const rallyHits = Number.isInteger(point?.rallyHits) && point.rallyHits >= 0
    ? point.rallyHits
    : null;
  const reasons = clean(point?.highlightReasons);
  const rallyShotCount = Number.isInteger(point?.rallyShotCount)
    ? point.rallyShotCount
    : rallyHits;
  const coveredMeters = Number(reasons.match(/(\d+)\s*m covered/i)?.[1]) || null;
  const measuredServeSpeed = Number.isFinite(point.serveSpeedKmh)
    && point.serveSpeedKmh >= 50 && point.serveSpeedKmh <= 300
    ? Math.round(point.serveSpeedKmh) : null;
  const serveSpeed = measuredServeSpeed
    ?? (Number(reasons.match(/ace\/unreturned\s+(\d+)\s*km\/h/i)?.[1]) || null);
  const rallyFromHighlight = Number(reasons.match(/(\d+)-shot rally/i)?.[1]) || null;
  const matchSwing = Number(reasons.match(/swing\s+(\d+)% match chance/i)?.[1]) || null;
  const tiebreak = Boolean(point?.isTiebreak || /(?:^|;\s*)tiebreak(?:;|$)/i.test(reasons));
  const points = tiebreak ? null : pointsAtStart(point?.scoreBeforeLabel);
  const detail = tacticalDetail(point, winnerName);

  if (server !== null && points && isBreakPoint(points, server)) {
    if (point?.faults >= 2 && winner !== server) {
      return `A double fault at the worst moment — ${winnerName} takes the break.`;
    }
    const lines = winner === server
      ? [
        `${serverName} holds firm — break point saved.`,
        `Big response from ${serverName}. Break point gone.`,
        `The pressure stays on, but ${serverName} saves the break point.`,
        `${serverName} stands up to the pressure and saves it.`,
        `Break point defended — ${serverName} keeps the game alive.`,
      ]
      : [
        `And that's the break for ${winnerName}!`,
        `Break point converted — ${winnerName} takes the service game.`,
        `The opening was there, and ${winnerName} takes the break.`,
        `${winnerName} makes the return count and takes the break.`,
        `The service game changes hands — ${winnerName} breaks through.`,
      ];
    const call = lines[(Number.isInteger(point.number) ? point.number : rallyHits ?? 0) % lines.length];
    // React to the score consequence first; don't append a tactical paragraph
    // to a pressure-point call that needs to fit between points.
    return call;
  }

  if (server !== null && winner === server && points && isGamePoint(points, server)) {
    const lines = [
      `Game point converted — ${winnerName} closes it out.`,
      `That's the hold for ${winnerName}!`,
      `The game is sealed. ${winnerName} holds.`,
      `A strong finish from ${winnerName} — that's the game.`,
      `${winnerName} gets over the line and takes the game.`,
      `No way through on that point; ${winnerName} closes the game.`,
    ];
    return lines[(Number.isInteger(point.number) ? point.number : rallyHits ?? 0) % lines.length];
  }

  if (point?.faults >= 2 && server !== null && winner !== server) {
    return `A double fault gives ${winnerName} the point.`;
  }

  if (serveSpeed && winner === server && serverName && rallyShotCount === 0) {
    return `That serve never comes back — ${serverName} sends it down at ${serveSpeed} kilometres an hour.`;
  }

  const featuredRally = rallyFromHighlight ?? rallyShotCount;
  if (detail && featuredRally >= 8) return detail;

  if (point.winningStreak >= 4 && point.winningStreak % 4 === 0) {
    return `${point.winningStreak} points in a row for ${winnerName}. The pressure is building on the other side.`;
  }

  if (point.faults === 1 && winner !== server && featuredRally >= 8) {
    return `${winnerName} takes the second-serve point after ${featuredRally} rally shots. A chance on the return, and a lengthy battle to take it.`;
  }
  if (coveredMeters && featuredRally && featuredRally >= 8) {
    return `They cover ${coveredMeters} metres in a ${featuredRally}-shot rally — ${winnerName} comes through at the end.`;
  }

  if (matchSwing && matchSwing >= 10) {
    return `That is a major point. The match-win model swings ${matchSwing} percentage points toward ${winnerName}.`;
  }

  if (tiebreak && featuredRally && featuredRally >= 8) {
    return `Tie-break pressure, a ${featuredRally}-shot exchange — ${winnerName} takes it.`;
  }

  if (rallyHits >= 8) {
    const lines = [
      `What a battle! ${winnerName} wins the exchange.`,
      `Shot after shot, and ${winnerName} comes through.`,
      `A real test of legs and nerve — ${winnerName} takes it.`,
      `The rally keeps building, and ${winnerName} answers last.`,
      `A terrific exchange, and ${winnerName} gets the point.`,
    ];
    return lines[(Number.isInteger(point.number) ? point.number : rallyHits) % lines.length];
  }

  if (rallyHits === null) return '';
  const lines = winner === server
    ? [
      `A useful point on serve for ${winnerName}.`,
      `The server gets it done — ${winnerName}.`,
      `Steady work from ${winnerName} behind the serve.`,
      `A solid response from ${winnerName}.`,
      `${winnerName} takes the point and keeps the scoreboard moving.`,
      `Good composure from ${winnerName} in that exchange.`,
    ]
    : [
      `Good work on the return from ${winnerName}.`,
      `The returner makes it count — ${winnerName}.`,
      `A sharp response from ${winnerName}.`,
      `A useful return point for ${winnerName}.`,
      `No easy point there — ${winnerName} comes through.`,
      `The point swings ${winnerName}'s way.`,
    ];
  return lines[(Number.isInteger(point.number) ? point.number : rallyHits) % lines.length];
}

export function buildDmoRallyCommentary({
  names = [],
  rallyShotCount = 0,
  pointNumber = 0,
} = {}) {
  const firstName = spokenName(names[0]);
  const secondName = spokenName(names[1]);
  if (!firstName || !secondName || !Number.isInteger(rallyShotCount) || rallyShotCount < 8) {
    return '';
  }
  const lines = [
    `A long exchange now — ${firstName} and ${secondName} are trading shots.`,
    `${rallyShotCount} shots in, and ${firstName} and ${secondName} are keeping the point alive.`,
    `Neither ${firstName} nor ${secondName} has found the finish yet; the rally continues.`,
    `A testing rally between ${firstName} and ${secondName}; both are keeping it going.`,
    `Still no winner: ${firstName} and ${secondName} have traded ${rallyShotCount} rally shots.`,
    `Both ${firstName} and ${secondName} keep sending it back; this point is still developing.`,
  ];
  const variation = (Math.floor(rallyShotCount / 4)
    + (Number.isInteger(pointNumber) ? pointNumber : 0)) % lines.length;
  return lines[variation];
}

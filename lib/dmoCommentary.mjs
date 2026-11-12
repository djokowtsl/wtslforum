import { normalizeDmoTournamentName } from './dmoTournamentName.mjs';

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const spokenName = (value) => clean(value)
  .replace(/_+/g, ' ')
  .replace(/([a-z])([A-Z])/g, '$1 $2')
  .replace(/\s+/g, ' ')
  .trim();

const formattedElo = (value) => Math.round(value).toLocaleString('en-GB');

function selectFreshLine(lines, seed = 0, recentLines = []) {
  if (!lines.length) return '';
  const start = Math.abs(Number.isInteger(seed) ? seed : 0) % lines.length;
  for (let offset = 0; offset < lines.length; offset += 1) {
    const line = lines[(start + offset) % lines.length];
    if (!recentLines.includes(line)) return line;
  }
  return '';
}

function browserVoiceScore(voice) {
  const lang = clean(voice?.lang).toLowerCase();
  const name = clean(voice?.name).toLowerCase();
  let score = lang === 'en-us' ? 65
    : lang === 'en-gb' ? 55
      : lang === 'en-au' ? 50
        : lang === 'en-ie' ? 45
          : lang.startsWith('en-') ? 35
            : lang === 'en' ? 25 : 0;

  // Prefer modern-sounding voices, with US English as the default accent.
  // Browser labels are hints; they do not report the voice's age or gender.
  if (/neural|natural|enhanced|premium|online/i.test(name)) score += 200;
  else if (/google/i.test(name)) score += 100;
  if (voice?.localService === false) score += 5;
  return score;
}

function voiceGenderHint(voice) {
  const name = clean(voice?.name);
  if (/\b(female|woman|aria|jenny|samantha|zira|karen|susan|moira|tessa|victoria|ava|emma|olivia|sarah|allison|salli|joanna|kendra|linda|michelle)\b/i.test(name)) {
    return 'female';
  }
  if (/\b(male|man|david|guy|alex|daniel|james|matthew|liam|ryan|derek|mark|john|michael|thomas|tom|fred|george|aaron|barry|evan|jacob|bruce|brian|lee|oliver|henry|patrick|chris)\b/i.test(name)) {
    return 'male';
  }
  return null;
}

export function chooseDmoCommentaryVoice(voices = []) {
  const candidates = rankDmoBrowserVoices(voices);
  return candidates[0] ?? null;
}

export function chooseDmoCommentaryVoices(voices = []) {
  const ranked = rankDmoBrowserVoices(voices);
  if (!ranked.length) return { female: null, male: null, distinct: false };
  const american = ranked.filter((voice) => /^en-us$/i.test(clean(voice?.lang)));
  const candidates = american.length >= 2 ? american : ranked;
  const femaleHint = candidates.find((voice) => voiceGenderHint(voice) === 'female');
  const maleHint = candidates.find((voice) => voiceGenderHint(voice) === 'male');
  let female = femaleHint ?? candidates[0];
  let male = maleHint && maleHint.voiceURI !== female.voiceURI
    ? maleHint
    : candidates.find((voice) => voice.voiceURI !== female.voiceURI) ?? female;

  // When labels do not expose gender, use two distinct voices when possible.
  if (femaleHint && !maleHint) {
    male = candidates.find((voice) => voice.voiceURI !== female.voiceURI) ?? female;
  } else if (maleHint && !femaleHint) {
    female = candidates.find((voice) => voice.voiceURI !== male.voiceURI) ?? male;
  }
  return {
    female,
    male,
    distinct: female.voiceURI !== male.voiceURI,
  };
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
  const venue = normalizeDmoTournamentName(tournament) ?? '';
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

/** Describe only clear match patterns; avoid noisy tactical calls on tiny samples. */
export function buildDmoMatchCommentary({ names = [], stats = [] } = {}) {
  const players = names.slice(0, 2).map(spokenName);
  if (!players[0] || !players[1] || !Array.isArray(stats) || stats.length !== 2) return '';
  const [first, second] = stats;
  if (![first, second].every((row) =>
    Number.isFinite(row?.pointsWon) && row.pointsWon >= 0
    && Number.isFinite(row?.servicePoints) && row.servicePoints >= 0
    && Number.isFinite(row?.servicePointsWon) && row.servicePointsWon >= 0)) return '';
  const totalPoints = first.pointsWon + second.pointsWon;
  if (totalPoints < 24) return '';
  const firstShare = first.pointsWon / totalPoints;
  if (Math.abs(firstShare - 0.5) >= 0.08) {
    const leader = firstShare > 0.5 ? 0 : 1;
    const share = Math.round((leader === 0 ? firstShare : 1 - firstShare) * 100);
    return `${players[leader]} is winning ${share}% of the points so far. ${players[1 - leader]} needs to change the rhythm.`;
  }
  if (first.servicePoints >= 8 && second.servicePoints >= 8) {
    const firstServeShare = first.servicePointsWon / first.servicePoints;
    const secondServeShare = second.servicePointsWon / second.servicePoints;
    if (Math.abs(firstServeShare - secondServeShare) >= 0.18) {
      return `The serve is the difference: ${players[0]} is winning ${Math.round(firstServeShare * 100)}% of their service points, ${players[1]} ${Math.round(secondServeShare * 100)}%. The return needs to bite.`;
    }
  }
  return '';
}

export function buildDmoCommentaryOpeningReply({
  names = [],
  pointNumber = 0,
  recentLines = [],
} = {}) {
  const players = [spokenName(names[0]), spokenName(names[1])];
  if (!players[0] || !players[1]) return '';
  return selectFreshLine([
    `Absolutely. Let's see who settles into the match first.`,
    `A fresh start for both of them. Who takes the initiative?`,
    `Plenty to play for. The opening games should give us a feel for it.`,
    `And we're underway. Let's see how they handle the first few points.`,
    `It could be a good contest. The first signs will come quickly.`,
    `Right. Let's watch how both players approach the start.`,
    `A new match, and a clean slate. Here we go.`,
    `Good to be here. Let's see who finds their rhythm first.`,
  ], pointNumber, recentLines);
}

export function buildDmoCommentaryResponse({
  names = [],
  winner,
  pointNumber = 0,
  recentLines = [],
} = {}) {
  const winnerName = spokenName(names[winner - 1]);
  const opponentName = spokenName(names[winner === 1 ? 1 : 0]);
  if (!winnerName || !opponentName || (winner !== 1 && winner !== 2)) return '';
  return selectFreshLine([
    `And that's the point for ${winnerName}. How does ${opponentName} respond?`,
    `${winnerName} takes this one. ${opponentName} can reset and go again.`,
    `Yes, a point for ${winnerName}. Let's see what ${opponentName} does next.`,
    `That goes to ${winnerName}; ${opponentName} will regroup before the next serve.`,
    `A point for ${winnerName}. The next one is a fresh start for ${opponentName}.`,
    `Well, ${winnerName} gets it. What can ${opponentName} do in reply?`,
    `${winnerName} comes away with the point. ${opponentName} has a chance to reset.`,
    `There it is for ${winnerName}. Let's see how ${opponentName} answers.`,
    `The score moves ${winnerName}'s way. ${opponentName} can turn attention to the next point.`,
    `${winnerName} takes the point, and ${opponentName} will be ready for another go.`,
    `Good for ${winnerName}. ${opponentName} has the next chance to respond.`,
    `That belongs to ${winnerName}. The next point gives ${opponentName} a clean slate.`,
  ], pointNumber, recentLines);
}

/**
 * Give the second booth voice a specific reaction to the first voice's call.
 * Occasional disagreement is limited to long, recorded rallies so it never
 * contradicts the score or invents a shot outcome.
 */
export function buildDmoCommentaryFollowUp({
  names = [],
  point = null,
  leadLine = '',
  recentLines = [],
} = {}) {
  const players = [spokenName(names[0]), spokenName(names[1])];
  if (!players[0] || !players[1] || !leadLine || !point
    || (point.winner !== 1 && point.winner !== 2)) return '';
  const winner = players[point.winner - 1];
  const opponent = players[point.winner === 1 ? 1 : 0];
  const server = point.server === 1 || point.server === 2 ? players[point.server - 1] : '';
  const rally = point.rallyShotCount ?? point.rallyHits ?? 0;
  const pointNumber = Number.isInteger(point.number) ? point.number : 0;
  let replies;

  if (point.faults >= 2) {
    replies = [
      `Exactly—the double fault gives ${winner} the point. That one will sting.`,
      `No disagreement there: a double fault, and ${winner} takes the point.`,
      `Right. ${winner} gets it after the double fault; the server will want that back.`,
    ];
  } else if (rally >= 8 && pointNumber > 0 && pointNumber % 4 === 0) {
    replies = [
      `Hang on, I'd share the credit: ${opponent} kept that ${rally}-shot rally alive before ${winner} finished it.`,
      `I see it a little differently—${opponent} made ${winner} work through all ${rally} shots.`,
      `Fair, but don't forget ${opponent}: they kept that ${rally}-shot rally going before ${winner} closed it.`,
    ];
  } else if (rally >= 8) {
    replies = [
      `Absolutely. ${winner} had to earn it through ${rally} shots; both players kept that rally going.`,
      `That's right—and ${winner} had to stay with it for ${rally} shots to win that one.`,
      `It really was. ${opponent} kept coming back, but ${winner} had the last word after ${rally} shots.`,
    ];
  } else if (point.faults === 1 && point.winner !== point.server) {
    replies = [
      `Right—the first-serve fault gave ${winner} a look at the second serve, and they took it.`,
      `Exactly. ${winner} made the return count after the server missed their first delivery.`,
      `Yes, that second-serve chance mattered. ${winner} took it.`,
    ];
  } else if (server && point.winner === point.server && rally === 0) {
    replies = [
      `Exactly. ${server} served and made sure there was no rally at all.`,
      `Yes, the serve did the damage there. ${server} never had to play the next shot.`,
      `That's the value of a clean delivery—${server} wins it without a rally.`,
    ];
  } else {
    replies = [
      `Yes—and ${opponent} will be looking for an answer on the next point.`,
      `That's right. Now let's see how ${opponent} adjusts.`,
      `I agree. The next return will tell us whether ${opponent} has a response.`,
      `Absolutely. ${winner} gets this one; ${opponent} has the next chance to change the rhythm.`,
    ];
  }
  return selectFreshLine(replies, pointNumber, recentLines);
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
  const recordTour = tour === 'WTA' ? 'WTSL WTA' : 'WTSL';
  if (
    Number.isInteger(record?.matches)
    && record.matches > 0
    && Number.isInteger(record?.firstWins)
    && Number.isInteger(record?.secondWins)
    && record.firstWins + record.secondWins === record.matches
  ) {
    if (record.firstWins === record.secondWins) {
      lines.push(`There's nothing between them in ${recordTour} play: ${record.firstWins} ${record.firstWins === 1 ? 'win' : 'wins'} apiece.`);
    } else {
      const leader = record.firstWins > record.secondWins ? players[0] : players[1];
      const leaderWins = Math.max(record.firstWins, record.secondWins);
      const otherWins = Math.min(record.firstWins, record.secondWins);
      lines.push(`There's a little history here: ${leader} leads their ${recordTour} head-to-head, ${leaderWins} to ${otherWins}.`);
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

function gamesAtStart(scoreLabel) {
  // Accept only the viewer's explicit games(points) form, with tennis-valid
  // game counts. Never interpret a point score such as 15-30 as games.
  const match = clean(scoreLabel).match(/^\s*(\d+)\s*[-–]\s*(\d+)\s*\(([^()]*)\)\s*$/);
  if (!match) return null;
  if (!/^(?:0|15|30|40|AD|[0-9]+)\s*[-–]\s*(?:0|15|30|40|AD|[0-9]+)$/i.test(match[3].trim())) {
    return null;
  }
  const games = [Number(match[1]), Number(match[2])];
  return games.every((value) => Number.isInteger(value) && value >= 0 && value <= 7)
    ? games
    : null;
}

function tennisNumber(value) {
  return ['love', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][value]
    ?? String(value);
}

function gameScorePhrase(games) {
  return `${tennisNumber(games[0])} ${games[0] === 1 ? 'game' : 'games'} to ${tennisNumber(games[1])}`;
}

function pointWonSet(point, before) {
  const winnerIndex = point.winner - 1;
  const opponentIndex = 1 - winnerIndex;
  if (
    !Number.isInteger(point.setBefore)
    || !Number.isInteger(point.setAfter)
    || point.setAfter !== point.setBefore + 1
  ) return false;
  if (point.isTiebreak) return before[0] === 6 && before[1] === 6;
  const winnerGames = before[winnerIndex];
  const opponentGames = before[opponentIndex];
  return (winnerGames === 5 && opponentGames <= 4)
    || (winnerGames === 6 && opponentGames === 5);
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
    return `What a point! ${winnerName} dragged the other player from side to side and found the open court.`;
  }
  const deep = landed.filter((shot) => Math.abs(shot.bx) >= 900);
  if (deep.length >= 3) {
    return `Brilliant pressure from ${winnerName}: three deep balls in that exchange. The baseline is shrinking.`;
  }
  if (wide.length >= 3) {
    return `That is smart court craft. ${winnerName} kept finding the outside and made the court feel small.`;
  }
  return '';
}

function recordedShotReaction(point, winnerName, opponentName) {
  const shots = Array.isArray(point.shots) ? point.shots : [];
  const eligible = shots.filter((shot) => shot.k === 'r'
    && Number.isFinite(shot.bt)
    && (point.shotEndTime == null || shot.bt <= point.shotEndTime)
    && Number.isFinite(shot.bx) && Number.isFinite(shot.by))
    .sort((a, b) => a.bt - b.bt);
  const lastShot = eligible.at(-1);
  if (!lastShot) return '';
  const long = Math.abs(lastShot.bx) > 1189;
  const wide = Math.abs(lastShot.by) > 411.5;
  if (lastShot.p !== point.winner && (long || wide)) {
    const miss = long && wide ? 'wide and long' : long ? 'long' : 'wide';
    return `Oh, that's ${miss}! ${opponentName} misses, and ${winnerName} takes the point.`;
  }
  if (lastShot.p === point.winner
    && Math.abs(lastShot.bx) <= 1189 && Math.abs(lastShot.by) <= 411.5) {
    const nearLine = Math.abs(lastShot.bx) >= 1150 || Math.abs(lastShot.by) >= 382;
    if (nearLine) return `What a shot from ${winnerName}! Right by the line.`;
  }
  return '';
}

export function buildDmoPointCommentary(point, names = [], recentLines = []) {
  const winner = point?.winner === 1 || point?.winner === 2 ? point.winner : null;
  if (!winner || point?.inferred === true) return '';
  const winnerName = spokenName(names[winner - 1]);
  if (!winnerName) return '';
  const opponentName = spokenName(names[winner === 1 ? 1 : 0]);
  if (!opponentName) return '';
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
  const gamesBefore = gamesAtStart(point?.scoreBeforeLabel);
  const gamesAfter = gamesAtStart(point?.scoreAfterLabel);
  // A supplied but unusable score transition is not evidence for a score call.
  if (point?.scoreAfterLabel && (!gamesBefore || !gamesAfter)) return '';
  const setChanged = Number.isInteger(point?.setBefore)
    && Number.isInteger(point?.setAfter)
    && point.setAfter === point.setBefore + 1;
  const setReset = setChanged && gamesAfter?.[0] === 0 && gamesAfter?.[1] === 0;
  const winnerIndex = winner - 1;
  const gameChanged = gamesBefore && gamesAfter
    && (setReset || (
      gamesAfter[winnerIndex] === gamesBefore[winnerIndex] + 1
      && gamesAfter[1 - winnerIndex] === gamesBefore[1 - winnerIndex]
    ));
  const observation = tacticalDetail(point, winnerName);
  const detail = recentLines.includes(observation) ? '' : observation;

  if (gameChanged) {
    if (setChanged && pointWonSet(point, gamesBefore)) {
      const finalGames = [...gamesBefore];
      finalGames[winnerIndex] += 1;
      const setScore = `${tennisNumber(finalGames[winnerIndex])}-${tennisNumber(finalGames[1 - winnerIndex])}`;
      return selectFreshLine([
        `Oh, that's the set for ${winnerName}!`,
        `A huge finish—${winnerName} takes the set, ${setScore}.`,
        `${winnerName} gets it! That set is theirs, ${setScore}.`,
      ], point.number, recentLines);
    }
    if (setChanged) return '';
    // Routine holds and breaks are shown on the board, not repeated as a
    // formula after every game. Verified break/set pressure is handled below.
  }

  if (server !== null && points && isBreakPoint(points, server)) {
    if (point?.faults >= 2 && winner !== server) {
      return selectFreshLine([
        `A double fault at the worst moment — ${winnerName} takes the break.`,
        `The double fault hands the break to ${winnerName}.`,
        `${winnerName} gets the break after the double fault.`,
      ], point.number, recentLines);
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
    const call = selectFreshLine(
      lines,
      Number.isInteger(point.number) ? point.number : rallyHits ?? 0,
      recentLines,
    );
    // React to the score consequence first; don't append a tactical paragraph
    // to a pressure-point call that needs to fit between points.
    return call;
  }

  if (!gameChanged && server !== null && winner === server && points && isGamePoint(points, server)) {
    const lines = [
      `Big point! ${winnerName} takes the game.`,
      `Oh, that's well played—${winnerName} closes out the game.`,
      `Game to ${winnerName}!`,
    ];
    return selectFreshLine(
      lines,
      Number.isInteger(point.number) ? point.number : rallyHits ?? 0,
      recentLines,
    );
  }

  if (point?.faults >= 2 && server !== null && winner !== server) {
    return selectFreshLine([
      `Oh, the double fault! ${winnerName} takes the gift.`,
      `Double fault. ${serverName} will want that one back.`,
      `A costly double fault—${winnerName} says thank you.`,
    ], point.number, recentLines);
  }

  if (serveSpeed && winner === server && serverName && rallyShotCount === 0) {
    return selectFreshLine([
      `What a serve from ${serverName}!`,
      `${serverName} catches the line with that serve!`,
      point.number % 5 === 0
        ? `A huge serve from ${serverName} at ${serveSpeed} kilometres an hour. No way through that.`
        : `What a delivery from ${serverName}!`,
    ], point.number, recentLines);
  }

  const featuredRally = rallyFromHighlight ?? rallyShotCount;
  const allowRallyCommentary = point?.suppressRallyCommentary !== true;
  if (allowRallyCommentary && featuredRally >= 10) {
    const shotReaction = recordedShotReaction(point, winnerName, opponentName);
    if (shotReaction && !recentLines.includes(shotReaction)) return shotReaction;
    if (detail && !recentLines.includes(detail)
      && (!Number.isInteger(point.number) || point.number % 6 === 0)) return detail;
    if (rallyHits >= 18 && coveredMeters >= 40 && point.number % 11 === 0) {
      return `Somebody owes the ball crew overtime after that one. ${winnerName} wins a ${coveredMeters}-metre battle.`;
    }
    return selectFreshLine([
      `What a point! ${winnerName} gets it.`,
      `Magnificent rally! ${winnerName} hangs on.`,
      `They keep coming—and ${winnerName} has the last word!`,
      `What an exchange! ${winnerName} takes the point.`,
      `${winnerName} won't give that one up. What a point!`,
      `That rally just wouldn't quit. ${winnerName} wins it.`,
      `Brilliant stuff! ${winnerName} gets the point.`,
      `Both players digging in—and ${winnerName} comes through.`,
    ], point.number, recentLines);
  }

  if (point.winningStreak >= 4 && point.winningStreak % 4 === 0) {
    return selectFreshLine([
      `${point.winningStreak} straight! ${winnerName} is rolling.`,
      `The tide is turning. ${winnerName} has the last ${point.winningStreak}.`,
      `${winnerName} is making the other player work for every point.`,
    ], point.number, recentLines);
  }

  if (matchSwing && matchSwing >= 10) {
    return selectFreshLine([
      `That's a big one for ${winnerName}! The match-win model swings ${matchSwing} points their way.`,
      `Momentum may be shifting—${winnerName} makes a ${matchSwing}-point move in the model.`,
    ], point.number, recentLines);
  }

  if (allowRallyCommentary && tiebreak && featuredRally && featuredRally >= 10) {
    return selectFreshLine([
      `Tie-break pressure, a ${featuredRally}-shot exchange — ${winnerName} takes it.`,
      `${winnerName} wins the ${featuredRally}-shot rally in the tie-break.`,
      `A long tie-break point of ${featuredRally} shots goes to ${winnerName}.`,
    ], point.number, recentLines);
  }

  if (allowRallyCommentary && rallyHits >= 10) {
    const lines = [
      `What a battle! ${winnerName} takes it.`,
      `${winnerName}, at last!`,
      `A marathon point for ${winnerName}.`,
      `Finally, ${winnerName}!`,
      `What an exchange. ${winnerName}'s point.`,
      `${winnerName} comes through that one.`,
      `That took some winning. ${winnerName}!`,
      `A long one goes to ${winnerName}.`,
      `${winnerName} gets the last word.`,
      `Both kept it going. ${winnerName} takes it.`,
      `All that work, and it's ${winnerName}'s point.`,
      `That rally ends with ${winnerName} on top.`,
    ];
    return selectFreshLine(
      lines,
      Number.isInteger(point.number) ? point.number : rallyHits,
      recentLines,
    );
  }

  return '';
}

export function buildDmoRallyCommentary({
  names = [],
  rallyShotCount = 0,
  pointNumber = 0,
  recentLines = [],
} = {}) {
  const firstName = spokenName(names[0]);
  const secondName = spokenName(names[1]);
  if (!firstName || !secondName || !Number.isInteger(rallyShotCount) || rallyShotCount < 10) {
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
  const variation = Math.floor(rallyShotCount / 4)
    + (Number.isInteger(pointNumber) ? pointNumber : 0);
  return selectFreshLine(lines, variation, recentLines);
}

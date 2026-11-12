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

export function buildDmoPointCommentary(point, names = [], recentLines = []) {
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
        `That wins the set for ${winnerName}.`,
        `${winnerName} takes the ${['', 'first', 'second', 'third', 'fourth', 'fifth'][point.setBefore] || 'next'} set, ${setScore}.`,
        `${setScore} to ${winnerName}. A set on the board.`,
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
      `Game point converted — ${winnerName} closes it out.`,
      `That's the hold for ${winnerName}!`,
      `The game is sealed. ${winnerName} holds.`,
      `A strong finish from ${winnerName} — that's the game.`,
      `${winnerName} gets over the line and takes the game.`,
      `No way through on that point; ${winnerName} closes the game.`,
    ];
    return selectFreshLine(
      lines,
      Number.isInteger(point.number) ? point.number : rallyHits ?? 0,
      recentLines,
    );
  }

  if (point?.faults >= 2 && server !== null && winner !== server) {
    return selectFreshLine([
      `A double fault gives ${winnerName} the point.`,
      `${winnerName} takes the point after the double fault.`,
      `That fault costs the point; ${winnerName} gets it.`,
    ], point.number, recentLines);
  }

  if (serveSpeed && winner === server && serverName && rallyShotCount === 0) {
    return selectFreshLine([
      `That serve never comes back — ${serverName} sends it down at ${serveSpeed} kilometres an hour.`,
      `${serverName} finishes the point with a ${serveSpeed}-kilometre-an-hour serve.`,
      `A ${serveSpeed}-kilometre-an-hour serve from ${serverName}, and no return.`,
      `${serverName} gets the serve through at ${serveSpeed} kilometres an hour.`,
    ], point.number, recentLines);
  }

  const featuredRally = rallyFromHighlight ?? rallyShotCount;
  const allowRallyCommentary = point?.suppressRallyCommentary !== true;
  if (allowRallyCommentary && detail && featuredRally >= 12 && !recentLines.includes(detail)) return detail;

  if (point.winningStreak >= 4 && point.winningStreak % 4 === 0) {
    return selectFreshLine([
      `${point.winningStreak} points in a row for ${winnerName}. The pressure is building on the other side.`,
      `${winnerName} has taken ${point.winningStreak} straight points, and momentum is shifting.`,
      `The last ${point.winningStreak} points have gone to ${winnerName}.`,
    ], point.number, recentLines);
  }

  if (allowRallyCommentary && point.faults === 1 && winner !== server && featuredRally >= 10) {
    return selectFreshLine([
      `${winnerName} takes the second-serve point after ${featuredRally} rally shots. A chance on the return, and a lengthy battle to take it.`,
      `${winnerName} wins the second-serve exchange after ${featuredRally} shots.`,
      `A long second-serve point, and ${winnerName} makes the return count.`,
    ], point.number, recentLines);
  }
  if (allowRallyCommentary && coveredMeters && featuredRally && featuredRally >= 10) {
    return selectFreshLine([
      `They cover ${coveredMeters} metres in a ${featuredRally}-shot rally — ${winnerName} comes through at the end.`,
      `${coveredMeters} metres covered across ${featuredRally} rally shots. ${winnerName} gets the point.`,
      `A ${featuredRally}-shot exchange covers ${coveredMeters} metres, and ${winnerName} finishes ahead.`,
    ], point.number, recentLines);
  }

  if (matchSwing && matchSwing >= 10) {
    return selectFreshLine([
      `That is a major point. The match-win model swings ${matchSwing} percentage points toward ${winnerName}.`,
      `The match-win estimate moves ${matchSwing} points toward ${winnerName} after that one.`,
      `${winnerName} takes a point that shifts the model by ${matchSwing} percentage points.`,
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

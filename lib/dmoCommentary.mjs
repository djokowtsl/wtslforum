import { normalizeDmoTournamentName } from './dmoTournamentName.mjs';

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const spokenName = (value) => clean(value)
  .replace(/_+/g, ' ')
  .replace(/([a-z])([A-Z])/g, '$1 $2')
  .replace(/\s+/g, ' ')
  .trim();

const formattedElo = (value) => Math.round(value).toLocaleString('en-GB');

/**
 * A stable offset per pairing, so different matches start from different
 * lines instead of every match opening with the same phrases.
 */
function matchSalt(names = []) {
  let hash = 0;
  for (const character of names.slice(0, 2).map(spokenName).join('|')) {
    hash = (Math.imul(hash, 31) + character.charCodeAt(0)) | 0;
  }
  return Math.abs(hash) % 9973;
}

function seedFor(names, number) {
  return matchSalt(names) + (Number.isInteger(number) ? Math.abs(number) : 0);
}

function selectFreshLine(lines, seed = 0, recentLines = []) {
  const options = lines.filter(Boolean);
  if (!options.length) return '';
  const start = Math.abs(Number.isInteger(seed) ? seed : 0) % options.length;
  let oldest = '';
  let oldestAge = -1;
  for (let offset = 0; offset < options.length; offset += 1) {
    const line = options[(start + offset) % options.length];
    const age = recentLines.indexOf(line);
    if (age === -1) return line;
    if (age > oldestAge) {
      oldest = line;
      oldestAge = age;
    }
  }
  return oldest;
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
  const seed = seedFor(players, 0);
  const pick = (options) => options[seed % options.length];
  const lines = [];
  if (venue) {
    lines.push(pick([
      `We're at ${venue}.`,
      `Welcome to ${venue}.`,
      `Hello and welcome to ${venue}.`,
      `Good to be with you at ${venue}.`,
    ]));
  }
  const pairing = pick([
    `${players[0]} against ${players[1]}${court}.`,
    `${players[0]} takes on ${players[1]}${court}.`,
    `It's ${players[0]} and ${players[1]}${court}.`,
    `${players[0]} faces ${players[1]}${court}.`,
  ]);
  if (stage && stage.toLowerCase() !== 'auto') {
    lines.push(pick([
      `${stage} action: ${players[0]} against ${players[1]}${court}.`,
      `${stage} time: ${players[0]} takes on ${players[1]}${court}.`,
      `This is the ${stage}: ${players[0]} against ${players[1]}${court}.`,
      `${stage}, and it's ${players[0]} against ${players[1]}${court}.`,
    ]));
  } else {
    lines.push(pairing);
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
    const options = [
      `${players[leader]} is winning ${share}% of the points so far. ${players[1 - leader]} needs to change the rhythm.`,
      `A look at the numbers: ${players[leader]} has won ${share}% of the points played. ${players[1 - leader]} has work to do.`,
      `${share}% of the points have gone to ${players[leader]} so far. That's a clear edge.`,
      `The points tell the story: ${share}% to ${players[leader]}. ${players[1 - leader]} needs a new plan.`,
    ];
    return options[seedFor(players, totalPoints) % options.length];
  }
  if (first.servicePoints >= 8 && second.servicePoints >= 8) {
    const firstServeShare = first.servicePointsWon / first.servicePoints;
    const secondServeShare = second.servicePointsWon / second.servicePoints;
    if (Math.abs(firstServeShare - secondServeShare) >= 0.18) {
      const firstPct = Math.round(firstServeShare * 100);
      const secondPct = Math.round(secondServeShare * 100);
      const options = [
        `The serve is the difference: ${players[0]} is winning ${firstPct}% of their service points, ${players[1]} ${secondPct}%. The return needs to bite.`,
        `On serve, ${players[0]} is winning ${firstPct}% of points and ${players[1]} ${secondPct}%. That gap matters.`,
        `Look at the service numbers: ${firstPct}% for ${players[0]}, ${secondPct}% for ${players[1]}.`,
      ];
      return options[seedFor(players, totalPoints) % options.length];
    }
  }
  return '';
}

const SET_ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth'];

/**
 * A viewer who turns commentary on part-way through a replay hears where the
 * match stands, instead of an opening that says play is just starting.
 * `setsWon` and `games` are the score at that moment.
 */
export function buildDmoJoinCommentary({
  names = [],
  tournament = '',
  setsWon = null,
  games = null,
  number = 0,
} = {}) {
  const players = [spokenName(names[0]), spokenName(names[1])];
  const valid = (pair, max) => Array.isArray(pair) && pair.length === 2
    && pair.every((value) => Number.isInteger(value) && value >= 0 && value <= max);
  if (!players[0] || !players[1] || !valid(setsWon, 3) || !valid(games, 30)) return '';
  const venue = normalizeDmoTournamentName(tournament) ?? '';
  const where = venue ? ` at ${venue}` : '';
  const seed = seedFor(players, number);
  const opener = [
    `We join ${players[0]} and ${players[1]}${where}.`,
    `Picking things up${where}: ${players[0]} against ${players[1]}.`,
    `Back with ${players[0]} and ${players[1]}${where}.`,
  ][seed % 3];

  const setName = SET_ORDINALS[setsWon[0] + setsWon[1]] ?? 'next';
  const setLeader = setsWon[0] === setsWon[1] ? -1 : setsWon[0] > setsWon[1] ? 0 : 1;
  const setsLead = setLeader === -1
    ? (setsWon[0] === 0 ? '' : `It's ${tennisNumber(setsWon[0])} ${setsWon[0] === 1 ? 'set' : 'sets'} all`)
    : (() => {
      const [ahead, behind] = [setsWon[setLeader], setsWon[1 - setLeader]];
      return ahead - behind === 1 && behind === 0
        ? `${players[setLeader]} leads by a set`
        : `${players[setLeader]} leads by ${tennisNumber(ahead)} sets to ${tennisNumber(behind)}`;
    })();
  let gamesState;
  if (games[0] === 0 && games[1] === 0) {
    gamesState = `the ${setName} set is about to begin`;
  } else if (games[0] === games[1]) {
    gamesState = games[0] === 6
      ? `it's six games all in the ${setName} set, so a tie-break will decide it`
      : `it's ${tennisNumber(games[0])} games all in the ${setName} set`;
  } else {
    const leader = games[0] > games[1] ? 0 : 1;
    const [ahead, behind] = [games[leader], games[1 - leader]];
    const count = `${tennisNumber(ahead)} ${ahead === 1 ? 'game' : 'games'} to ${tennisNumber(behind)} in the ${setName} set`;
    // Don't name the same player twice in one sentence.
    gamesState = leader === setLeader ? count : `${players[leader]} leads ${count}`;
  }
  // Player names keep their own spelling; only plain words are capitalised.
  const sentence = (text) => (/^(it's|the) /.test(text) ? capitalize(text) : text);
  const score = setsLead ? `${setsLead}, and ${gamesState}.` : `${sentence(gamesState)}.`;
  return `${opener} ${score}`;
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
    `Should be a good one. Early nerves will play a part.`,
    `Looking forward to this. Both of them will want a clean start.`,
    `Let's see who takes control in these first few games.`,
    `First serves and early returns — that's where I'll be looking.`,
    `Everything's level for now. Let's see who blinks first.`,
    `It's all about settling in at this stage.`,
    `A good start matters. Let's see who gets one.`,
    `Right then. Let's get going.`,
    `I'm intrigued by this one. Let's see how it unfolds.`,
    `Big match for both of them. Here we go.`,
  ], seedFor(names, pointNumber), recentLines);
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
  ], seedFor(names, pointNumber), recentLines);
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
      `You can't give points away like that. ${winner} won't complain.`,
      `Two misses on serve, and ${winner} didn't have to do a thing.`,
      `That's a free point for ${winner}. The server needs to reset.`,
      `Nothing ${winner} could do there but watch. A gift.`,
      `The second serve let them down. ${winner} gratefully accepts.`,
    ];
  } else if (rally >= 8 && pointNumber > 0 && pointNumber % 4 === 0) {
    replies = [
      `Hang on, I'd share the credit: ${opponent} kept that ${rally}-shot rally alive before ${winner} finished it.`,
      `I see it a little differently—${opponent} made ${winner} work through all ${rally} shots.`,
      `Fair, but don't forget ${opponent}: they kept that ${rally}-shot rally going before ${winner} closed it.`,
      `Hang on, give ${opponent} some credit — ${rally} shots is a lot of defending before ${winner} got there.`,
      `I see it a little differently: ${opponent} was in that ${rally}-shot point right to the end.`,
      `Don't forget ${opponent} in all that. ${rally} shots before ${winner} finally won it.`,
    ];
  } else if (rally >= 8) {
    replies = [
      `Absolutely. ${winner} had to earn it through ${rally} shots; both players kept that rally going.`,
      `That's right—and ${winner} had to stay with it for ${rally} shots to win that one.`,
      `It really was. ${opponent} kept coming back, but ${winner} had the last word after ${rally} shots.`,
      `Absolutely — ${rally} shots! Both will need a breather, but ${winner} won't mind.`,
      `Right, and you have to admire the patience: ${rally} shots, and ${winner} came out on top.`,
      `Exactly — that kind of point takes something out of the legs. ${rally} shots, and it goes to ${winner}.`,
      `That's right. Neither wanted to give an inch, and ${winner} finally won it after ${rally} shots.`,
      `Absolutely. Long, hard work from both — ${rally} shots — and ${winner} gets the reward.`,
    ];
  } else if (point.faults === 1 && point.winner !== point.server) {
    replies = [
      `Right—the first-serve fault gave ${winner} a look at the second serve, and they took it.`,
      `Exactly. ${winner} made the return count after the server missed their first delivery.`,
      `Yes, that second-serve chance mattered. ${winner} took it.`,
      `A look at a second serve, and ${winner} made it count.`,
      `That's what you want as a returner — the second serve, and ${winner} punished it.`,
      `Once the first serve missed, ${winner} was in business.`,
      `Second serves give you a chance, and ${winner} took this one.`,
    ];
  } else if (server && point.winner === point.server && rally === 0) {
    replies = [
      `Exactly. ${server} served and made sure there was no rally at all.`,
      `Yes, the serve did the damage there. ${server} never had to play the next shot.`,
      `That's the value of a clean delivery—${server} wins it without a rally.`,
      `Yes — ${server} didn't need a second shot there.`,
      `Exactly. Serve, point, move on for ${server}.`,
      `That's the easy way to win a point. ${server} made it look simple.`,
      `Yes, no return to speak of. ${server} takes the cheap one.`,
      `Exactly what ${server} wanted — straight in, straight through.`,
    ];
  } else {
    replies = [
      `Yes—and ${opponent} will be looking for an answer on the next point.`,
      `That's right. Now let's see how ${opponent} adjusts.`,
      `I agree. The next return will tell us whether ${opponent} has a response.`,
      `Absolutely. ${winner} gets this one; ${opponent} has the next chance to change the rhythm.`,
      `Yes, and ${opponent} needs a quick answer.`,
      `Right — one more for ${winner}. ${opponent} will want to respond.`,
      `Agreed — a good point for ${winner}.`,
      `True. ${opponent} has to stay with it.`,
      `Exactly. Small margins, and ${winner} is on the right side of that one.`,
      `Yes — ${winner} will happily take that.`,
      `Indeed. ${opponent} needs to find a way into these points.`,
      `That one goes ${winner}'s way. ${opponent} will reset.`,
    ];
  }
  return selectFreshLine(replies, seedFor(names, pointNumber), recentLines);
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

function validSetCount(value) {
  return Array.isArray(value) && value.length === 2
    && value.every((count) => Number.isInteger(count) && count >= 0)
    ? [value[0], value[1]]
    : null;
}

function validSetsToWin(value) {
  return Number.isInteger(value) && value >= 1 && value <= 3 ? value : null;
}

function setChangedByPoint(point) {
  return Number.isInteger(point?.setBefore)
    && Number.isInteger(point?.setAfter)
    && point.setAfter === point.setBefore + 1;
}

function setsWonAfterPoint(point) {
  const before = validSetCount(point?.setsWonBefore);
  if (!before || ![1, 2].includes(point?.winner)) return null;
  const after = [...before];
  if (point.matchOver === true || setChangedByPoint(point)) after[point.winner - 1] += 1;
  return after;
}

function tiebreakPoints(scoreLabel) {
  const match = clean(scoreLabel).match(/\((\d+)\s*[-–]\s*(\d+)\)\s*$/);
  if (!match) return null;
  const points = [Number(match[1]), Number(match[2])];
  return points.every((value) => Number.isInteger(value) && value >= 0 && value <= 40) ? points : null;
}

function gamePointsFor(points, player) {
  const own = points[player];
  const other = points[1 - player];
  if (own === 'AD' && other === '40') return 1;
  if (own === '40' && ['0', '15', '30'].includes(other)) return 3 - ['0', '15', '30'].indexOf(other);
  return 0;
}

/** Determine what the next point puts on the line using only recorded scores. */
export function dmoPressureAfterPoint(point) {
  if (!point || point.inferred === true || ![1, 2].includes(point.winner)) return null;
  if (point.matchOver === true || setChangedByPoint(point) || isDmoGameEnding(point)) return null;
  const games = gamesAtStart(point.scoreAfterLabel);
  const gamesBefore = gamesAtStart(point.scoreBeforeLabel);
  if (!games || (point.scoreBeforeLabel && !gamesBefore)) return null;
  if (gamesBefore && (gamesBefore[0] !== games[0] || gamesBefore[1] !== games[1])) return null;
  const sets = validSetCount(point.setsWonBefore);
  const setsToWin = validSetsToWin(point.setsToWin);
  const kindFor = (player, winsSet) => {
    if (!winsSet) return 'break';
    return sets && setsToWin && sets[player] + 1 === setsToWin ? 'match' : 'set';
  };

  if (point.isTiebreak) {
    if (games[0] !== 6 || games[1] !== 6) return null;
    const points = tiebreakPoints(point.scoreAfterLabel);
    if (!points) return null;
    for (const player of [0, 1]) {
      if (points[player] >= 6 && points[player] > points[1 - player]) {
        return { kind: kindFor(player, true), player, count: points[player] - points[1 - player] };
      }
    }
    return null;
  }

  if (point.server !== 1 && point.server !== 2) return null;
  const points = pointsAtStart(point.scoreAfterLabel);
  if (!points) return null;
  const server = point.server - 1;
  const receiver = 1 - server;
  const winsSet = (player) => {
    const won = games[player] + 1;
    return won >= 6 && won - games[1 - player] >= 2;
  };
  const receiverChances = gamePointsFor(points, receiver);
  if (receiverChances) {
    return { kind: kindFor(receiver, winsSet(receiver)), player: receiver, count: receiverChances };
  }
  const serverChances = gamePointsFor(points, server);
  if (serverChances && winsSet(server)) {
    return { kind: kindFor(server, true), player: server, count: serverChances };
  }
  return null;
}

function capitalize(text) {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

function pressurePhrase(pressure, names, seed = 0, recentLines = []) {
  const name = spokenName(names[pressure.player]);
  if (!name) return '';
  const label = `${pressure.kind} point`;
  const end = pressure.kind === 'match' ? '!' : '.';
  if (pressure.count >= 2) {
    const count = tennisNumber(pressure.count);
    return selectFreshLine([
      `${capitalize(count)} ${label}s for ${name}${end}`,
      `${name} has ${count} ${label}s${end}`,
      `That's ${count} ${label}s for ${name}${end}`,
      `${name} has ${count} ${label}s to work with${end}`,
    ], seed, recentLines);
  }
  const options = {
    break: [
      `Break point, ${name}.`,
      `${name} has a break point.`,
      `That brings up break point for ${name}.`,
      `A chance for ${name} — break point.`,
      `Break point. Can ${name} take it?`,
    ],
    set: [
      `Set point, ${name}.`,
      `${name} has set point.`,
      `That brings up set point for ${name}.`,
      `Set point. Can ${name} close it out?`,
    ],
    match: [
      `Match point, ${name}!`,
      `${name} has match point!`,
      `And that's match point for ${name}!`,
      `Match point! ${name} is one point away.`,
    ],
  }[pressure.kind];
  return selectFreshLine(options, seed, recentLines);
}

function finalScoreline(point) {
  if (!Array.isArray(point?.finalSets) || !point.finalSets.length) return '';
  const winner = point.winner - 1;
  const sets = point.finalSets
    .filter((set) => Array.isArray(set) && set.length === 2 && set.every((games) => Number.isInteger(games) && games >= 0 && games <= 30))
    .map((set) => (winner === 0 ? [set[0], set[1]] : [set[1], set[0]]));
  if (sets.length !== point.finalSets.length) return '';
  return sets.map(([own, other]) => `${tennisNumber(own)}-${tennisNumber(other)}`).join(', ');
}

/** Give the second commentator a verified set score or final match score. */
export function buildDmoCommentaryScoreReply({ names = [], point = null, recentLines = [] } = {}) {
  const players = [spokenName(names[0]), spokenName(names[1])];
  if (!players[0] || !players[1] || !point || point.inferred === true
    || ![1, 2].includes(point.winner)) return '';
  const winner = players[point.winner - 1];
  const opponent = players[point.winner === 1 ? 1 : 0];
  const number = Number.isInteger(point.number) ? point.number : 0;

  if (point.matchOver === true) {
    const scoreline = finalScoreline(point);
    if (!scoreline) return '';
    return selectFreshLine([
      `${winner} wins it ${scoreline}.`,
      `It finishes ${scoreline} to ${winner}. Hard luck, ${opponent}.`,
      `${scoreline}. A deserved win for ${winner}.`,
      `The final score: ${scoreline} to ${winner}.`,
      `${winner} wins ${scoreline}. ${opponent} gave it everything.`,
      `So ${winner} takes it, ${scoreline}. Well played, both.`,
    ], seedFor(names, number), recentLines);
  }

  if (!setChangedByPoint(point)) return '';
  const sets = setsWonAfterPoint(point);
  if (!sets) return '';
  if (sets[0] === sets[1]) {
    return selectFreshLine([
      `So it's ${tennisNumber(sets[0])} ${sets[0] === 1 ? 'set' : 'sets'} all.`,
      `Level at ${tennisNumber(sets[0])} ${sets[0] === 1 ? 'set' : 'sets'} all, and everything to play for.`,
        `All square — ${tennisNumber(sets[0])} ${sets[0] === 1 ? 'set' : 'sets'} each.`,
        `We're level, ${tennisNumber(sets[0])} ${sets[0] === 1 ? 'set' : 'sets'} apiece.`,
      ], seedFor(names, number), recentLines);
  }
  const leader = sets[0] > sets[1] ? 0 : 1;
  const lead = sets[leader];
  const trail = sets[1 - leader];
  const count = `${tennisNumber(lead)} ${lead === 1 ? 'set' : 'sets'} to ${tennisNumber(trail)}`;
  // "Ahead" only when the set winner is the one leading.
  const setWinnerLeads = leader === point.winner - 1;
  return selectFreshLine(setWinnerLeads
    ? [
      `${players[leader]} leads ${count}.`,
      `That puts ${players[leader]} ahead, ${count}.`,
      `${players[leader]} now leads ${count}.`,
      `So it's ${players[leader]}, ${count}.`,
    ]
    : [
      `${players[leader]} still leads, ${count}.`,
      `${players[leader]} is still in front, ${count}, but ${players[1 - leader]} is hitting back.`,
      `That narrows it: ${players[leader]} leads ${count}.`,
    ], seedFor(names, number), recentLines);
}

/** Point totals and serve points calculated only from the supplied history. */
export function summarizeDmoCommentaryStats(points = []) {
  const stats = [0, 1].map(() => ({ pointsWon: 0, servicePoints: 0, servicePointsWon: 0 }));
  for (const point of points) {
    if (point?.inferred === true || ![1, 2].includes(point?.winner) || ![1, 2].includes(point?.server)) continue;
    stats[point.winner - 1].pointsWon += 1;
    stats[point.server - 1].servicePoints += 1;
    stats[point.server - 1].servicePointsWon += Number(point.winner === point.server);
  }
  return stats;
}

export function withDmoCommentaryHistory(point, history = []) {
  const earlier = history.filter((item) => item.number < point.number)
    .slice().sort((a, b) => b.number - a.number);
  let winningStreak = 1;
  let expected = point.number - 1;
  for (const previous of earlier) {
    if (previous.number !== expected || previous.inferred || previous.winner !== point.winner) break;
    winningStreak += 1;
    expected -= 1;
  }

  const endsGame = isDmoGameEnding(point);
  let previousGame = null;
  let gameStreak = endsGame ? 1 : 0;
  let streakOpen = endsGame;
  let streakExact = false;
  expected = point.number - 1;
  for (const item of earlier) {
    if (item.number !== expected || item.inferred) break;
    expected -= 1;
    if (!isDmoGameEnding(item)) continue;
    previousGame ??= {
      winner: item.winner,
      server: item.server,
      broken: !item.isTiebreak && [1, 2].includes(item.server) && item.winner !== item.server,
    };
    if (streakOpen) {
      if (item.winner === point.winner) gameStreak += 1;
      else {
        streakOpen = false;
        streakExact = true;
      }
    }
    if (!streakOpen) break;
  }
  if (streakOpen && expected === 0) streakExact = true;
  return {
    ...point,
    winningStreak,
    previousGame,
    gameStreak: endsGame && streakExact ? gameStreak : null,
  };
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
    return [
      `What a point! ${winnerName} dragged the other player from side to side and found the open court.`,
      `${winnerName} worked both corners there and opened the court right up.`,
      `Side to side, side to side — ${winnerName} moved the other player all over the court.`,
    ][seedFor([winnerName], point.number) % 3];
  }
  const deep = landed.filter((shot) => Math.abs(shot.bx) >= 900);
  if (deep.length >= 3) {
    return [
      `Brilliant pressure from ${winnerName}: three deep balls in that exchange. The baseline is shrinking.`,
      `${winnerName} kept the ball deep, pinning the other player behind the baseline.`,
      `Length was the key there. ${winnerName} kept landing it near the baseline.`,
    ][seedFor([winnerName], point.number) % 3];
  }
  if (wide.length >= 3) {
    return [
      `That is smart court craft. ${winnerName} kept finding the outside and made the court feel small.`,
      `${winnerName} kept the ball out wide, stretching the other player again and again.`,
      `Lovely use of the angles from ${winnerName} in that one.`,
    ][seedFor([winnerName], point.number) % 3];
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
    return [
      `Oh, that's ${miss}! ${opponentName} misses, and ${winnerName} takes the point.`,
      `${capitalize(miss)}! After all that, ${opponentName} misses and ${winnerName} has it.`,
      `And it lands ${miss}. ${opponentName} won't want to see that again.`,
      `${opponentName} goes for it, but it's ${miss}. Point ${winnerName}.`,
    ][seedFor([winnerName, opponentName], point.number) % 4];
  }
  if (lastShot.p === point.winner
    && Math.abs(lastShot.bx) <= 1189 && Math.abs(lastShot.by) <= 411.5) {
    const nearLine = Math.abs(lastShot.bx) >= 1150 || Math.abs(lastShot.by) >= 382;
    if (nearLine) {
      return [
        `What a shot from ${winnerName}! Right by the line.`,
        `${winnerName} paints the line to finish it!`,
        `Right on the line from ${winnerName}. Superb.`,
        `${winnerName} finds the line — what a way to win it.`,
      ][seedFor([winnerName, opponentName], point.number) % 4];
    }
  }
  return '';
}

export function isDmoGameEnding(point) {
  if (point?.inferred || ![1, 2].includes(point?.winner)) return false;
  if (point.matchOver === true) return true;
  const before = gamesAtStart(point.scoreBeforeLabel);
  const after = gamesAtStart(point.scoreAfterLabel);
  if (!before || !after) return false;
  const winner = point.winner - 1;
  const setReset = Number.isInteger(point.setBefore)
    && point.setAfter === point.setBefore + 1
    && after[0] === 0 && after[1] === 0;
  return setReset || (after[winner] === before[winner] + 1
    && after[1 - winner] === before[1 - winner]);
}

function basePointCommentary(point, names = [], recentLines = []) {
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
  if (point?.matchOver === true) {
    return selectFreshLine([
      `Game, set and match, ${winnerName}!`,
      `And that's it! ${winnerName} wins the match!`,
      `${winnerName} closes it out. Game, set and match!`,
      `That's the match! ${winnerName} has done it.`,
      `Game, set and match to ${winnerName}!`,
      `${winnerName} finishes it off — the match is theirs!`,
      `It's over! ${winnerName} takes the match.`,
    ], seedFor(names, point.number), recentLines);
  }
  // A supplied but unusable score transition is not evidence for a score call.
  if (point?.scoreAfterLabel && (!gamesBefore || !gamesAfter)) return '';
  const setChanged = Number.isInteger(point?.setBefore)
    && Number.isInteger(point?.setAfter)
    && point.setAfter === point.setBefore + 1;
  const winnerIndex = winner - 1;
  const gameChanged = isDmoGameEnding(point);
  const gameFallback = `Game to ${winnerName}.`;
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
          `And the set goes to ${winnerName}, ${setScore}.`,
          `${winnerName} seals the set, ${setScore}!`,
          `That's it — set to ${winnerName}.`,
          `${winnerName} wraps up the set, ${setScore}.`,
          `Set, ${winnerName}! ${capitalize(setScore)}.`,
        ], seedFor(names, point.number), recentLines) || `That's the set for ${winnerName}.`;
    }
    if (setChanged) return gameFallback;
  }

  if (server !== null && points && isBreakPoint(points, server)) {
    if (point?.faults >= 2 && winner !== server) {
      return selectFreshLine([
        `A double fault at the worst moment — ${winnerName} takes the break.`,
        `The double fault hands the break to ${winnerName}.`,
        `${winnerName} gets the break after the double fault.`,
          `Oh no — a double fault on break point. ${winnerName} breaks.`,
          `That's a painful way to lose serve. A double fault, and ${winnerName} has the break.`,
          `${winnerName} breaks without having to hit a ball. Double fault.`,
        ], seedFor(names, point.number), recentLines) || (gameChanged ? gameFallback : '');
    }
    const previous = point.previousGame;
    if (gameChanged && winner !== server && previous?.broken
      && previous.winner !== winner && previous.winner === server) {
      return selectFreshLine([
        `And ${winnerName} breaks straight back!`,
        `Straight back on serve — ${winnerName} breaks back.`,
        `${winnerName} hits back immediately with the break.`,
          `The break didn't last! ${winnerName} breaks right back.`,
          `${winnerName} responds at once with the break — we're back on serve.`,
          `Back on serve! ${winnerName} breaks back straight away.`,
        ], seedFor(names, point.number), recentLines) || gameFallback;
    }
    const lines = winner === server
      ? [
        `${serverName} holds firm — break point saved.`,
        `Big response from ${serverName}. Break point gone.`,
        `The pressure stays on, but ${serverName} saves the break point.`,
        `${serverName} stands up to the pressure and saves it.`,
        `Break point defended — ${serverName} keeps the game alive.`,
        `${serverName} gets out of trouble. Break point saved.`,
        `Saved! ${serverName} wipes out the break point.`,
        `No break this time — ${serverName} comes up with the goods.`,
        `${serverName} digs in and saves the break point.`,
        `Under pressure, ${serverName} delivers. Break point gone.`,
      ]
      : gameChanged && Number.isInteger(point.gameStreak) && point.gameStreak >= 3
        ? [
          `${winnerName} breaks again — that's ${tennisNumber(point.gameStreak)} games in a row!`,
          `Another break, and ${tennisNumber(point.gameStreak)} straight games for ${winnerName}.`,
            `${winnerName} breaks once more. ${capitalize(tennisNumber(point.gameStreak))} games in a row now.`,
            `The run goes on — ${winnerName} breaks again for ${tennisNumber(point.gameStreak)} in a row.`,
        ]
        : [
        `And that's the break for ${winnerName}!`,
        `Break point converted — ${winnerName} takes the service game.`,
        `The opening was there, and ${winnerName} takes the break.`,
        `${winnerName} makes the return count and takes the break.`,
        `The service game changes hands — ${winnerName} breaks through.`,
        `${winnerName} breaks! The service game is theirs.`,
        `${winnerName} gets the break!`,
        `There's the break — ${winnerName} makes it count.`,
        `${winnerName} takes the chance and breaks serve.`,
        `A big moment: ${winnerName} breaks.`,
      ];
    const call = selectFreshLine(
      lines,
        seedFor(names, Number.isInteger(point.number) ? point.number : rallyHits ?? 0),
      recentLines,
    );
    // React to the score consequence first; don't append a tactical paragraph
    // to a pressure-point call that needs to fit between points.
    return call || (gameChanged ? gameFallback : '');
  }

  if (gameChanged) {
    const previous = point.previousGame;
    const streak = Number.isInteger(point.gameStreak) && point.gameStreak >= 3
      ? tennisNumber(point.gameStreak) : '';
    if (winner === server && previous?.broken && previous.winner === winner) {
      if (streak) {
        return selectFreshLine([
          `${winnerName} consolidates — that's ${streak} games in a row.`,
          `${capitalize(streak)} straight games for ${winnerName}, and the break is consolidated.`,
          `${winnerName} holds to back up the break — ${streak} games on the bounce.`,
          `The run continues: ${streak} in a row for ${winnerName}, break consolidated.`,
        ], seedFor(names, point.number), recentLines) || gameFallback;
      }
      return selectFreshLine([
        `${winnerName} consolidates the break.`,
        `And ${winnerName} backs up the break.`,
        `${winnerName} holds — the break is consolidated.`,
          `Important hold from ${winnerName}. The break stands.`,
          `${winnerName} makes the break count with a hold.`,
          `No way back yet — ${winnerName} consolidates.`,
        ], seedFor(names, point.number), recentLines) || gameFallback;
    }
    if (streak) {
        const run = streak;
      return selectFreshLine([
          `${winnerName} takes the game — that's ${run} in a row.`,
          `${capitalize(run)} straight games for ${winnerName}.`,
          `${winnerName} again. That's ${run} games on the bounce.`,
          `${capitalize(run)} games in a row now for ${winnerName}.`,
          `The games keep coming for ${winnerName} — ${run} straight.`,
          `${winnerName} is on a roll: ${run} games running.`,
        ], seedFor(names, point.number), recentLines) || gameFallback;
    }
    return selectFreshLine([
      gameFallback,
      `${winnerName} takes the game.`,
      `That game goes to ${winnerName}.`,
        `${winnerName} wraps up the game.`,
        `Game, ${winnerName}.`,
        `${winnerName} gets the game.`,
        `And that game belongs to ${winnerName}.`,
        `${winnerName} closes out the game.`,
        `Another game for ${winnerName}.`,
        `That's the game for ${winnerName}.`,
        `${winnerName} finishes the game off.`,
      ], seedFor(names, point.number), recentLines) || gameFallback;
  }

  if (!gameChanged && server !== null && winner === server && points && isGamePoint(points, server)) {
    const lines = [
      `Big point! ${winnerName} takes the game.`,
      `Oh, that's well played—${winnerName} closes out the game.`,
      `Game to ${winnerName}!`,
    ];
    return selectFreshLine(
      lines,
        seedFor(names, Number.isInteger(point.number) ? point.number : rallyHits ?? 0),
      recentLines,
    );
  }

  if (point?.faults >= 2 && server !== null && winner !== server) {
    return selectFreshLine([
      `Oh, the double fault! ${winnerName} takes the gift.`,
      `Double fault. ${serverName} will want that one back.`,
      `A costly double fault—${winnerName} says thank you.`,
      `Two faults. That's a free point for ${winnerName}.`,
      `${serverName} double faults. Not what they needed.`,
      `Another one gifted to ${winnerName}. Double fault.`,
      `Double fault from ${serverName}. That one hurts.`,
    ], seedFor(names, point.number), recentLines);
  }

  if (serveSpeed && winner === server && serverName && rallyShotCount === 0) {
    return selectFreshLine([
      `What a serve from ${serverName}!`,
      `${serverName} catches the line with that serve!`,
      point.number % 5 === 0
        ? `A huge serve from ${serverName} at ${serveSpeed} kilometres an hour. No way through that.`
        : `What a delivery from ${serverName}!`,
      `Unreturned! ${serverName} takes it on serve.`,
      `${serverName} serves it and that's that.`,
      `No reply to that serve. Point ${serverName}.`,
      `Too good! ${serverName} wins it on serve.`,
      `${serverName} lets the serve do the work.`,
      `A free point on serve for ${serverName}.`,
    ], seedFor(names, point.number), recentLines);
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
      `What a rally that was. ${winnerName} wins it in the end.`,
      `Superb tennis from both of them — ${winnerName} edges it.`,
      `Back and forth, back and forth — and it's ${winnerName}'s point.`,
      `The crowd will love that one. ${winnerName} takes it.`,
      `Terrific point! ${winnerName} prevails.`,
      `That was a battle, and ${winnerName} wins it.`,
      `${winnerName} outlasts the other player in that one.`,
      `Incredible exchange. ${winnerName} gets there.`,
    ], seedFor(names, point.number), recentLines);
  }

  if (point.winningStreak >= 4 && point.winningStreak % 4 === 0) {
    return selectFreshLine([
      `${point.winningStreak} straight! ${winnerName} is rolling.`,
      `The tide is turning. ${winnerName} has the last ${point.winningStreak}.`,
      `${winnerName} is making the other player work for every point.`,
      `That's ${point.winningStreak} points in a row for ${winnerName}.`,
      `${winnerName} has won the last ${point.winningStreak} points.`,
      `${point.winningStreak} on the bounce for ${winnerName}.`,
      `It's all ${winnerName} at the moment — ${point.winningStreak} straight points.`,
    ], seedFor(names, point.number), recentLines);
  }

  if (matchSwing && matchSwing >= 10) {
    return selectFreshLine([
      `That's a big one for ${winnerName}! The match-win model swings ${matchSwing} points their way.`,
      `Momentum may be shifting—${winnerName} makes a ${matchSwing}-point move in the model.`,
        `A big swing: the model moves ${matchSwing} points towards ${winnerName}.`,
        `That point matters — ${winnerName} gains ${matchSwing} points in the match-win model.`,
      ], seedFor(names, point.number), recentLines);
  }

  if (allowRallyCommentary && tiebreak && featuredRally && featuredRally >= 10) {
    return selectFreshLine([
      `Tie-break pressure, a ${featuredRally}-shot exchange — ${winnerName} takes it.`,
      `${winnerName} wins the ${featuredRally}-shot rally in the tie-break.`,
      `A long tie-break point of ${featuredRally} shots goes to ${winnerName}.`,
      `${featuredRally} shots in a tie-break! ${winnerName} holds their nerve.`,
      `Huge tie-break point — ${featuredRally} shots, and ${winnerName} wins it.`,
    ], seedFor(names, point.number), recentLines);
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
      `Long point, and ${winnerName} wins it.`,
      `${winnerName} sees that one through.`,
      `Plenty of shots there — ${winnerName}'s point.`,
      `${winnerName} stays in it and gets the reward.`,
      `They went the distance. ${winnerName} takes it.`,
      `Hard-earned, ${winnerName}.`,
    ];
    return selectFreshLine(
      lines,
        seedFor(names, Number.isInteger(point.number) ? point.number : rallyHits),
      recentLines,
    );
  }

  return '';
}

/** Add a brief score-pressure call when the recorded score verifies it. */
export function buildDmoPointCommentary(point, names = [], recentLines = []) {
  const call = basePointCommentary(point, names, recentLines);
  if (!point || point.inferred === true) return call;
  if (!spokenName(names[0]) || !spokenName(names[1])) return call;
  if (!call && point.scoreAfterLabel && point.scoreBeforeLabel
    && (!gamesAtStart(point.scoreBeforeLabel) || !gamesAtStart(point.scoreAfterLabel))) return call;
  const pressure = dmoPressureAfterPoint(point);
  const tag = pressure ? pressurePhrase(pressure, names, seedFor(names, point.number), recentLines) : '';
  if (!tag) return call;
  return call ? `${call} ${tag}` : tag;
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
    `This is a long rally — ${rallyShotCount} shots and counting between ${firstName} and ${secondName}.`,
    `Who's going to blink first? ${firstName} and ${secondName} are locked in this rally.`,
    `${rallyShotCount} shots in this point now, and neither ${firstName} nor ${secondName} will give it up.`,
    `Patience from both ${firstName} and ${secondName} in this rally.`,
    `Neither ${firstName} nor ${secondName} is giving anything away in this rally.`,
    `And still this point goes on — ${firstName} and ${secondName}, ${rallyShotCount} shots.`,
  ];
  const variation = Math.floor(rallyShotCount / 4)
    + (Number.isInteger(pointNumber) ? pointNumber : 0);
  return selectFreshLine(lines, seedFor(names, variation), recentLines);
}

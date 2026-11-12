import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  buildDmoCommentaryFacts,
  buildDmoCommentaryIntroduction,
  buildDmoCommentaryOpeningReply,
  buildDmoCommentaryResponse,
  buildDmoCommentaryFollowUp,
  buildDmoPointCommentary,
  buildDmoRallyCommentary,
  rankDmoBrowserVoices,
  chooseDmoCommentaryVoice,
  chooseDmoCommentaryVoices,
  withDmoCommentaryHistory,
} from '../lib/dmoCommentary.mjs';
import { normalizeDmoTournamentName } from '../lib/dmoTournamentName.mjs';
import {
  getDmoCharacterAppearance,
  getDmoCharacterComplexionColor,
} from '../lib/dmoCharacterAppearance.mjs';

test('curated complexion colors follow the character name and keep unknowns at the default', () => {
  assert.equal(getDmoCharacterComplexionColor('Naomi Osaka'), 0x805440);
  assert.equal(getDmoCharacterComplexionColor('WTA - Naomi Osaka'), 0x805440);
  assert.equal(getDmoCharacterAppearance('Daniil Medvedev').complexionColor, 0xd8ad92);
  assert.equal(getDmoCharacterAppearance('Sumit Nagal').complexionColor, 0xa87658);
  assert.equal(getDmoCharacterComplexionColor('Unknown Player'), null);
});

test('introduction sounds like a broadcast and uses verified WTSL context', () => {
  const intro = buildDmoCommentaryIntroduction({
    names: ['Naomi Osaka', 'Daniil Medvedev'],
    tournament: 'Shanghai Masters',
    surface: 'Hard',
    round: 'Quarter-final',
  });

  // The wording varies by match; the verified facts must all be there.
  for (const part of [/Shanghai Masters/, /Quarter-final/, /Naomi Osaka/, /Daniil Medvedev/, /on the hard courts\.$/]) {
    assert.match(intro, part);
  }
  assert.equal(intro, buildDmoCommentaryIntroduction({
    names: ['Naomi Osaka', 'Daniil Medvedev'], tournament: 'Shanghai Masters', surface: 'Hard', round: 'Quarter-final',
  }), 'the same match always gets the same introduction');
  const otherIntros = new Set(['gifu', 'Debuffy', 'barboza', 'squeaky', 'Player One', 'TheTinkerman_']
    .map((name) => buildDmoCommentaryIntroduction({ names: [name, 'Naomi Osaka'], tournament: 'Shanghai Masters' })
      .replace(name, 'X')));
  assert.ok(otherIntros.size > 1, 'different matches do not all open with the same words');
  assert.equal(
    buildDmoCommentaryFacts({
      names: ['Naomi Osaka', 'Daniil Medvedev'],
      context: {
        tour: 'ATP',
        players: [{ rank: 3, tourElo: 1920 }, { rank: 9, tourElo: 1870 }],
        headToHead: { firstWins: 2, secondWins: 1, matches: 3 },
      },
    }),
    "In the WTSL ATP rankings, Naomi Osaka is number 3, with Daniil Medvedev at number 9. There's a little history here: Naomi Osaka leads their WTSL head-to-head, 2 to 1.",
  );
  assert.match(
    buildDmoCommentaryFacts({
      names: ['Naomi Osaka', 'Daniil Medvedev'],
      context: { tour: 'ATP', players: [{ rank: null, tourElo: 1920 }, { rank: null, tourElo: 1870 }] },
    }),
    /Tour Elo ratings are 1,920 and 1,870/,
  );
  assert.equal(
    buildDmoCommentaryFacts({
      names: ['Player One', 'Player Two'],
      context: { tour: 'ATP', players: [], headToHead: { firstWins: 2, secondWins: 2, matches: 4 } },
    }),
    "There's nothing between them in WTSL play: 2 wins apiece.",
  );
  assert.match(
    buildDmoCommentaryFacts({
      names: ['Player One', 'Player Two'],
      context: {
        tour: 'WTA',
        players: [],
        headToHead: { firstWins: 6, secondWins: 1, matches: 7 },
      },
    }),
    /Player One leads their WTSL WTA head-to-head, 6 to 1/,
  );
});

test('TE4 court labels resolve to tournament names or stay out of speech', () => {
  assert.equal(normalizeDmoTournamentName('0053 Court Phillipe Chartrier'), 'Roland-Garros');
  assert.equal(normalizeDmoTournamentName('0119 Shanghai ATP 1000'), 'Shanghai Masters');
  assert.equal(normalizeDmoTournamentName('0042 Court Unknown'), null);
  assert.match(
    buildDmoCommentaryIntroduction({
      names: ['Player One', 'Player Two'],
      tournament: '0053 Court Phillipe Chartrier',
    }),
    /^We're at Roland-Garros\./,
  );
  assert.doesNotMatch(
    buildDmoCommentaryIntroduction({
      names: ['Player One', 'Player Two'],
      tournament: '0042 Court Unknown',
    }),
    /0042|Court Unknown/,
  );
});

test('routine points stay quiet while long rallies get a single stronger reaction', () => {
  assert.equal(
    buildDmoPointCommentary(
      { number: 1, winner: 2, server: 1, rallyHits: 5 },
      ['Player One', 'Player Two'],
    ),
    '',
  );
  assert.equal(
    buildDmoPointCommentary(
      { number: 2, winner: 1, server: 1, rallyHits: 9 },
      ['Player One', 'Player Two'],
    ),
    '',
  );
  const firstLong = buildDmoPointCommentary(
    { number: 1, winner: 1, server: 1, rallyHits: 12, scoreBeforeLabel: '15-30' },
    ['Player One', 'Player Two'],
  );
  const secondLong = buildDmoPointCommentary(
    { number: 2, winner: 2, server: 1, rallyHits: 12 },
    ['Player One', 'Player Two'],
  );
  assert.match(firstLong, /Player One/);
  assert.match(secondLong, /Player Two/);
  assert.notEqual(firstLong.replace('Player One', 'X'), secondLong.replace('Player Two', 'X'));
  assert.equal(buildDmoPointCommentary({ winner: 0 }, ['Player One', 'Player Two']), '');
});

test('mid-rally calls use shot count and vary without claiming a winner', () => {
  assert.equal(buildDmoRallyCommentary({
    names: ['gifu', 'TheTinkerman_'],
    rallyShotCount: 7,
  }), '');
  const first = buildDmoRallyCommentary({
    names: ['gifu', 'TheTinkerman_'],
    rallyShotCount: 10,
    pointNumber: 0,
  });
  const second = buildDmoRallyCommentary({
    names: ['gifu', 'TheTinkerman_'],
    rallyShotCount: 10,
    pointNumber: 1,
  });
  assert.match(first, /gifu|The Tinkerman/);
  assert.match(second, /gifu|The Tinkerman/);
  assert.match(first, /rally|point/);
  assert.match(second, /rally|point/);
  assert.notEqual(first, second);
  assert.equal(buildDmoRallyCommentary({
    names: ['gifu', ''],
    rallyShotCount: 12,
  }), '');
});

test('pressure-point calls distinguish a break, a save, and a game point', () => {
  assert.match(
    buildDmoPointCommentary({
      winner: 2,
      server: 1,
      rallyHits: 3,
      scoreBeforeLabel: '2-3(30-40)',
    }, ['Player One', 'Player Two']),
    /takes the break/,
  );
  assert.equal(
    buildDmoPointCommentary({
      winner: 1,
      server: 1,
      rallyHits: 2,
      scoreBeforeLabel: '40-AD',
    }, ['Player One', 'Player Two']),
    'The pressure stays on, but Player One saves the break point.',
  );
  assert.match(
    buildDmoPointCommentary({
      winner: 1,
      server: 1,
      rallyHits: 3,
      scoreBeforeLabel: '0-0(40-30)',
    }, ['Player One', 'Player Two']),
    /game/,
  );
  assert.match(
    buildDmoPointCommentary({
      winner: 1,
      server: 2,
      rallyHits: 3,
      scoreBeforeLabel: '40-30',
    }, ['Player One', 'Player Two']),
    /takes the break/,
  );
});

test('routine games receive a short call while verified set wins are called once', () => {
  const hold = {
    winner: 1, server: 1, rallyHits: 4,
    scoreBeforeLabel: '2-1(40-30)', scoreAfterLabel: '3-1(0-0)',
  };
  assert.match(buildDmoPointCommentary(hold, ['Player One', 'Player Two']), /game/i);
  assert.equal(buildDmoPointCommentary(hold, ['Player One', 'Player Two'], [
    'Game to Player One.', 'Player One takes the game.', 'That game goes to Player One.',
  ]).length > 0, true, 'a fully used pool still produces a game call');
  assert.match(
    buildDmoPointCommentary({
      winner: 2,
      server: 1,
      rallyHits: 4,
      scoreBeforeLabel: '4-3(30-40)',
      scoreAfterLabel: '4-4(0-0)',
    }, ['Player One', 'Player Two']),
    /break/,
  );
  assert.match(
    buildDmoPointCommentary({
      winner: 1,
      server: 1,
      scoreBeforeLabel: '5-4(40-30)',
      scoreAfterLabel: '6-4(0-0)',
      setBefore: 1,
      setAfter: 2,
    }, ['Player One', 'Player Two']),
    /^(?=.*Player One)(?=.*\bset\b)/i,
  );
  assert.equal(
    buildDmoPointCommentary({
      winner: 2,
      server: 1,
      isTiebreak: true,
      scoreBeforeLabel: '6-6(6-5)',
      scoreAfterLabel: '6-6(6-6)',
    }, ['Player One', 'Player Two']),
    '',
  );
});

test('browser commentary voice ranking filters to English and prefers natural voices', () => {
  const voices = rankDmoBrowserVoices([
    { voiceURI: 'us-basic', name: 'English US', lang: 'en-US', localService: true },
    { voiceURI: 'uk-basic', name: 'English UK', lang: 'en-GB', localService: true },
    { voiceURI: 'uk-neural', name: 'English UK Neural', lang: 'en-GB', localService: false },
    { voiceURI: 'french', name: 'French', lang: 'fr-FR', localService: true },
  ]);

  assert.deepEqual(voices.map((voice) => voice.voiceURI), [
    'uk-neural',
    'us-basic',
    'uk-basic',
  ]);
});

test('commentary stays spoken-only with no court text bubble', async () => {
  const [component, styles, display] = await Promise.all([
    readFile(new URL('../components/DmoLiveCourt3D.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../components/DmoLiveCourt3D.module.css', import.meta.url), 'utf8'),
    readFile(new URL('../components/DmoLiveDisplay.tsx', import.meta.url), 'utf8'),
  ]);
  assert.doesNotMatch(component, /commentary\.message|commentaryCaption/);
  assert.doesNotMatch(styles, /commentaryCaption/);
  assert.doesNotMatch(component, /Choose commentary voice|commentary\.browserVoices/);
  assert.doesNotMatch(component, /Preview local voices|Preview Kokoro/);
  assert.match(component, /styles\.legend[\s\S]*PALETTE\.playerOne/);
  assert.match(component, /styles\.legend[\s\S]*PALETTE\.playerTwo/);
  assert.match(component, /styles\.legend[\s\S]*PALETTE\.yellow[\s\S]*Ball/);
  assert.match(display, /tournamentName\?\.trim\(\)/);
  assert.doesNotMatch(display, /snapshot\.stadium\s*\|\|/);
});

test('speech uses readable WTSL handles and stays silent without player names', () => {
  assert.match(buildDmoCommentaryIntroduction({ names: ['gifu', 'TheTinkerman_'] }),
    /gifu against The Tinkerman/);
  assert.equal(buildDmoCommentaryIntroduction({ names: ['', 'TheTinkerman_'] }), '');
  assert.equal(buildDmoPointCommentary({ winner: 1, rallyHits: 20 }, ['', 'gifu']), '');
  assert.equal(buildDmoPointCommentary({ winner: 1, rallyHits: 20, inferred: true },
    ['gifu', 'TheTinkerman_']), '');
});

test('legacy voice selection still chooses the highest-ranked English voice', () => {
  const basic = { voiceURI: 'uk', name: 'English UK', lang: 'en-GB' };
  const google = { voiceURI: 'google', name: 'Google UK English', lang: 'en-GB' };
  const natural = { voiceURI: 'natural', name: 'US Natural', lang: 'en-US' };
  assert.equal(chooseDmoCommentaryVoice([basic]), basic);
  assert.equal(chooseDmoCommentaryVoice([basic, google, natural]), natural);
  assert.equal(chooseDmoCommentaryVoice([basic, google, natural], 'google'), natural);
  assert.equal(chooseDmoCommentaryVoice([basic, google, natural], 'uk'), natural);
  assert.equal(chooseDmoCommentaryVoice([basic, natural], 'missing-device-voice'), natural);
  assert.equal(chooseDmoCommentaryVoice([{ ...natural, lang: 'fr-FR' }]), null);
});

test('the booth prefers distinct American voices and falls back transparently', () => {
  const female = {
    voiceURI: 'aria-us',
    name: 'Microsoft Aria Natural Online',
    lang: 'en-US',
  };
  const male = {
    voiceURI: 'guy-us',
    name: 'Microsoft Guy Natural Online',
    lang: 'en-US',
  };
  const selected = chooseDmoCommentaryVoices([
    { voiceURI: 'uk', name: 'English UK', lang: 'en-GB' },
    male,
    female,
  ]);
  assert.equal(selected.female, female);
  assert.equal(selected.male, male);
  assert.equal(selected.distinct, true);

  const fallback = chooseDmoCommentaryVoices([female]);
  assert.equal(fallback.female, female);
  assert.equal(fallback.male, female);
  assert.equal(fallback.distinct, false);
  assert.deepEqual(chooseDmoCommentaryVoices([{ ...female, lang: 'fr-FR' }]), {
    female: null,
    male: null,
    distinct: false,
  });
});

test('one-time booth replies use verified player names', () => {
  const names = ['Naomi Osaka', 'Daniil Medvedev'];
  const opening = buildDmoCommentaryOpeningReply({ names });
  assert.ok(opening);
  const reply = buildDmoCommentaryResponse({
    names,
    winner: 1,
    pointNumber: 2,
  });
  assert.ok(reply);
  assert.match(reply, /Naomi Osaka/);
  assert.match(reply, /Daniil Medvedev/);
  assert.equal(buildDmoCommentaryResponse({ names, winner: 0 }), '');
});

test('the second commentator builds on calls and sometimes offers a grounded counter-read', () => {
  const names = ['gifu', 'TheTinkerman_'];
  const point = { number: 8, winner: 1, server: 2, rallyHits: 12 };
  const disagreement = buildDmoCommentaryFollowUp({
    names, point, leadLine: 'What a point! gifu takes it.',
  });
  assert.match(disagreement, /Hang on|I see it a little differently|don't forget/);
  assert.match(disagreement, /The Tinkerman/);
  assert.match(disagreement, /12-shot|12 shots/);

  const followUp = buildDmoCommentaryFollowUp({
    names,
    point: { number: 3, winner: 1, server: 1, rallyHits: 0 },
    leadLine: 'What a serve from gifu!',
  });
  assert.match(followUp, /Exactly|Yes|That's the value/);
  assert.match(followUp, /gifu/);
  assert.equal(buildDmoCommentaryFollowUp({ names, point, leadLine: '' }), '');
});

test('replay placement commentary needs valid, in-point measured bounces', () => {
  const point = { winner: 1, server: 1, rallyHits: 12, shotEndTime: 100,
    shots: [
      { p: 1, k: 'r', bx: 800, by: 330, bt: 20 },
      { p: 1, k: 'r', bx: -1000, by: -320, bt: 60 },
    ] };
  assert.match(buildDmoPointCommentary(point, ['gifu', 'TheTinkerman_']), /gifu.*(side to side|both corners|open court)|(side to side|both corners).*gifu|Side to side.*gifu/);
  for (const replacement of [
    { by: 600 }, { bx: 1400 }, { bt: 120 }, { bx: null }, { k: 's' }, { p: 2 },
  ]) {
    const changed = { ...point, shots: [point.shots[0], { ...point.shots[1], ...replacement }] };
    assert.doesNotMatch(buildDmoPointCommentary(changed, ['gifu', 'TheTinkerman_']),
      /wide targets|slice|volley|forehand|backhand/);
  }
});

test('depth observations count only measured balls inside the singles court', () => {
  const shots = [930, -1000, 1100].map((bx) => ({ p: 2, k: 'r', bx, by: 100 }));
  const line = buildDmoPointCommentary({ winner: 2, rallyHits: 12, shots }, ['gifu', 'TheTinkerman_']);
  assert.match(line, /The Tinkerman.*(deep|baseline)|Length was the key.*The Tinkerman/);
});

test('pressure-point reactions do not append longer tactical analysis', () => {
  const line = buildDmoPointCommentary({
    number: 3, winner: 2, server: 1, rallyHits: 12, scoreBeforeLabel: '30-40',
    shots: [930, -1000, 1100].map((bx) => ({ p: 2, k: 'r', bx, by: 100 })),
  }, ['gifu', 'TheTinkerman_']);
  assert.match(line, /The Tinkerman/);
  assert.match(line, /break|Broken/i);
  assert.doesNotMatch(line, /landed|metres|depth/);
});

test('live serve speed is called only when a serve is actually unreturned', () => {
  const point = { winner: 1, server: 1, rallyHits: 0, serveSpeedKmh: 202 };
  assert.match(buildDmoPointCommentary(point, ['gifu', 'TheTinkerman_']), /gifu/);
  assert.match(buildDmoPointCommentary(point, ['gifu', 'TheTinkerman_']), /serve|delivery|Unreturned/i);
  assert.doesNotMatch(
    buildDmoPointCommentary({ ...point, rallyHits: 3 }, ['gifu', 'TheTinkerman_']),
    /202 kilometres an hour/,
  );
  assert.doesNotMatch(
    buildDmoPointCommentary({ ...point, serveSpeedKmh: 800 }, ['gifu', 'TheTinkerman_']),
    /800 kilometres an hour/,
  );
});

test('tie-break scores cannot produce normal-game break-point commentary', () => {
  const line = buildDmoPointCommentary({
    winner: 2, server: 1, rallyHits: 10, isTiebreak: true, scoreBeforeLabel: '30-40',
  }, ['gifu', 'TheTinkerman_']);
  assert.match(line, /What a point/);
  assert.doesNotMatch(line, /takes the break|service game|break point converted/i);
});

test('double faults and lengthy second-serve points use recorded evidence', () => {
  assert.match(buildDmoPointCommentary({
    winner: 2, server: 1, rallyHits: 0, faults: 2, scoreBeforeLabel: '30-40',
  }, ['gifu', 'TheTinkerman_']), /double fault.*break|break.*double fault/i);
  const secondServeRally = buildDmoPointCommentary({
    winner: 2, server: 1, rallyHits: 10, faults: 1,
  }, ['gifu', 'TheTinkerman_']);
  assert.match(secondServeRally, /The Tinkerman/);
  assert.doesNotMatch(secondServeRally, /double fault|break/i);
});

test('momentum uses only contiguous, earlier, non-inferred points', () => {
  const point = { number: 4, winner: 1, server: 2, rallyHits: 4 };
  const history = [1, 2, 3, 4, 5].map((number) => ({ number, winner: 1 }));
  const enriched = withDmoCommentaryHistory(point, history);
  assert.equal(enriched.winningStreak, 4);
  assert.match(buildDmoPointCommentary(enriched, ['gifu', 'TheTinkerman_']), /gifu has the last 4/);
  assert.equal(withDmoCommentaryHistory(point, history.filter((p) => p.number !== 2)).winningStreak, 2);
  assert.equal(withDmoCommentaryHistory(point, [{ number: 3, winner: 1, inferred: true }]).winningStreak, 1);
  assert.equal(withDmoCommentaryHistory(point, [{ number: 3, winner: 2 }]).winningStreak, 1);
});

test('live and replay controls supply WTSL names independently of animation picks', async () => {
  const [court, replay, live, hook] = await Promise.all([
    readFile(new URL('../components/DmoLiveCourt3D.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../components/Te4DmoReplayPlayer.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../components/DmoLiveViewer.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../components/useDmoCommentary.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(court, /useDmoCommentary\(\{\s*snapshot,\s*commentaryNames,/);
  assert.match(live, /commentaryNames=\{broadcast\.players\}/);
  assert.match(replay, /alignDmoReplayPlayerStyles\(submissionPlayers, viewer.names, submissionPlayers\)/);
  assert.doesNotMatch(hook, /playerCharacters|snapshot\.players/);
});

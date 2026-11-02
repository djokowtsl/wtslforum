import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  extractDmoTournamentName,
  playScore,
  Te4DmoAnalysisError,
  Te4Replay,
} from '../lib/te4DmoParser.ts';
import {
  displayDmoTournamentName,
  surfaceForDmoTournament,
} from '../lib/te4DmoSurface.ts';
import {
  buildTe4CoachingSummary,
  defaultTe4CoachingPlayer,
  listTe4CoachingPlayers,
} from '../lib/te4DmoCoaching.ts';
import { parseDmoFilename } from '../lib/te4DmoFilename.ts';
import { embedTe4ViewerHtml } from '../lib/te4ViewerEmbed.ts';

const viewerShell = readFileSync(
  new URL('../public/te4-match-viewer-shell.html', import.meta.url),
  'utf8',
);

test('TE4 score reconstruction handles a straight-set match', () => {
  const points = [];
  for (let game = 0; game < 10; game += 1) {
    const winner = game < 8 ? (game % 2 === 0 ? 1 : 2) : 1;
    for (let point = 0; point < 4; point += 1) points.push([winner, 1]);
  }
  const result = playScore(points);
  assert.deepEqual(result.sets, [[6, 4]]);
  assert.deepEqual(result.games, [0, 0]);
  assert.deepEqual(result.points, [0, 0]);
  assert.equal(result.rows.length, 40);
});

test('TE4 score reconstruction marks and closes a deciding tiebreak', () => {
  const points = [];
  for (let game = 0; game < 12; game += 1) {
    const winner = game % 2 === 0 ? 1 : 2;
    for (let point = 0; point < 4; point += 1) points.push([winner, 1]);
  }
  for (let i = 0; i < 6; i += 1) points.push([1, 1]);
  for (let i = 0; i < 6; i += 1) points.push([2, 1]);
  points.push([1, 1], [1, 1]);

  const result = playScore(points);
  assert.deepEqual(result.sets, [[7, 6]]);
  assert.equal(result.rows.at(-1).tiebreak, true);
  assert.equal(result.rows.at(-1).points, '7-6');
});

test('unsupported or truncated DMO inputs fail explicitly', () => {
  assert.throws(
    () => new Te4Replay(Buffer.alloc(0)),
    (error) => error instanceof Te4DmoAnalysisError && /not a supported TE4/i.test(error.message),
  );
});

test('parses player names and set scores from common DMO filename formats', () => {
  assert.deepEqual(
    parseDmoFilename('2026 WTSL Final - Iakumi vs Squeakova 6-1 6-3.dmo'),
    { names: ['Iakumi', 'Squeakova'], score: '6-1 6-3' },
  );
  assert.deepEqual(
    parseDmoFilename('2026_WTSL_Final_-_Iakumi_vs_Squeakova_6-1_7-6(5).DMO'),
    { names: ['Iakumi', 'Squeakova'], score: '6-1 7-6(5)' },
  );
  assert.deepEqual(
    parseDmoFilename('C:\\matches\\Iakumi v. Squeakova.dmo'),
    { names: ['Iakumi', 'Squeakova'], score: null },
  );
  assert.deepEqual(parseDmoFilename('match.dmo'), {
    names: ['Player 1', 'Player 2'],
    score: null,
  });
});

test('embeds both replay placeholders with script-safe JSON', () => {
  const html = embedTe4ViewerHtml(
    'const data = __DATA__; const hands = __HANDEDNESS__;',
    { label: '</script>&' },
    ['left', 'right'],
  );
  assert.match(html, /const data = \{"label":"\\u003c\/script\\u003e\\u0026"\};/);
  assert.match(html, /const hands = \["left","right"\];/);
  assert.throws(
    () => embedTe4ViewerHtml('const data = __DATA__;', {}),
    /template is incomplete/,
  );
});

test('reads the repeated tournament label from the DMO header alone', () => {
  const header = Buffer.alloc(0x100);
  Buffer.from('\x0fDemoTEM2-1.0g.0', 'binary').copy(header);
  const tournament = Buffer.from('0115 Tokyo ATP 500', 'ascii');
  let offset = 0x17;
  header[offset] = tournament.length;
  tournament.copy(header, offset + 1);
  offset += tournament.length + 1;
  header[offset] = tournament.length;
  tournament.copy(header, offset + 1);

  assert.equal(extractDmoTournamentName(header), '0115 Tokyo ATP 500');
  assert.equal(displayDmoTournamentName('0115 Tokyo ATP 500'), 'Tokyo ATP 500');
  assert.equal(extractDmoTournamentName(Buffer.alloc(0x100)), null);
});

test('maps known embedded event names to court surfaces and leaves unknown events unclassified', () => {
  assert.equal(surfaceForDmoTournament('0115 Tokyo ATP 500'), 'hard');
  assert.equal(surfaceForDmoTournament('0112 Laver Cup'), 'hard');
  assert.equal(surfaceForDmoTournament('0009 AO Rod Laver Day'), 'hard');
  assert.equal(surfaceForDmoTournament('Roland Garros'), 'clay');
  assert.equal(surfaceForDmoTournament('Philippe Chatrier'), 'clay');
  assert.equal(surfaceForDmoTournament('Phillipe Chartrier'), 'clay');
  assert.equal(surfaceForDmoTournament('Wimbledon Championships'), 'grass');
  assert.equal(surfaceForDmoTournament('Custom WTSL Event'), 'unknown');
  assert.equal(surfaceForDmoTournament(null), 'unknown');
});

test('ranked DMO highlights stay available when only point-level replay frames exist', () => {
  assert.match(viewerShell, /\$\('highlights'\)\.disabled=highlightSegments\.length===0;/);
  assert.match(viewerShell, /const highlightSegments=\[\];let highlightFrames=0;/);
  assert.match(viewerShell, /a=hasMatch\?matchFrames:active\.a/);
});

test('replay shell accepts parent theme updates for embedded viewers', () => {
  assert.match(viewerShell, /e\.data\?\.type==='set-theme'/);
  assert.match(viewerShell, /setAttribute\('data-theme',e\.data\.theme==='light'\?'light':'dark'\)/);
});

test('DMO viewer exposes multiple camera angles, player framing, and adjustable zoom', () => {
  assert.match(viewerShell, /option value="t">Overhead/);
  assert.match(viewerShell, /option value="p">Behind baseline/);
  assert.match(viewerShell, /option value="s">Sideline/);
  assert.match(viewerShell, /option value="q">Three-quarter/);
  assert.match(viewerShell, /id="zm" min="0\.7" max="1\.8" step="0\.1"/);
  assert.match(viewerShell, /id="focusPlayers" type="button"/);
  assert.match(viewerShell, /id="resetView" type="button"/);
  assert.match(viewerShell, /function setZoom\(value\)/);
  assert.match(viewerShell, /if\(view==='s'\)/);
  assert.match(viewerShell, /const d=x\+y\*\.45\+3200/);
  assert.match(viewerShell, /cx\.arc\(a,headY,7\*u,0,7\)/);
  assert.match(viewerShell, /cx\.fillStyle=shorts/);
  assert.match(viewerShell, /e\.target\?\.closest\?\.\('input,select,textarea,button'\)/);
  assert.match(viewerShell, /function setMode\(next\)/);
  assert.match(viewerShell, /mode==='highlights'/);
});

test('coaching combines only matches with the selected named player and reports evidence counts', () => {
  const makePoint = (server, winner, { faults = 0, hits = 0, lastShotPlayer = winner } = {}) => ({
    s: server,
    w: winner,
    f: faults,
    n: hits,
    sh: hits ? [{ p: lastShotPlayer }] : [{ p: server }],
  });
  const makeResult = (names, finalWinner, pts) => ({
    names,
    meta: { finalWinner },
    viewer: { pts },
  });
  const firstMatch = makeResult(
    ['Avery', 'Opponent 1'],
    1,
    [
      ...Array.from({ length: 10 }, (_, index) => makePoint(1, index < 7 ? 1 : 2)),
      ...Array.from({ length: 10 }, (_, index) => makePoint(2, index < 4 ? 1 : 2)),
      ...Array.from({ length: 8 }, (_, index) => makePoint(1, index < 3 ? 1 : 2, {
        hits: 8,
        lastShotPlayer: 1,
      })),
    ],
  );
  const secondMatch = makeResult(
    ['Avery', 'Opponent 2'],
    2,
    [
      ...Array.from({ length: 10 }, (_, index) => makePoint(1, index < 6 ? 1 : 2)),
      ...Array.from({ length: 10 }, (_, index) => makePoint(2, index < 3 ? 1 : 2)),
    ],
  );
  const unrelatedMatch = makeResult(
    ['Other Player', 'Opponent 3'],
    1,
    Array.from({ length: 20 }, () => makePoint(1, 1)),
  );

  assert.deepEqual(listTe4CoachingPlayers([firstMatch, secondMatch, unrelatedMatch]), [
    'Avery',
    'Opponent 1',
    'Opponent 2',
    'Opponent 3',
    'Other Player',
  ]);
  assert.equal(defaultTe4CoachingPlayer([firstMatch, secondMatch]), 'Avery');

  const summary = buildTe4CoachingSummary(
    [firstMatch, secondMatch, unrelatedMatch],
    'Avery',
  );
  assert.equal(summary.matchesAnalyzed, 3);
  assert.equal(summary.matchesWithPlayer, 2);
  assert.equal(summary.matchWins, 1);
  assert.equal(summary.stats.servicePoints, 28);
  assert.equal(summary.stats.servicePointsWon, 16);
  assert.equal(summary.stats.returnPoints, 20);
  assert.equal(summary.stats.returnPointsWon, 7);
  assert.equal(summary.stats.longRallyPoints, 8);
  assert.ok(summary.insights.some((insight) => /long rallies/i.test(insight.title)));
  assert.ok(summary.insights.every((insight) => insight.evidence.length > 0 && insight.cue.length > 0));
});

test('coaching does not combine generic player placeholders or invent insights from empty samples', () => {
  const genericResult = {
    names: ['Player 1', 'Player 2'],
    meta: { finalWinner: 1 },
    viewer: { pts: [] },
  };
  assert.deepEqual(listTe4CoachingPlayers([genericResult]), []);
  assert.equal(defaultTe4CoachingPlayer([genericResult]), null);

  const summary = buildTe4CoachingSummary([genericResult], '');
  assert.equal(summary.matchesWithPlayer, 0);
  assert.deepEqual(summary.insights, []);
});

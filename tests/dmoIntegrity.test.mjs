import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
  DMO_INTEGRITY_LEVELS,
  assessDmoIntegrity,
  assessPlayer,
  compareIntegrityScans,
  DMO_INTEGRITY_ANALYZER_VERSION,
  summarizeAnalyzerRun,
} from '../lib/dmoIntegrityScore.mjs';

const require = createRequire(import.meta.url);
const root = new URL('../', import.meta.url);
const source = (path) => readFileSync(new URL(path, root), 'utf8');
const sha256 = (path) => createHash('sha256').update(readFileSync(new URL(path, root))).digest('hex');

function player(overrides = {}) {
  return {
    name: 'Player',
    longPreparations: 200,
    shortGapPreparations: 4,
    repeatedGapPreparations: 0,
    repeatedGapShare: 0,
    flaggedWindows: 0,
    weakWindows: 0,
    intermediateWindows: 0,
    convergingWindows: 0,
    recordedPlateaus: 0,
    aimGaps: 5,
    moveGaps: 50,
    changesPer100s: 220,
    impactShots: 100,
    impactMedianCm: 320,
    ...overrides,
  };
}

function summary(a, b) {
  return { version: DMO_INTEGRITY_ANALYZER_VERSION, match: {}, players: [player({ name: 'A', ...a }), player({ name: 'B', ...b })], passages: [] };
}

test('the vendored analyzer matches the shared tool (one export line added)', () => {
  assert.equal(sha256('lib/te4InputAnalyzer/analyze-dmo.cjs'), '95d531936308f99fb746986497b1b60b974cbf962656a7d21e23bc299f0d83d6');
  assert.equal(sha256('lib/te4InputAnalyzer/measure-aim-at-impact.cjs'), 'c25bd7f19983d6449f5fd072a5d529af4ac1d1c256a88f53b9437879d3eca9a3');
  const analyzer = source('lib/te4InputAnalyzer/analyze-dmo.cjs');
  assert.match(analyzer, /RecordedAnalysis, Analyze, WriteReport \};/);
  // Read-only tool: no network, no child processes.
  assert.doesNotMatch(analyzer, /child_process|require\('node:https?'\)|fetch\(/);
});

test('the vendored analyzer loads under Node and flags a synthetic aim regulator', () => {
  const analyzer = require('../lib/te4InputAnalyzer/analyze-dmo.cjs');
  for (const name of ['ReadDemo', 'CalibrateTime', 'Analyze', 'WriteReport', 'WindowMetrics', 'SimulateAim']) {
    assert.equal(typeof analyzer[name], 'function', name);
  }
  // Same construction as the tool's own self-test: tap the direction on and off
  // to hold aim near 350 cm.
  const step = 1 / 60;
  const scale = 720000 / (1189 / 2 + 400) * step;
  const signs = [];
  let value = 0;
  for (let i = 0; i < 240; i += 1) {
    const sign = value < 350 ? 1 : 0;
    signs.push(sign);
    value = sign ? (value > 0 ? value + scale : 100) : value * Math.pow(0.2, step);
  }
  const slice = signs.slice(100, 161);
  const models = [900, 1189, 1600].map((baseline) => analyzer.SimulateAim(signs, step, baseline).slice(100, 161));
  assert.ok(analyzer.WindowMetrics(slice, models, step).Strength >= 2);
  const hold = Array(120).fill(1);
  assert.equal(analyzer.WindowMetrics(hold, [900, 1189, 1600].map((b) => analyzer.SimulateAim(hold, step, b)), step).Strength, 0);
  assert.throws(() => analyzer.ReadDemo(Buffer.from('not a demo')));
});

test('rubric: clean players get no flags', () => {
  const result = assessDmoIntegrity(summary({}, {}));
  assert.equal(result.level, 'none');
  assert.deepEqual(result.flaggedPlayers, []);
});

test('levels follow the analyzer grade of the strongest passage, nothing else', () => {
  // Strength 3 -> Converging indicators.
  assert.equal(assessPlayer(player({ convergingWindows: 1, flaggedWindows: 1 })).level, 'high');
  // Strength 2 -> Intermediate, even for a single passage.
  assert.equal(assessPlayer(player({ intermediateWindows: 1, flaggedWindows: 1 })).level, 'medium');
  // Strength 1 -> Weak / exploratory, however many.
  assert.equal(assessPlayer(player({ weakWindows: 33, flaggedWindows: 33 })).level, 'weak');
  // Gap rates, recorded plateaus and the opponent never change the level.
  assert.equal(assessPlayer(player({ repeatedGapPreparations: 60, repeatedGapShare: 0.5, recordedPlateaus: 4 })).level, 'none');
  const squeaky = assessDmoIntegrity(summary(
    { weakWindows: 33, flaggedWindows: 33, repeatedGapPreparations: 33, longPreparations: 138, repeatedGapShare: 33 / 138 },
    { weakWindows: 6, intermediateWindows: 2, flaggedWindows: 8, repeatedGapPreparations: 6, longPreparations: 212, repeatedGapShare: 6 / 212 },
  ));
  assert.equal(squeaky.players[0].level, 'weak');
  assert.equal(squeaky.players[1].level, 'medium');
  assert.equal(squeaky.level, 'medium');
  assert.deepEqual(squeaky.players[1].reasons, ['2 passages graded "Intermediate"', '6 passages graded "Weak / exploratory"']);
  assert.equal(squeaky.score, 2, 'sort key is the number of passages at the top grade');
});

test('the match takes the player with the stronger grade, and sorting puts it first', () => {
  const result = assessDmoIntegrity(summary({ flaggedWindows: 1, weakWindows: 1 }, { convergingWindows: 2, flaggedWindows: 2 }));
  assert.equal(result.score, 2);
  assert.equal(result.level, 'high');
  assert.deepEqual(result.flaggedPlayers, [0, 1]);
  const rows = [
    { status: 'done', level: 'weak', score: 10, submissionDate: '2026-11-23' },
    { status: 'unsupported', level: null, score: null, submissionDate: '2026-11-24' },
    { status: 'done', level: 'high', score: 50, submissionDate: '2026-11-16' },
    { status: 'done', level: 'weak', score: 12, submissionDate: '2026-11-19' },
  ];
  assert.deepEqual(rows.sort(compareIntegrityScans).map((row) => row.submissionDate), ['2026-11-16', '2026-11-19', '2026-11-23', '2026-11-24']);
});

test('summary keeps the analyzer measurements and drops frame data', () => {
  const result = summarizeAnalyzerRun({
    demo: { Header: { Names: ['Alpha', 'Beta'], Build: 167, SubBuild: 5, Version: 32, LagFrames: 7 }, Frames: new Array(600), Scores: [{}, {}] },
    timing: { StepMs: 1000 / 60, OriginMs: 0, NominalFps: 60 },
    analysis: {
      FinalScore: '4-0 4-1',
      Points: [{ Number: 3, Start: 60 }],
      Summary: [
        { Player: 0, Candidates: 3, Medium: 1, High: 0, FireSeconds: 100, ToggleCount: 400 },
        { Player: 1, Candidates: 0, Medium: 0, High: 0, FireSeconds: 100, ToggleCount: 200 },
      ],
      Recorded: {
        Coverage: 1,
        Summary: [
          { Player: 0, LongEpisodes: 50, LongWithShortGaps: 20, LongWithRepeatedGaps: 10, RecordedPlateaus: 0, Aim: { Gaps: [1, 2] }, Move: { Gaps: [1] } },
          { Player: 1, LongEpisodes: 40, LongWithShortGaps: 1, LongWithRepeatedGaps: 0, RecordedPlateaus: 0, Aim: { Gaps: [] }, Move: { Gaps: [] } },
        ],
      },
      Candidates: [
        { Player: 0, Point: 3, Score: 'S1 0-0 / 15-0', Context: 'rally', Start: 120, Duration: 0.5, Strength: 2, Methods: ['simulated aim plateau'], Recorded: { Min: 155.04, Max: 329.4, Median: 250, Plateau: false } },
        { Player: 0, Point: 3, Score: 'S1 0-0 / 15-0', Context: 'rally', Start: 200, Duration: 0.5, Strength: 1, Methods: ['short neutral gaps'], Recorded: { Min: 290, Max: 320, Median: 300, Plateau: true } },
        { Player: 0, Point: 3, Score: 'S1 0-0 / 15-0', Context: 'rally', Start: 300, Duration: 0.5, Strength: 1, Methods: ['short neutral gaps'] },
        { Player: 0, Point: 3, Score: 'S1 0-0 / 15-0', Context: 'service', Start: 70, Duration: 0.5, Strength: 1, Methods: ['short neutral gaps'] },
      ],
    },
    impact: { Rows: [{ Player: 0, MeasuredCm: -300 }, { Player: 0, MeasuredCm: 320 }, { Player: 1, MeasuredCm: 250 }] },
  });
  assert.deepEqual(result.match.names, ['Alpha', 'Beta']);
  assert.equal(result.players[0].repeatedGapShare, 0.2);
  assert.equal(result.players[0].weakWindows, 2);
  assert.equal(result.players[0].intermediateWindows, 1);
  assert.equal(result.players[0].aimGaps, 2);
  assert.equal(result.players[0].impactMedianCm, 300);
  assert.equal(result.passages.length, 3, 'serves are left out of the passages');
  assert.deepEqual(result.passages[0].recordedAim, { minCm: 155, maxCm: 329.4, medianCm: 250, plateau: false });
  assert.equal(result.passages[1].recordedAim.plateau, true);
  assert.equal(result.passages[2].recordedAim, null, 'no recorded aim: not checkable');
  assert.equal(result.players[0].recordedCheckedPassages, 2);
  assert.equal(result.players[0].recordedConfirmedPassages, 1);
  assert.equal(result.players[0].strongPassagesChecked, 1);
  assert.equal(result.players[0].strongPassagesConfirmed, 0);
  assert.equal(result.passages[0].matchTimeSeconds, 2);
  assert.equal(result.passages[0].intoPointSeconds, 1);
  assert.ok(JSON.stringify(result).length < 4000);
});

test('the summary retains recorded-aim checks for every flagged passage', () => {
  const candidates = Array.from({ length: 13 }, (_, index) => ({
    Player: 0,
    Point: index + 1,
    Score: '',
    Context: 'rally',
    Start: index,
    Duration: 0.5,
    Strength: 1,
    Methods: [],
    Recorded: { Min: 120, Max: 140, Median: 130, Plateau: false },
  }));
  const result = summarizeAnalyzerRun({
    demo: { Header: { Names: ['Alpha', 'Beta'] }, Frames: [], Scores: [] },
    timing: { StepMs: 1000 / 60, OriginMs: 0 },
    analysis: {
      Summary: [
        { Player: 0, Candidates: 13, Medium: 0, High: 0 },
        { Player: 1, Candidates: 0, Medium: 0, High: 0 },
      ],
      Candidates: candidates,
      Points: [],
      Recorded: { Summary: [] },
    },
  });
  assert.equal(result.passages.length, 13);
  assert.equal(result.passages.filter((passage) => passage.recordedAim !== null).length, 13);
  assert.equal(result.players[0].recordedCheckedPassages, 13);
  assert.equal(result.players[0].recordedConfirmedPassages, 0);
});

test('labels use analyzer grades and weak-only and clean matches are folded away', () => {
  assert.deepEqual(
    ['high', 'medium', 'weak', 'none'].map((level) => DMO_INTEGRITY_LEVELS[level].label),
    ['Converging indicators', 'Intermediate', 'Weak / exploratory', 'No flags'],
  );
  for (const path of ['app/admin/dmo-integrity/page.tsx', 'app/admin/dmo-submissions/page.tsx', 'app/admin/page.tsx', 'lib/dmoIntegrityScore.mjs']) {
    assert.doesNotMatch(source(path).replace(/no level says "suspicious"/, ''), /suspicio/i, path);
  }
  const page = source('app/admin/dmo-integrity/page.tsx');
  assert.match(page, /group\.level === 'none' \|\| group\.level === 'weak' \? \(\s*<details>/);
  assert.match(page, /recordedAimText\(passage\.recordedAim\)/);
  assert.match(page, /Recorded aim does not confirm it/);
  assert.match(page, /Recorded aim confirms \$\{player\.recordedConfirmedPassages\} of \$\{player\.flaggedWindows\} flagged passages/);
  assert.match(page, /recordedCheckedPassages < player\.flaggedWindows/);
});

test('integrity results are admin-only and scans run in the background after submission', () => {
  for (const path of ['app/api/admin/dmo-integrity/scan/route.ts', 'app/api/admin/dmo-integrity/[id]/report/route.ts']) {
    const route = source(path);
    assert.match(route, /if \(!user\?\.isAdmin\) return NextResponse\.json\(\{ error: 'Admin access required\.' \}, \{ status: 403 \}\)/, path);
  }
  const page = source('app/admin/dmo-integrity/page.tsx');
  assert.match(page, /if \(!user\.isAdmin\) redirect\('\/'\)/);
  const report = source('app/api/admin/dmo-integrity/[id]/report/route.ts');
  assert.match(report, /'Cache-Control': 'private, no-store'/);
  assert.match(report, /connect-src 'none'/);
  for (const path of ['app/api/dmo-submissions/route.ts', 'app/api/sync/dmo-submissions/route.ts']) {
    const route = source(path);
    assert.match(route, /import \{ after, NextRequest, NextResponse \} from 'next\/server'/, path);
    assert.match(route, /after\(\(\) => scanDmoSubmission\(scanId\)/, path);
  }
  // Nothing player-facing reads the results.
  for (const path of ['app/api/dmo-replays/route.ts', 'app/api/dmo-replays/[id]/route.ts', 'lib/dmoReplayLibrary.ts', 'lib/discord.ts']) {
    if (existsSync(new URL(path, root))) assert.doesNotMatch(source(path), /dmoIntegrity|dmo_integrity_scans/, path);
  }
  const lib = source('lib/dmoIntegrity.ts');
  assert.match(lib, /CREATE TABLE IF NOT EXISTS dmo_integrity_scans/);
  assert.match(lib, /isAssertion\(error\) \? 'unsupported' : 'failed'/);
  assert.match(lib, /i\.analyzer_version<>\$\{DMO_INTEGRITY_ANALYZER_VERSION\}/);
});

// Optional: DMO_INTEGRITY_SAMPLE=/path/to/match.dmo node --test tests/dmoIntegrity.test.mjs
test('a real recording, when one is provided', { skip: !process.env.DMO_INTEGRITY_SAMPLE }, () => {
  const analyzer = require('../lib/te4InputAnalyzer/analyze-dmo.cjs');
  const { AnalyzeImpact } = require('../lib/te4InputAnalyzer/measure-aim-at-impact.cjs');
  const demo = analyzer.ReadDemo(readFileSync(process.env.DMO_INTEGRITY_SAMPLE));
  const timing = analyzer.CalibrateTime(demo, null);
  const analysis = analyzer.Analyze(demo, timing);
  const result = summarizeAnalyzerRun({ demo, timing, analysis, impact: AnalyzeImpact(demo, timing) });
  assert.equal(result.players.length, 2);
  assert.ok(result.match.points > 0);
  assert.ok(['high', 'medium', 'weak', 'none'].includes(assessDmoIntegrity(result).level));
});

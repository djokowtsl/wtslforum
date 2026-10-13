import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { characterCategoryScores } from '../lib/characterProfileGroups.mjs';
import {
  buildSizeMechanicsInsight,
  buildStrokeSetupLabels,
  buildStrokeMechanicsInsight,
} from '../lib/characterProfileMechanics.mjs';
import { buildCharacterProfileSummary } from '../lib/characterProfileSummary.mjs';
import { removeUnsupportedCharacterProjections } from '../lib/characterProfileSafety.mjs';

const component = readFileSync(
  new URL('../components/CharacterStatsExplorer.tsx', import.meta.url),
  'utf8',
);

test('character profiles derive a summary from their own ratings and render profile guidance', () => {
  for (const marker of [
    'buildCharacterProfileSummary(',
    '<p className="character-style-description">{characterSummary}</p>',
    'profile.selection_guidance',
    'character-selection-guidance',
    'profile.mechanics_insights',
    'className="panel character-guidance-panel"',
    'profile.technical_interactions',
    'Style &amp; traits',
    'Technical summary',
    'Why not select:',
  ]) {
    assert.ok(component.includes(marker), `character copy binding missing: ${marker}`);
  }
  assert.ok(!component.includes('profile.style_description'));
});

test('serve speed is labelled as average maximal, and size insight uses TE4 reach mechanics', () => {
  for (const marker of [
    'Average maximal serve speed (not absolute peak)',
    'buildSizeMechanicsInsight(profile.height, profile.weight)',
    'buildStrokeMechanicsInsight(profile)',
    "['Size & reach', sizeInsight]",
    "['Stroke setup', strokeInsight]",
  ]) {
    assert.ok(component.includes(marker), `TE4 profile mechanic missing: ${marker}`);
  }
  assert.match(
    buildSizeMechanicsInsight(180, 70),
    /Height 180 cm · weight 70 kg.*very small run-acceleration bonus.*shorter wingspan/,
  );
});

test('character profile explains stroke setup and the documented two-handed tradeoff', () => {
  const insight = buildStrokeMechanicsInsight({
    forehand_type: 'one-handed',
    backhand_type: 'two-handed',
  });

  assert.match(insight, /two-handed backhand/);
  assert.match(insight, /less powerful and less wide/);
  assert.match(insight, /the player needs to get closer to the ball/);
  assert.match(insight, /orange\/red Danger Zone/);
  assert.match(insight, /15 points to Counter/);
  assert.equal(buildStrokeMechanicsInsight({
    forehand_type: 'one-handed',
    backhand_type: 'one-handed',
  }), '');
  assert.match(buildStrokeMechanicsInsight({
    forehand_type: 'two-handed',
    backhand_type: 'one-handed',
  }), /two-handed forehand/i);
});

test('character profile prominently shows one- or two-handed forehand and backhand setup', () => {
  assert.deepEqual(buildStrokeSetupLabels({
    forehand_type: 'one-handed',
    backhand_type: 'two-handed',
  }), ['Forehand: one-handed', 'Backhand: two-handed']);
  assert.deepEqual(buildStrokeSetupLabels({
    forehand_type: null,
    backhand_type: 'unknown',
  }), []);
  assert.ok(component.includes('buildStrokeSetupLabels(profile)'));
  assert.ok(component.includes('strokeSetupLabels.map((label)'));
});

test('same-style characters get summaries from their distinct roster ratings', () => {
  const sharedDescription =
    'Can play deep, take the ball early, or come forward, choosing the best court position instead of forcing one pattern.';
  const firstProfile = {
    character: 'Player One',
    style: 'All-Rounder',
    style_description: sharedDescription,
    stats: [
      { attribute: 'Forehand Power', value: 94, rank: 2, percentile: 0.99 },
      { attribute: 'Service Precision', value: 88, rank: 8, percentile: 0.93 },
      { attribute: 'Speed', value: 85, rank: 12, percentile: 0.89 },
    ],
  };
  const secondProfile = {
    character: 'Player Two',
    style: 'All-Rounder',
    style_description: sharedDescription,
    stats: [
      { attribute: 'Service Power', value: 97, rank: 1, percentile: 1 },
      { attribute: 'Backhand Consistency', value: 91, rank: 5, percentile: 0.96 },
      { attribute: 'Stamina', value: 83, rank: 20, percentile: 0.81 },
    ],
  };
  const firstSummary = buildCharacterProfileSummary(
    firstProfile.character,
    firstProfile.stats,
  );
  const secondSummary = buildCharacterProfileSummary(
    secondProfile.character,
    secondProfile.stats,
  );

  assert.notEqual(firstSummary, secondSummary);
  assert.match(firstSummary, /Forehand Power 94\/100 \(99th percentile\)/);
  assert.match(firstSummary, /forehand-led first strikes/);
  assert.match(secondSummary, /Service Power 97\/100 \(100th percentile\)/);
  assert.match(secondSummary, /first-serve pressure/);
  assert.ok(!firstSummary.includes(sharedDescription));
});

test('summary reports missing ratings instead of reusing generic playstyle copy', () => {
  const first = buildCharacterProfileSummary('Player One', []);
  const second = buildCharacterProfileSummary('Player Two', []);

  assert.notEqual(first, second);
  assert.match(first, /Player One/);
  assert.match(first, /not have enough rating data/);
});

test('category profile uses Core roster percentiles and omits empty default groups', () => {
  const groups = characterCategoryScores({
    'Net & Feel': { score: 0.87, edges: [{ attribute: 'Forehand Volley', percentile: 0.92 }] },
    Movement: { score: 0.4, edges: [{ attribute: 'Speed', percentile: 0.4 }] },
    Variety: { score: 0.5, edges: [] },
  }, []);

  assert.deepEqual(groups.map(({ name, score }) => [name, score]), [
    ['Net & Feel', 87],
    ['Movement', 40],
  ]);
});

test('category fallback averages ranked attribute percentiles, not raw ratings', () => {
  const groups = characterCategoryScores(null, [
    { attribute: 'Serve Power', value: 96, rank: 2, count: 100, percentile: 0.99 },
    { attribute: 'Serve Consistency', value: 92, rank: 7, count: 100, percentile: 0.93 },
    { attribute: 'Speed', value: 74, rank: 61, count: 100, percentile: 0.4 },
    { attribute: 'Muscle Tone', value: 66, rank: 90, count: 100, percentile: 0.11 },
    { attribute: 'Unranked Speed', value: 99, rank: null, count: 100, percentile: null },
    { attribute: 'Topspin Serve', value: 80, rank: 2, count: 100, percentile: 0.99 },
  ]);

  assert.deepEqual(groups.map(({ name, score }) => [name, score]), [
    ['Serve', 96],
    ['Movement', 26],
  ]);
});

test('character comparisons retain mechanics and selection explanations', () => {
  for (const marker of [
    'comparison.first_mechanics',
    'comparison.first_guidance',
    'className="character-comparison-choices"',
  ]) {
    assert.ok(component.includes(marker), `comparison copy binding missing: ${marker}`);
  }
});

test('character profile endpoint strips unverified simulation fields recursively', () => {
  const source = readFileSync(
    new URL('../app/api/character-stats/route.ts', import.meta.url),
    'utf8',
  );
  const unsafe = {
    profile: {
      character: 'Adrian Mannarino',
      mechanics_insights: {
        serve: 'A documented serving note.',
        match_play: '12.1 winners and 5.1 unforced errors per 100 points.',
        signals: { average_rally_length: 10.7 },
      },
      selection_guidance: {
        why_select: 'Use touch and controlled net finishes.',
        point_patterns: ['Estimated winners: 12.1 per 100 points.'],
      },
      combined_ratings: [{
        attribute: 'Overall',
        value: 72,
        simulation: { match_win_pct: 53.4, winners_per_100: 12.1 },
      }],
    },
  };
  const safe = removeUnsupportedCharacterProjections(unsafe);

  assert.ok(source.includes('removeUnsupportedCharacterProjections(upstreamPayload)'));
  assert.deepEqual(safe, {
    profile: {
      character: 'Adrian Mannarino',
      mechanics_insights: {
        serve: 'A documented serving note.',
      },
      selection_guidance: {
        why_select: 'Use touch and controlled net finishes.',
      },
      combined_ratings: [{
        attribute: 'Overall',
        value: 72,
      }],
    },
  });
  assert.ok(!JSON.stringify(safe).includes('per 100 points'));
});

test('profile follows the Discord content order and explains roster and AI evidence', () => {
  const categoryIndex = component.indexOf('className="panel character-category-panel"');
  const traitsIndex = component.indexOf('<h2>Style &amp; traits</h2>');
  const mechanicsIndex = component.indexOf('<h2>Technical summary</h2>');
  const guidanceIndex = component.indexOf('character-selection-guidance');
  const ratingsIndex = component.indexOf('COMBINED SKILLS');
  const attributesIndex = component.indexOf('Attribute rankings');

  assert.ok(categoryIndex >= 0 && traitsIndex > categoryIndex);
  assert.ok(mechanicsIndex > traitsIndex && guidanceIndex > mechanicsIndex);
  assert.ok(ratingsIndex > guidanceIndex && attributesIndex > ratingsIndex);
  assert.ok(component.includes('character-profile-method-note'));
  assert.ok(component.includes('character-ai-insight-warning'));
  assert.ok(component.includes('AI-generated recommendations, not verified match statistics'));
  assert.ok(component.includes('Each category is the average percentile of its rankable attributes'));
  assert.ok(component.includes('Court speed'));
  assert.ok(component.includes('Shot variety'));
  assert.ok(!component.includes('the model is still under construction'));
  assert.ok(!component.includes("['Match play', mechanics.match_play]"));
});

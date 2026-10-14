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
import {
  buildServeInsight,
  buildGroundstrokeInsight,
  buildCourtSpeedInsight,
  buildGamePlanSteps,
  buildNetPlayInsight,
  cleanCharacterMechanic,
  cleanCounterInsight,
  cleanNetInsight,
  cleanStrokeMechanicsInsight,
  cleanShotVarietyInsight,
  cleanSizeReachInsight,
  normalizeCharacterCopy,
  splitRosterEvidenceNotes,
} from '../lib/characterProfileCopy.mjs';
import { removeUnsupportedCharacterProjections } from '../lib/characterProfileSafety.mjs';

const component = readFileSync(
  new URL('../components/CharacterStatsExplorer.tsx', import.meta.url),
  'utf8',
);
const copyTypes = readFileSync(
  new URL('../lib/characterProfileCopy.d.mts', import.meta.url),
  'utf8',
);
const styles = readFileSync(
  new URL('../app/globals.css', import.meta.url),
  'utf8',
);

test('character profiles derive a selected-character summary and render profile guidance', () => {
  for (const marker of [
    'buildCharacterProfileSummary(',
    '<p className="character-style-description">{characterSummary}</p>',
    '<span className="panel-label">SUMMARY</span>',
    'profile.selection_guidance',
    'profile.combined_ratings',
    'ranking_options?: string[]',
    'character-selection-guidance',
    'const selectionRationale = normalizeCharacterCopy(',
    '<h3>Why pick this character?</h3>',
    'profile.mechanics_insights',
    'cleanCounterInsight(mechanics.counter)',
    'className="panel character-guidance-panel"',
    'Style &amp; traits',
    'Technical summary',
    'Trade-off:',
    'Rally-fit guidance',
    'mechanics.exchange_fit',
    'not a prediction of rally duration, point wins, or match results',
    'WTSL calculates these combined ratings',
    'WTSL-combined ${item.attribute}',
  ]) {
    assert.ok(component.includes(marker), `character copy binding missing: ${marker}`);
  }
  assert.ok(!component.includes('profile.style_description'));
  assert.ok(component.includes('<span className="panel-label">ROSTER EVIDENCE</span>'));
  assert.ok(component.includes('<ol className="character-game-plan-list">'));
  assert.ok(component.includes('guidance.why_select || guidance.benefit || guidance.best_for'));
  const summaryHeadingIndex = component.indexOf('<span className="panel-label">SUMMARY</span>');
  const whyPickHeadingIndex = component.indexOf('<h3>Why pick this character?</h3>');
  const rosterEvidenceHeadingIndex = component.indexOf('<span className="panel-label">ROSTER EVIDENCE</span>');
  assert.ok(summaryHeadingIndex < whyPickHeadingIndex);
  assert.ok(whyPickHeadingIndex < rosterEvidenceHeadingIndex);
});

test('style and acceleration mechanics do not repeat roster ranking evidence', () => {
  const style = cleanCharacterMechanic(
    "Meet the ball early and move forward. This character's leading roster edges are Forehand Power 94/100 (rank #20 of 102).",
    'Tommy Paul',
  );
  const acceleration = cleanCharacterMechanic(
    "Tommy Paul: has no special acceleration modifier; movement, timing, and shot choice matter more. The clearest roster-relative limits are Speed 82/100 (rank #66 of 102).",
    'Tommy Paul',
  );

  assert.equal(style, 'Meet the ball early and move forward.');
  assert.equal(
    acceleration,
    'Has no special acceleration modifier; movement, timing, and shot choice matter more.',
  );
  assert.ok(!component.includes('traitNotes.map'));
  assert.ok(component.includes('rosterEvidenceNotes.edgeNotes.get(stat.attribute)'));
  assert.ok(component.includes('rosterEvidenceNotes.additionalNotes.map'));
});

test('roster evidence merges matching notes and avoids repeated or summarized attributes', () => {
  const notes = splitRosterEvidenceNotes(
    [{ attribute: 'Forehand Power' }, { attribute: 'Ball Feeling' }],
    [
      'Forehand Power 95/100 (rank #5 of 102): sets first-strike pace',
      'Ball Feeling 94/100 (rank #7 of 102): improves soft touch',
      'Ball Feeling 94/100 (rank #7 of 102): improves soft touch',
      'Slice serve 100/100 (rank #1 of 102): adds slice on fast surfaces',
      'Backhand Precision 86/100 (rank #91 of 102): controls accuracy',
    ],
    'Backhand Precision is the clearest trade-off.',
  );

  assert.equal(notes.edgeNotes.get('Forehand Power'), 'sets first-strike pace');
  assert.equal(notes.edgeNotes.get('Ball Feeling'), 'improves soft touch');
  assert.deepEqual(notes.additionalNotes, [
    {
      name: 'Slice serve 100/100 (rank #1 of 102)',
      description: 'adds slice on fast surfaces',
    },
  ]);
});

test('court-fit copy follows the documented Topspin surface modifiers', () => {
  assert.equal(
    buildCourtSpeedInsight([{ attribute: 'Topspin', value: 68 }]),
    'Topspin 68% is above neutral: it gives a bonus on clay and slow surfaces (stronger for rally players, smaller for volley players) but increases the handicap on fast surfaces. Choose the Top Spin stroke when slow-court clearance matters; use a Normal strike on faster courts when preserving pace is more important.',
  );
  assert.equal(
    buildCourtSpeedInsight([{ attribute: 'Topspin', value: 50 }]),
    'Topspin 50% is neutral: it gives neither a bonus nor a handicap on fast or slow surfaces. Use a Normal strike for the neutral rally and choose the Top Spin stroke when extra clearance matters more than pace.',
  );
  assert.equal(
    buildCourtSpeedInsight([{ attribute: 'Topspin', value: 23 }]),
    'Topspin 23% is below neutral: lower Topspin favors fast surfaces, while the handicap on slow surfaces grows as the rating falls. On slow courts, choose the Top Spin stroke when you need more clearance; on fast courts, a Normal strike keeps the shot flatter.',
  );
  assert.doesNotMatch(
    buildCourtSpeedInsight([], 'Choose a Top Spin stroke when needed, then use the forehand.'),
    /Choose a Top Spin stroke/,
  );
});

test('shot-variety copy prioritizes each character’s higher Lob or Drop shot rating', () => {
  const sliceNote =
    ' Slice Mastery 80% supports a controlled rally slice; use it to change the bounce after moving the opponent deep.';
  const selectableTemplate =
    ' support selectable shot variation: use the drop shot after pushing the opponent deep, or choose a lob when they close the net.';
  const supportingTemplate =
    ' are supporting options. Establish depth first and use either only when court position gives the shot a purpose.';

  assert.equal(
    cleanShotVarietyInsight(`Lob 86 and drop shot 82${selectableTemplate}${sliceNote}`),
    `Lob 86 is higher than drop shot 82 by 4 points. Favor the lob when the opponent closes in; use the drop shot after pushing them deep.${sliceNote}`,
  );
  assert.equal(
    cleanShotVarietyInsight(`Lob 78 and drop shot 91${selectableTemplate}`),
    'Drop shot 91 is higher than lob 78 by 13 points. Favor it after pushing the opponent deep; keep the lob for when they close in.',
  );
  assert.equal(
    cleanShotVarietyInsight(`Lob 82 and drop shot 82${selectableTemplate}`),
    'Lob and drop shot are tied at 82; use the drop shot after pushing the opponent deep and lob when they close in.',
  );
  assert.equal(
    cleanShotVarietyInsight(`Lob 60 and drop shot 50${supportingTemplate}`),
    'Lob 60 leads drop shot 50 by 10 points, though neither is a standout. Build depth first, then look for the lob when the opponent closes in.',
  );
  assert.match(
    copyTypes,
    /export function cleanShotVarietyInsight\(value: unknown\): string;/,
  );
  assert.ok(component.includes('cleanShotVarietyInsight(mechanics.variation)'));
});

test('net-play copy frames Core-supported net finishes as situational', () => {
  const volleyContext =
    ' The forehand volley (83) is the stronger finishing wing than the backhand volley (67).';
  assert.equal(
    cleanNetInsight(
      `Net Presence 65, average volley 76, and smash 76 support a net finish. Approach after a short or defensive reply, then aim the first volley toward the side the opponent has left open.${volleyContext}`,
    ),
    `Net Presence 65, average volley 76, and smash 76 make a net finish a situational option, not a net-first plan. Approach only after a short or defensive reply; target the open side with the first volley.${volleyContext}`,
  );
  assert.equal(
    cleanNetInsight('Move forward to finish a short ball, not as the default pattern.'),
    'Move forward to finish a short ball, not as the default pattern.',
  );
  assert.match(
    copyTypes,
    /export function cleanNetInsight\(value: unknown\): string;/,
  );
  assert.ok(component.includes('buildNetPlayInsight(profile.stats, mechanics.net)'));
});

test('net-play advice changes with each character’s roster-relative net skill', () => {
  const stats = (percentiles, values = [83, 92, 78, 89]) =>
    ['Net Presence', 'Forehand Volley', 'Backhand Volley', 'Smash'].map(
      (attribute, index) => ({
        attribute,
        value: values[index],
        percentile: percentiles[index] / 100,
        rank: index + 1,
        count: 100,
      }),
    );

  assert.equal(
    buildNetPlayInsight(stats([90, 80, 60, 90])),
    'Net Presence 83, average volley 85, and Smash 89. Across the selected roster, the four net attributes average the 80th percentile. Net play is a relative strength, so approach behind a deep Normal strike or after drawing a short reply—not as a default net-first pattern. The forehand volley (92) is the stronger finishing wing than the backhand volley (78).',
  );
  assert.match(
    buildNetPlayInsight(stats([60, 55, 60, 45], [65, 68, 66, 67])),
    /average the 55th percentile\. Net play is not a top-quarter strength; keep Normal strikes deep/,
  );
  assert.match(
    buildNetPlayInsight(stats([30, 38, 42, 20], [55, 58, 61, 60])),
    /average the 33rd percentile\. Net play is below the roster midpoint; use Normal strikes to hold the baseline/,
  );
  assert.match(
    buildNetPlayInsight([{ attribute: 'Net Presence', value: 65 }], 'Move forward to finish a short ball, not as the default pattern.'),
    /Move forward to finish a short ball, not as the default pattern/,
  );
  assert.match(
    copyTypes,
    /export function buildNetPlayInsight\(stats: unknown, fallbackText\?: unknown\): string;/,
  );
  assert.ok(component.includes('buildNetPlayInsight(profile.stats, mechanics.net)'));
});

test('serve advice uses service percentiles and the character’s stronger first groundstroke', () => {
  const profile = {
    stats: [
      { attribute: 'Service Power', value: 82, percentile: 0.8 },
      { attribute: 'Service Consistency', value: 81, percentile: 0.55 },
      { attribute: 'Service Precision', value: 94, percentile: 0.88 },
    ],
    combined_ratings: [
      { attribute: 'Serve Rating', value: 85, max_serve_speed_kmh: 200 },
      { attribute: 'Forehand Rating', value: 89.4 },
      { attribute: 'Backhand Rating', value: 81.6 },
    ],
  };
  assert.equal(
    buildServeInsight(profile, 'Generic Core serve advice.'),
    'Average maximal serve speed is 200.0 km/h. Service Power 82 (80th percentile), Consistency 81 (55th percentile), and Precision 94 (88th percentile). Power is the stronger roster-relative asset despite the close raw ratings; use first-serve pace selectively and protect the second serve. Placement is a top-quartile strength; use it to vary body and corner targets. Use a Normal strike to keep a neutral return deep. When the serve draws a short, balanced ball, attack with an Acceleration for depth or a Short Acceleration into the open short court, using the forehand (89.4 vs 81.6).',
  );

  const saferProfile = {
    stats: [
      { attribute: 'Service Power', value: 70, percentile: 0.35 },
      { attribute: 'Service Consistency', value: 70, percentile: 0.65 },
      { attribute: 'Service Precision', value: 60, percentile: 0.35 },
    ],
    combined_ratings: [
      { attribute: 'Serve Rating', max_serve_speed_kmh: 192 },
      { attribute: 'Forehand Rating', value: 82.1 },
      { attribute: 'Backhand Rating', value: 86.4 },
    ],
  };
  const saferAdvice = buildServeInsight(saferProfile);
  assert.match(saferAdvice, /Consistency is the stronger roster-relative asset/);
  assert.match(saferAdvice, /Placement is below the roster midpoint/);
  assert.match(saferAdvice, /using the backhand \(86\.4 vs 82\.1\)/);
  assert.match(
    copyTypes,
    /export function buildServeInsight\(profile: unknown, fallbackText\?: unknown\): string;/,
  );
  assert.ok(component.includes('buildServeInsight(profile, mechanics.serve)'));
});

test('groundstroke advice ties selectable shots to consistency, stamina, and the stronger wing', () => {
  const profile = {
    stats: [
      { attribute: 'Forehand Consistency', value: 84, percentile: 0.82 },
      { attribute: 'Backhand Consistency', value: 82, percentile: 0.80 },
      { attribute: 'Stamina', value: 42, percentile: 0.35 },
    ],
    combined_ratings: [
      { attribute: 'Forehand Rating', value: 89.4 },
      { attribute: 'Backhand Rating', value: 81.6 },
    ],
  };
  const advice = buildGroundstrokeInsight(profile, 'The forehand rates higher (89.4 vs 81.6).');

  assert.match(advice, /Forehand and backhand Consistency average 83 \(81st percentile\)/);
  assert.match(advice, /Use a Normal strike for depth on neutral or difficult contact/);
  assert.match(advice, /supports using a Short Strike after pushing the opponent deep/);
  assert.match(advice, /The forehand rates higher \(89\.4 vs 81\.6\)/);
  assert.match(advice, /save Acceleration and Short Acceleration for clear, balanced short balls/);

  const higherStaminaAdvice = buildGroundstrokeInsight({
    ...profile,
    stats: profile.stats.map((stat) =>
      stat.attribute === 'Stamina' ? { ...stat, percentile: 0.75 } : stat,
    ),
  });
  assert.match(
    higherStaminaAdvice,
    /use an Acceleration for a deeper attack or a Short Acceleration toward the open short court through the forehand/,
  );

  const roundedTie = buildGroundstrokeInsight({
    combined_ratings: [
      { attribute: 'Forehand Rating', value: 91.64 },
      { attribute: 'Backhand Rating', value: 91.56 },
    ],
  });
  assert.match(roundedTie, /Forehand and backhand are evenly rated \(91\.6 each\)/);
  assert.doesNotMatch(roundedTie, /The (?:forehand|backhand) rates higher/);
  assert.match(copyTypes, /export function buildGroundstrokeInsight\(profile: unknown, fallbackText\?: unknown\): string;/);
  assert.ok(component.includes('buildGroundstrokeInsight(profile, mechanics.groundstrokes)'));
});

test('size-and-reach copy explains height, backhand fit, and weight in plain language', () => {
  const insight = cleanSizeReachInsight(
    "At 193 cm (82nd percentile in the ATP roster), That gives a small directional advantage against shoulder-high heavy-spin contact. The more useful cue is this two-handed backhand's 82/100 directional fit; that supports favor taking a balanced shoulder-height ball early. At 85 kg (74th percentile in the ATP roster), body mass is distinctive but has no separate documented pace or movement effect; Speed and Muscle Tone are the relevant court-coverage ratings.",
  );

  assert.match(insight, /At 193 cm \(82nd percentile in the ATP roster\), shoulder-high, heavy-spin balls are a little easier to handle/i);
  assert.match(insight, /This character's backhand scores 82\/100 for shoulder-height contact/i);
  assert.match(insight, /Normal strike/i);
  assert.match(insight, /rather than forcing Acceleration/i);
  assert.doesNotMatch(insight, /(?:one|two)-handed backhand scores/i);
  assert.match(insight, /Take balanced shoulder-height contact early to attack/i);
  assert.match(insight, /At 85 kg, this character is heavier than about 74% of the ATP roster/i);
  assert.match(insight, /Weight alone doesn't tell us how quickly they move/i);
  assert.match(insight, /Speed and Muscle Tone are better guides to court coverage/i);
  assert.doesNotMatch(insight, /supports favor taking/i);
});

test('weight copy explains the roster comparison without treating weight as speed', () => {
  const profileWeightInsight = (weight, percentile) => cleanSizeReachInsight(
    `At ${weight} kg (${percentile}), body mass is distinctive but has no separate documented pace or movement effect; Speed and Muscle Tone are the relevant court-coverage ratings.`,
  );

  assert.equal(
    profileWeightInsight(90, '90th percentile in the ATP roster'),
    "At 90 kg, this character is heavier than about 90% of the ATP roster. Weight alone doesn't tell us how quickly they move; Speed and Muscle Tone are better guides to court coverage.",
  );
  assert.equal(
    profileWeightInsight(54, '12th percentile in the WTA roster'),
    "At 54 kg, this character is lighter than about 88% of the WTA roster. Weight alone doesn't tell us how quickly they move; Speed and Muscle Tone are better guides to court coverage.",
  );
  assert.equal(
    profileWeightInsight(75, '50th percentile in the ATP roster'),
    "At 75 kg, this character is around the middle of the ATP roster by weight. Weight alone doesn't tell us how quickly they move; Speed and Muscle Tone are better guides to court coverage.",
  );
});

test('size-and-reach copy keeps neutral-height and lower-fit advice clear', () => {
  const insight = cleanSizeReachInsight(
    "At 185 cm (48th percentile in the ATP roster), Height itself is neutral in the model's high-ball estimate. The more useful cue is this one-handed backhand's 61/100 directional fit; that supports favor a normal rally ball to regain balance before attacking.",
  );
  const heightChallenge = cleanSizeReachInsight(
    "At 172 cm (12th percentile in the WTA roster), That adds a small directional challenge against shoulder-high heavy-spin contact. The more useful cue is this two-handed backhand's 63/100 directional fit; that supports favor a normal rally ball to regain balance before attacking.",
  );

  assert.match(insight, /height has little effect on the high-ball estimate/i);
  assert.match(insight, /This character's backhand scores 61\/100 for shoulder-height contact/i);
  assert.doesNotMatch(insight, /(?:one|two)-handed backhand scores/i);
  assert.match(insight, /Play a steady rally ball first with a Normal strike, then attack once you're set/i);
  assert.match(insight, /avoid Acceleration from a rushed or head-height contact/i);
  assert.doesNotMatch(insight, /directional fit; that supports favor/i);
  assert.match(
    heightChallenge,
    /At 172 cm \(12th percentile in the WTA roster\), shoulder-high, heavy-spin balls are a little harder to handle/i,
  );
  assert.match(heightChallenge, /This character's backhand scores 63\/100 for shoulder-height contact/i);
  assert.doesNotMatch(heightChallenge, /(?:one|two)-handed backhand scores/i);
});

test('game plans read as short action steps instead of stat-labeled fragments', () => {
  const steps = buildGamePlanSteps(
    'Focus: Prepare early and choose direction before the ball reaches you. Forehand Consistency: Use deep forehand cross-court shape, then change direction when the reply sits short. Muscle Tone: Use normal or Top Spin rally strikes while recovering through the middle; choose an acceleration only when balanced and the reply is short.',
    'None',
  );

  assert.deepEqual(steps, [
    'Prepare early and pick a target before contact.',
    'Keep the forehand deep and cross-court; change direction when a short ball gives you time.',
    'Recover through the middle after each shot. Use Top Spin when you need extra clearance; rely on timing and positioning rather than a special acceleration.',
  ]);
  assert.deepEqual(
    buildGamePlanSteps(
      'Muscle Tone: Use normal or Top Spin rally strikes while recovering through the middle; choose an acceleration only when balanced and the reply is short.',
      'Sprint',
    ),
    ["Recover through the middle after each shot. Use Top Spin when you need extra clearance; save acceleration for a short ball once you're set."],
  );
  assert.ok(steps.every((step) => !/^(Focus|Forehand Consistency|Muscle Tone):/.test(step)));
  assert.equal(normalizeCharacterCopy('Use the build to earn a short reply.'), 'Use this character to earn a short reply.');
  assert.equal(
    buildCharacterProfileSummary('Player One', [], [], {
      why_select: 'Use the build to earn a short reply.',
    }),
    'Player One does not have enough rating data for a character-specific summary yet.',
  );
});

test('technical summary uses character-specific size and stroke insights from Core', () => {
  for (const marker of [
    'Average maximal serve speed (not absolute peak)',
    'mechanics.size_reach',
    'mechanics.stroke_setup',
    'buildGroundstrokeInsight(profile, mechanics.groundstrokes)',
    'buildSizeMechanicsInsight(profile.height, profile.weight)',
    'buildStrokeMechanicsInsight(profile)',
    "['Size & reach', sizeInsight]",
    "['Stroke setup', strokeInsight]",
  ]) {
    assert.ok(component.includes(marker), `TE4 profile mechanic missing: ${marker}`);
  }
  assert.ok(!component.includes('technicalInteractions'));
  assert.ok(!component.includes('profile.technical_interactions'));
  assert.match(buildSizeMechanicsInsight(193, 88), /Height 193 cm · weight 88 kg/);
  assert.doesNotMatch(
    buildSizeMechanicsInsight(193, 88),
    /smaller characters|shorter wingspan|not handicapped/,
  );
});

test('stroke setup fallback uses the character ratings rather than a shared bonus sentence', () => {
  const profile = {
    forehand_type: 'one-handed',
    backhand_type: 'two-handed',
    stats: [{ attribute: 'Counter', value: 52 }],
    combined_ratings: [
      { attribute: 'Forehand Rating', value: 75.2 },
      { attribute: 'Backhand Rating', value: 82.6 },
    ],
    mechanics_insights: {
      signals: {
        counter: 52,
        effective_counter: 67,
        backhand_rating: 82.6,
        forehand_rating: 75.2,
        backhand_high_bounce_fit: 70,
      },
    },
  };
  const insight = buildStrokeMechanicsInsight(profile);

  assert.match(insight, /backhand two-handed/);
  assert.match(insight, /\+15 Counter \(52 to 67\)/);
  assert.match(insight, /Backhand Rating 82.6/);
  assert.match(insight, /stronger groundstroke \(82.6 vs 75.2\)/);
  assert.match(insight, /support taking heavy topspin early once you're set/i);
  assert.match(insight, /Normal strike if the ball climbs to head height/i);
  assert.match(insight, /Acceleration or Short Acceleration/i);

  const roundedTie = buildStrokeMechanicsInsight({
    forehand_type: 'one-handed',
    backhand_type: 'two-handed',
    mechanics_insights: {
      signals: { counter: 52, effective_counter: 67, backhand_rating: 91.56, forehand_rating: 91.64 },
    },
  });
  assert.match(roundedTie, /Forehand and backhand are evenly rated \(91\.6 each\)/);
  assert.doesNotMatch(roundedTie, /stronger groundstroke/);

  const coreTie = cleanStrokeMechanicsInsight(
    'The forehand is the stronger groundstroke (91.6 vs 91.6); use it to attack a shorter reply.',
  );
  assert.equal(
    coreTie,
    'Forehand and backhand are evenly rated (91.6 each); neither has a rating edge. Choose the better-positioned wing to attack a shorter reply.',
  );
  assert.match(
    copyTypes,
    /export function cleanStrokeMechanicsInsight\(value: unknown\): string;/,
  );
  assert.ok(component.includes('cleanStrokeMechanicsInsight('));
  assert.equal(
    cleanStrokeMechanicsInsight(
      'The backhand is the stronger groundstroke (92.1 vs 91.6); use it to attack a shorter reply.',
    ),
    'The backhand is the stronger groundstroke (92.1 vs 91.6); use it to attack a shorter reply.',
  );

  const lowerBounceFitInsight = buildStrokeMechanicsInsight({
    ...profile,
    mechanics_insights: {
      signals: { ...profile.mechanics_insights.signals, backhand_high_bounce_fit: 52 },
    },
  });
  assert.match(
    lowerBounceFitInsight,
    /favor a Normal rally strike first, then use the Top Spin strike for added clearance once you're set/i,
  );
});

test('Counterplay copy describes Counter as a rating, not a shot', () => {
  const copyTypes = readFileSync(
    new URL('../lib/characterProfileCopy.d.mts', import.meta.url),
    'utf8',
  );
  assert.match(copyTypes, /export function cleanCounterInsight\(value: unknown\): string;/);

  const cases = [
    ['Forehand', '75.2 vs 82.6'],
    ['Backhand', '82.6 vs 75.2'],
  ];

  for (const [strongerWing, ratingComparison] of cases) {
    const insight = cleanCounterInsight(
      `Counter 52 (49th percentile in the ATP roster) gives an effective value of 67/100 after stroke setup. Use Counter when the incoming ball already has pace; this profile's ${strongerWing} is the better redirecting option (${ratingComparison}). Against a slower reply, build pace with a prepared first strike.`,
    );

    assert.match(
      insight,
      new RegExp(
        `The Counter rating helps this character redirect incoming pace with its stronger ${strongerWing} \\(${ratingComparison.replaceAll('.', '\\.')}\\)`,
      ),
    );
    assert.match(insight, /Against a slower reply, build pace with a prepared first strike/);
    assert.match(insight, /Use a Normal strike when stretched/);
    assert.match(insight, /save Acceleration or Short Acceleration for a short reply reached in balance/);
    assert.doesNotMatch(insight, /Use Counter when/i);
  }
});

test('character portrait image fills its frame', () => {
  const rule = styles.match(/\.character-portrait img\s*\{([^}]+)\}/);
  assert.ok(rule, 'character portrait image styles are present');
  assert.match(rule[1], /object-fit:\s*cover/);
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

test('profile summaries use roster data rather than selection advice', () => {
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
    selection_guidance: {
      why_select: 'Player One suits building through the forehand, then attacking a short reply.',
      why_not_select: 'Backhand Consistency is a matchup risk if repeatedly targeted.',
    },
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
    selection_guidance: {
      why_select: 'Player Two suits using the serve to start the point and the backhand to redirect pace.',
      why_not_select: 'Movement is the relative pressure point in extended exchanges.',
    },
  };
  const firstSummary = buildCharacterProfileSummary(
    firstProfile.character,
    firstProfile.stats,
    [],
    firstProfile.selection_guidance,
  );
  const secondSummary = buildCharacterProfileSummary(
    secondProfile.character,
    secondProfile.stats,
    [],
    secondProfile.selection_guidance,
  );

  assert.notEqual(firstSummary, secondSummary);
  assert.match(firstSummary, /clearest roster edge is Forehand Power/i);
  assert.match(secondSummary, /clearest roster edge is Service Power/i);
  assert.doesNotMatch(firstSummary, /Player One suits building through the forehand/i);
  assert.doesNotMatch(secondSummary, /Player Two suits using the serve/i);
  assert.doesNotMatch(firstSummary, /rank #|\/100/);
  assert.ok(!firstSummary.includes(sharedDescription));
});

test('repeated Core summary templates are individualized from each character’s strengths', () => {
  const sharedTemplate = (character) =>
    `${character} (All-Rounder) suits using touch and controlled net finishes. Use the build to earn a short reply, then use touch or a controlled volley to finish.`;
  const first = buildCharacterProfileSummary('Player One', [], [], {
    why_select: sharedTemplate('Player One'),
    top_edges: [
      { attribute: 'Service Precision', value: 96 },
      { attribute: 'Service Consistency', value: 92 },
      { attribute: 'Forehand Volley', value: 81 },
    ],
  });
  const second = buildCharacterProfileSummary('Player Two', [], [], {
    why_select: sharedTemplate('Player Two'),
    top_edges: [
      { attribute: 'Counter', value: 91 },
      { attribute: 'Speed', value: 88 },
      { attribute: 'Stamina', value: 84 },
    ],
  });

  assert.notEqual(
    first.replace('Player One', 'PLAYER').toLowerCase(),
    second.replace('Player Two', 'PLAYER').toLowerCase(),
  );
  assert.match(first, /serve placement, serve reliability, and forehand volleys/i);
  assert.match(first, /draw a short reply.*finish with touch or a volley/i);
  assert.match(second, /counterpunching, court coverage, and stamina/i);
  assert.match(second, /recover through the middle.*incoming pace/i);
  assert.doesNotMatch(`${first} ${second}`, /Use the build|rank #|\/100/i);
});

test('profile summary prefers objective roster ratings over selection guidance', () => {
  const summary = buildCharacterProfileSummary('Player One', [], [
    { attribute: 'Serve Rating', value: 81.4, rank: 12, count: 102, percentile: 0.89 },
    { attribute: 'Forehand Rating', value: 84.2, rank: 6, count: 102, percentile: 0.94 },
    { attribute: 'Backhand Rating', value: 77.9, rank: 31, count: 102, percentile: 0.70 },
  ], {
    why_select: 'Player One suits using the forehand to create openings and finish short replies.',
    why_not_select: 'The serve estimate is lower relative to the roster, so use it to set up the next shot.',
  });
  const fallbackSummary = buildCharacterProfileSummary('Player One', [], [
    { attribute: 'Serve Rating', value: 81.4, rank: 12, count: 102, percentile: 0.89 },
    { attribute: 'Forehand Rating', value: 84.2, rank: 6, count: 102, percentile: 0.94 },
    { attribute: 'Backhand Rating', value: 77.9, rank: 31, count: 102, percentile: 0.70 },
  ]);
  const oddAttributeSummary = buildCharacterProfileSummary('Player Two', [
    { attribute: 'Clay Mover', value: 89, rank: 4, count: 102, percentile: 0.96 },
    { attribute: 'Flat Backhand', value: 84, rank: 12, count: 102, percentile: 0.89 },
  ]);

  assert.match(summary, /strongest WTSL-combined roster skill is Forehand Rating/i);
  assert.doesNotMatch(summary, /using the forehand to create openings and finish short replies/i);
  assert.doesNotMatch(summary, /serve estimate is lower relative to the roster/i);
  assert.doesNotMatch(summary, /rank #|Forehand Rating 84\.2/);
  assert.match(fallbackSummary, /strongest WTSL-combined roster skill is Forehand Rating/i);
  assert.doesNotMatch(fallbackSummary, /rank #|\/100/);
  assert.match(oddAttributeSummary, /clearest roster edge is Clay Mover/i);
  assert.doesNotMatch(oddAttributeSummary, /rank #|\/100|flat backhand.*playstyle/i);
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
        size_reach: 'Height has a directional effect for this build.',
        exchange_fit: {
          short: 'WTSL quick-point fit is around the roster midpoint.',
          medium: 'WTSL neutral-rally fit is above the midpoint.',
          extended: 'WTSL sustained-play fit is among the roster leaders.',
        },
        match_play: '12.1 winners and 5.1 unforced errors per 100 points.',
        signals: { average_rally_length: 10.7 },
      },
      selection_guidance: {
        why_select: 'Use touch and controlled net finishes.',
        point_patterns: ['Estimated winners: 12.1 per 100 points.'],
      },
      combined_ratings: [{
        attribute: 'Forehand Rating',
        value: 72,
        rank: 4,
        count: 102,
        percentile: 0.97,
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
        size_reach: 'Height has a directional effect for this build.',
        exchange_fit: {
          short: 'WTSL quick-point fit is around the roster midpoint.',
          medium: 'WTSL neutral-rally fit is above the midpoint.',
          extended: 'WTSL sustained-play fit is among the roster leaders.',
        },
      },
      selection_guidance: {
        why_select: 'Use touch and controlled net finishes.',
      },
      combined_ratings: [{
        attribute: 'Forehand Rating',
        value: 72,
        rank: 4,
        count: 102,
        percentile: 0.97,
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
  assert.ok(!component.includes('Point-event statistics'));
  assert.ok(!component.includes('not estimated without point-level match data'));
  assert.ok(component.includes('Each category is the average percentile of its rankable attributes'));
  assert.ok(component.includes('Fit on fast and slow courts'));
  assert.ok(component.includes('Shot variety'));
  assert.ok(!component.includes('the model is still under construction'));
  assert.ok(!component.includes("['Match play', mechanics.match_play]"));
});

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
  buildCounterInsight,
  buildShotVarietyInsight,
  cleanCharacterGuidance,
  cleanCharacterMechanic,
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
    'const selectionRationale = cleanCharacterGuidance(',
    'const tradeoffCopy = cleanCharacterGuidance(',
    '.map(cleanCharacterGuidance)',
    '<h3>Why pick this character?</h3>',
    'profile.mechanics_insights',
    'buildCounterInsight(profile)',
    'buildNetPlayInsight(profile.stats)',
    'buildShotVarietyInsight(profile)',
    'className="panel character-guidance-panel"',
    'Style &amp; traits',
    'On-court notes',
    'Trade-off:',
    'Across rally lengths',
    'mechanics.exchange_fit',
    'How this character tends to hold up in shorter and longer exchanges.',
    'Each rating combines Power, Consistency, and Precision.',
    'Combined ${item.attribute}',
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

test('unverified shot-choice advice is omitted from profile guidance', () => {
  assert.equal(
    cleanCharacterGuidance(
      'Player One suits building through the forehand, then attacking a short reply. Movement is a relative pressure point in extended exchanges.',
    ),
    'Movement is a relative pressure point in extended exchanges.',
  );
  assert.equal(
    cleanCharacterGuidance(
      'Backhand Consistency is a matchup risk if repeatedly targeted. This character has a distinctive movement profile.',
    ),
    'This character has a distinctive movement profile.',
  );
  assert.equal(
    cleanCharacterGuidance(
      'The manual says Counter adds speed to Normal strikes. Use Counter to attack fast balls.',
    ),
    'Counter adds speed to Normal strikes.',
  );
  assert.equal(
    cleanCharacterGuidance(
      'WTSL quick-point fit is around the roster midpoint. WTSL neutral-rally fit is above the midpoint. WTSL sustained-play fit is among the roster leaders.',
    ),
    'Around the roster midpoint. Above the roster midpoint. Among the roster leaders.',
  );
  assert.equal(
    cleanCharacterGuidance('Use touch or a controlled volley to finish.'),
    '',
  );
  assert.ok(component.includes('Array.isArray(selectedMechanics) ? selectedMechanics : []'));
  assert.ok(component.includes('Array.isArray(otherMechanics) ? otherMechanics : []'));
  assert.ok(component.includes('cleanCharacterGuidance(exchangeFit[key])'));
  assert.ok(component.includes('Average maximal serve speed:'));
  assert.ok(component.includes("formatValue(stat.max_serve_speed_kmh, ' km/h')"));
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
    'Topspin 68% adds spin and suits slow courts, but can cost pace on fast courts.',
  );
  assert.equal(
    buildCourtSpeedInsight([{ attribute: 'Topspin', value: 50 }]),
    'Topspin 50% is neutral for court fit.',
  );
  assert.equal(
    buildCourtSpeedInsight([{ attribute: 'Topspin', value: 23 }]),
    'Topspin 23% is below neutral, so slow courts can be tougher; it is not an automatic fast-court bonus.',
  );
  assert.equal(buildCourtSpeedInsight([], 'Choose a Top Spin stroke when needed.'), '');
});

test('shot variety copy keeps the focus on useful profile-specific options', () => {
  const closeRatings = buildShotVarietyInsight({
    stats: [
      { attribute: 'Lob', value: 82, percentile: 0.64 },
      { attribute: 'Drop Shot', value: 81, percentile: 0.61 },
      { attribute: 'Slice Mastery', value: 48, percentile: 0.52 },
      { attribute: 'Topspin', value: 49, percentile: 0.45 },
    ],
  });
  assert.equal(
    closeRatings,
    'Drop Shot 81 · Slice Mastery 48.',
  );
  assert.doesNotMatch(closeRatings, /Lob 82|banana shot|favor the lob|higher than Drop Shot/);

  const standoutRatings = buildShotVarietyInsight({
    stats: [
      { attribute: 'Lob', value: 94, percentile: 0.95 },
      { attribute: 'Drop Shot', value: 90, percentile: 0.85 },
      { attribute: 'Slice Mastery', value: 86, percentile: 0.80 },
      { attribute: 'Topspin', value: 82, percentile: 0.90 },
    ],
  });
  assert.match(standoutRatings, /A strong Drop Shot can bring an opponent forward after they have been pushed deep/);
  assert.match(standoutRatings, /High Slice Mastery makes the short slice a useful change of pace/);
  assert.match(standoutRatings, /squash-style slice may help in defense/);
  assert.match(standoutRatings, /save the Lob itself for an opponent at the net/);
  assert.match(standoutRatings, /High Topspin may suit a banana-shot variation when you want extra spin/);
  assert.doesNotMatch(standoutRatings, /WTSL profile cues|manual (?:says|confirms|describes)|roster percentile/);
  assert.doesNotMatch(standoutRatings, /Lob 94 is higher than Drop Shot 90/);

  const sliceWithoutStandoutLob = buildShotVarietyInsight({
    stats: [
      { attribute: 'Lob', value: 82, percentile: 0.64 },
      { attribute: 'Slice Mastery', value: 88, percentile: 0.86 },
    ],
  });
  assert.match(sliceWithoutStandoutLob, /High Slice Mastery makes the short slice a useful change of pace/);
  assert.doesNotMatch(sliceWithoutStandoutLob, /Lob 82|defensive slice\/squash/);

  const lobWithoutSliceMastery = buildShotVarietyInsight({
    stats: [
      { attribute: 'Lob', value: 91, percentile: 0.93 },
      { attribute: 'Slice Mastery', value: 47, percentile: 0.42 },
    ],
  });
  assert.match(lobWithoutSliceMastery, /Save a strong Lob for an opponent at the net/);
  assert.doesNotMatch(lobWithoutSliceMastery, /defensive slice\/squash/);
  assert.ok(component.includes('buildShotVarietyInsight(profile)'));
});

test('net-play advice reports character values and the manual’s documented Net Presence effects', () => {
  const stats = [
    ['Net Presence', 83, 0.9],
    ['Forehand Volley', 92, 0.8],
    ['Backhand Volley', 78, 0.6],
    ['Smash', 89, 0.9],
  ].map(([attribute, value, percentile], index) => ({
    attribute,
    value,
    percentile,
    rank: index + 1,
  }));
  assert.equal(
    buildNetPlayInsight(stats),
    'Net Presence 83, Forehand Volley 92, Backhand Volley 78, Smash 89. Net Presence helps with control and movement at the net, not power.',
  );
  const partial = buildNetPlayInsight(
    [{ attribute: 'Net Presence', value: 65 }],
    'Move forward to finish a short ball, not as the default pattern.',
  );
  assert.match(partial, /Net Presence 65/);
  assert.doesNotMatch(partial, /Move forward/);
  assert.ok(component.includes('buildNetPlayInsight(profile.stats)'));
});

test('net-play advice never turns roster percentile into an unsupported approach plan', () => {
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
    'Net Presence 83, Forehand Volley 92, Backhand Volley 78, Smash 89. Net Presence helps with control and movement at the net, not power.',
  );
  assert.match(
    buildNetPlayInsight(stats([60, 55, 60, 45], [65, 68, 66, 67])),
    /Net Presence helps with control and movement at the net, not power/,
  );
  assert.match(
    buildNetPlayInsight(stats([30, 38, 42, 20], [55, 58, 61, 60])),
    /Net Presence helps with control and movement at the net, not power/,
  );
  assert.equal(
    buildNetPlayInsight([{ attribute: 'Net Presence', value: 65 }], 'Move forward to finish a short ball, not as the default pattern.'),
    'Net Presence 65. Net Presence helps with control and movement at the net, not power.',
  );
  assert.match(
    copyTypes,
    /export function buildNetPlayInsight\(stats: unknown, fallbackText\?: unknown\): string;/,
  );
  assert.ok(component.includes('buildNetPlayInsight(profile.stats)'));
});

test('serve advice gives concise, profile-specific choices', () => {
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
    'Average maximal serve speed: 200.0 km/h. Power 82, Consistency 81, Precision 94. Strong first-serve success is expected below 70%; Normal falls between Strong and Safe; Safe is 100%. Precision is the stronger serve attribute, helping with placement.',
  );
  assert.match(buildServeInsight(profile), /Strong first-serve success is expected below 70%/);
  assert.match(buildServeInsight(profile), /Normal falls between Strong and Safe/);

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
  assert.match(
    saferAdvice,
    /With even Power and Consistency, Strong first-serve success is 70%, Normal is 85%, and Safe is 100%/,
  );
  assert.match(saferAdvice, /Power leads Precision, so favor larger targets over the corners/);
  assert.doesNotMatch(saferAdvice, /Generic Core serve advice|Short Acceleration|body and corner/);

  const consistencyLedAdvice = buildServeInsight({
    stats: [
      { attribute: 'Service Power', value: 65 },
      { attribute: 'Service Consistency', value: 82 },
      { attribute: 'Service Precision', value: 74 },
    ],
  });
  assert.match(consistencyLedAdvice, /Strong first-serve success is expected above 70%/i);
  assert.match(
    copyTypes,
    /export function buildServeInsight\(profile: unknown, fallbackText\?: unknown\): string;/,
  );
  assert.ok(component.includes('buildServeInsight(profile)'));
});

test('groundstroke advice keeps character ratings and useful cues concise', () => {
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

  assert.match(advice, /Consistency average 83 \(81st percentile\)/);
  assert.match(advice, /use Normal for depth or Short as a change of pace after pushing the opponent back/);
  assert.match(advice, /Forehand 89\.4 · Backhand 81\.6/);
  assert.match(advice, /Stamina 42% supports about 2 hard accelerations per point when Tiredness is off/);
  assert.match(advice, /Time them near the bounce/);
  assert.doesNotMatch(advice, /WTSL|TE4 manual|profile estimate|aggressive lob/);

  const ordinaryConsistencyAdvice = buildGroundstrokeInsight({
    stats: [{ attribute: 'Forehand Consistency', value: 64, percentile: 0.48 }],
  });
  assert.doesNotMatch(ordinaryConsistencyAdvice, /use Normal for depth or Short/);

  const higherStaminaAdvice = buildGroundstrokeInsight({
    ...profile,
    stats: profile.stats.map((stat) =>
      stat.attribute === 'Stamina' ? { ...stat, value: 82 } : stat,
    ),
  });
  assert.match(
    higherStaminaAdvice,
    /Stamina 82% supports about 4 hard accelerations per point/,
  );

  const roundedTie = buildGroundstrokeInsight({
    combined_ratings: [
      { attribute: 'Forehand Rating', value: 91.64 },
      { attribute: 'Backhand Rating', value: 91.56 },
    ],
  });
  assert.match(roundedTie, /Forehand 91\.6 · Backhand 91\.6/);
  assert.doesNotMatch(roundedTie, /The (?:forehand|backhand) rates higher/);
  assert.match(copyTypes, /export function buildGroundstrokeInsight\(profile: unknown, fallbackText\?: unknown\): string;/);
  assert.ok(component.includes('buildGroundstrokeInsight(profile)'));
});

test('size-and-reach copy keeps the height scenario and weight note brief', () => {
  const insight = cleanSizeReachInsight(
    "At 193 cm (82nd percentile in the ATP roster), That gives a small directional advantage against shoulder-high heavy-spin contact. The more useful cue is this two-handed backhand's 82/100 directional fit; that supports favor taking a balanced shoulder-height ball early. At 85 kg (74th percentile in the ATP roster), body mass is distinctive but has no separate documented pace or movement effect; Speed and Muscle Tone are the relevant court-coverage ratings.",
  );

  assert.match(insight, /Height 193 cm \(82nd percentile in the ATP roster\)/i);
  assert.match(insight, /Slight edge against shoulder-high, heavy-spin contact only/i);
  assert.match(insight, /Backhand fit for this situation: 82\/100/i);
  assert.doesNotMatch(insight, /choose a Normal strike|Short Strike only after|balanced shoulder-height ball early/i);
  assert.match(insight, /Weight 85 kg; heavier than about 74% of the ATP roster/i);
  assert.match(insight, /Weight itself does not change movement; Speed and Muscle Tone do/i);
});

test('weight copy states the roster comparison without overexplaining mechanics', () => {
  const profileWeightInsight = (weight, percentile) => cleanSizeReachInsight(
    `At ${weight} kg (${percentile}), body mass is distinctive but has no separate documented pace or movement effect; Speed and Muscle Tone are the relevant court-coverage ratings.`,
  );

  assert.equal(
    profileWeightInsight(90, '90th percentile in the ATP roster'),
    'Weight 90 kg; heavier than about 90% of the ATP roster. Weight itself does not change movement; Speed and Muscle Tone do.',
  );
  assert.equal(
    profileWeightInsight(54, '12th percentile in the WTA roster'),
    'Weight 54 kg; lighter than about 88% of the WTA roster. Weight itself does not change movement; Speed and Muscle Tone do.',
  );
  assert.equal(
    profileWeightInsight(75, '50th percentile in the ATP roster'),
    'Weight 75 kg; around the middle of the ATP roster by weight. Weight itself does not change movement; Speed and Muscle Tone do.',
  );
});

test('size-and-reach copy keeps neutral-height and lower-fit advice clear', () => {
  const insight = cleanSizeReachInsight(
    "At 185 cm (48th percentile in the ATP roster), Height itself is neutral in the model's high-ball estimate. The more useful cue is this one-handed backhand's 61/100 directional fit; that supports favor a normal rally ball to regain balance before attacking.",
  );
  const heightChallenge = cleanSizeReachInsight(
    "At 172 cm (12th percentile in the WTA roster), That adds a small directional challenge against shoulder-high heavy-spin contact. The more useful cue is this two-handed backhand's 63/100 directional fit; that supports favor a normal rally ball to regain balance before attacking.",
  );

  assert.match(insight, /No clear height edge in the high-ball estimate/i);
  assert.match(insight, /Backhand fit for this situation: 61\/100/i);
  assert.doesNotMatch(insight, /one-handed backhand scores|Normal strike first|Short Strike/i);
  assert.match(
    heightChallenge,
    /Height 172 cm \(12th percentile in the WTA roster\). Small challenge against shoulder-high, heavy-spin contact only/i,
  );
  assert.match(heightChallenge, /Backhand fit for this situation: 63\/100/i);
  assert.doesNotMatch(heightChallenge, /two-handed backhand scores|Normal strike first|Short Strike/i);
});

test('game plans omit unverified shot-specific directives and retain generic positioning steps', () => {
  const steps = buildGamePlanSteps(
    'Focus: Prepare early and choose direction before the ball reaches you. Forehand Consistency: Use deep forehand cross-court shape, then change direction when the reply sits short. Muscle Tone: Use normal or Top Spin rally strikes while recovering through the middle; choose an acceleration only when balanced and the reply is short.',
    'None',
  );

  assert.deepEqual(steps, [
    'Prepare early and pick a target before contact.',
    'Recover through the middle after each shot.',
  ]);
  assert.deepEqual(
    buildGamePlanSteps(
      'Muscle Tone: Use normal or Top Spin rally strikes while recovering through the middle; choose an acceleration only when balanced and the reply is short.',
      'Sprint',
    ),
    ['Recover through the middle after each shot.'],
  );
  assert.ok(steps.every((step) => !/^(Focus|Forehand Consistency|Muscle Tone):/.test(step)));
  assert.ok(steps.every((step) => !/\b(?:normal|top spin|acceleration|forehand|backhand|volley|lob|drop shot)\b/i.test(step)));
  assert.equal(normalizeCharacterCopy('Use the build to earn a short reply.'), 'Use this character to earn a short reply.');
  assert.equal(
    buildCharacterProfileSummary('Player One', [], [], {
      why_select: 'Use the build to earn a short reply.',
    }),
    'Player One does not have enough rating data for a character-specific summary yet.',
  );
});

test('technical summary builds shot claims from profile data and links their TE4 source', () => {
  for (const marker of [
    'Average maximal serve speed',
    'mechanics.size_reach',
    'buildGroundstrokeInsight(profile)',
    'buildSizeMechanicsInsight(profile.height, profile.weight)',
    'buildStrokeMechanicsInsight(profile)',
    "['Size & reach', sizeInsight]",
    "['Hand use', strokeInsight]",
    "['Counterplay', buildCounterInsight(profile)]",
    "['Shot variety', buildShotVarietyInsight(profile)]",
    'https://www.managames.com/tennis/doc/Tennis_Elbow-Tennis_Game.html',
    'TE4 mechanics reference',
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

test('hand-use copy explains the stroke and avoids repeating the narrow high-bounce fit', () => {
  const profile = {
    forehand_type: 'one-handed',
    backhand_type: 'two-handed',
    stats: [{ attribute: 'Counter', value: 52 }],
    combined_ratings: [
      { attribute: 'Forehand Rating', value: 88.3 },
      { attribute: 'Backhand Rating', value: 91.9 },
    ],
    mechanics_insights: {
      signals: {
        counter: 52,
        effective_counter: 67,
        backhand_rating: 91.9,
        forehand_rating: 88.3,
        backhand_high_bounce_fit: 81,
      },
    },
  };
  const insight = buildStrokeMechanicsInsight(profile);

  assert.match(insight, /This character uses a one-handed forehand and a two-handed backhand/);
  assert.match(insight, /two-handed backhand strokes add \+15 Counter and are safer in the Danger Zone/i);
  assert.match(insight, /trade a little power and width/);
  assert.match(insight, /Groundstroke ratings: Forehand 88\.3, Backhand 91\.9/i);
  assert.doesNotMatch(insight, /shoulder-height fit|high-bounce fit|heavy-spin|take heavy topspin|choose a Normal strike|Short Acceleration|support taking heavy topspin early/i);

  const oneHandedInsight = buildStrokeMechanicsInsight({
    forehand_type: 'one-handed',
    backhand_type: 'one-handed',
  });
  assert.match(oneHandedInsight, /This character uses a one-handed forehand and a one-handed backhand/);
  assert.doesNotMatch(oneHandedInsight, /Two-handed .*strokes add \+15 Counter/);

  const roundedTie = buildStrokeMechanicsInsight({
    forehand_type: 'one-handed',
    backhand_type: 'two-handed',
    mechanics_insights: {
      signals: { counter: 52, effective_counter: 67, backhand_rating: 91.56, forehand_rating: 91.64 },
    },
  });
  assert.match(roundedTie, /Groundstroke ratings are even at 91\.6/);
  assert.doesNotMatch(roundedTie, /stronger groundstroke|attack a shorter reply/);
  assert.ok(component.includes('buildStrokeMechanicsInsight(profile)'));
});

test('Counterplay copy states the manual-backed effects without inventing a preferred wing', () => {
  const insight = buildCounterInsight({
    stats: [{ attribute: 'Counter', value: 52, percentile: 0.49 }],
    combined_ratings: [
      { attribute: 'Forehand Rating', value: 75.2 },
      { attribute: 'Backhand Rating', value: 82.6 },
    ],
  });
  assert.match(insight, /Counter 52 \(49th percentile\) helps with fast incoming balls; slower ones are harder to handle/i);
  assert.doesNotMatch(insight, /better redirecting option|Acceleration|preferred wing/i);
  assert.ok(component.includes("['Counterplay', buildCounterInsight(profile)]"));
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
  }), ['One-handed forehand', 'Two-handed backhand']);
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
  assert.match(firstSummary, /clearest strength is Forehand Power/i);
  assert.match(secondSummary, /clearest strength is Service Power/i);
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
  assert.doesNotMatch(first, /not per-shot predictions|WTSL|manual/i);
  assert.match(second, /counterpunching, court coverage, and stamina/i);
  assert.doesNotMatch(`${first} ${second}`, /Use the build|draw a short reply|finish with touch|recover through the middle|rank #|\/100/i);
  assert.doesNotMatch(`${first} ${second}`, /\b(?:use|choose|attack|finish)\b/i);
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

  assert.match(summary, /strongest combined rating is Forehand Rating/i);
  assert.doesNotMatch(summary, /using the forehand to create openings and finish short replies/i);
  assert.doesNotMatch(summary, /serve estimate is lower relative to the roster/i);
  assert.doesNotMatch(summary, /rank #|Forehand Rating 84\.2/);
  assert.match(fallbackSummary, /strongest combined rating is Forehand Rating/i);
  assert.doesNotMatch(fallbackSummary, /rank #|\/100/);
  assert.match(oddAttributeSummary, /clearest strength is Clay Mover/i);
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

test('character comparisons sanitize mechanics and selection explanations', () => {
  for (const marker of [
    'comparison.first_mechanics',
    'comparison.first_guidance',
    'className="character-comparison-choices"',
    'cleanCharacterGuidance(selectedGuidance?.why_select || selectedGuidance?.benefit)',
    'cleanCharacterGuidance(otherGuidance?.why_select || otherGuidance?.benefit)',
    'selectedMechanicLines',
    'otherMechanicLines',
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
  const mechanicsIndex = component.indexOf('<h2>On-court notes</h2>');
  const guidanceIndex = component.indexOf('character-selection-guidance');
  const ratingsIndex = component.indexOf('COMBINED SKILLS');
  const attributesIndex = component.indexOf('Attribute rankings');

  assert.ok(categoryIndex >= 0 && traitsIndex > categoryIndex);
  assert.ok(mechanicsIndex > traitsIndex && guidanceIndex > mechanicsIndex);
  assert.ok(ratingsIndex > guidanceIndex && attributesIndex > ratingsIndex);
  assert.ok(component.includes('TE4 mechanics reference'));
  assert.ok(!component.includes('character-profile-method-note'));
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

function attributeKey(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function numeric(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function displayNumber(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function capitalize(value) {
  return value ? value[0].toUpperCase() + value.slice(1) : '';
}

export function normalizeCharacterCopy(value) {
  if (typeof value !== 'string') return '';
  return value
    .trim()
    .replace(/\bUse the build\b/gi, (match) =>
      match[0] === match[0].toUpperCase() ? 'Use this character' : 'use this character',
    )
    .replace(/\bthis build(?=['’])/gi, 'this character')
    .replace(/\bThis build(?=['’])/g, 'This character')
    .replace(/\btime them near the bounce\b/gi, (match) =>
      match[0] === match[0].toUpperCase() ? 'Hit shots on the rise' : 'hit shots on the rise',
    );
}

const shotChoiceTerms =
  /\b(?:normal(?:\s+strike)?|short\s+(?:strike|reply|ball|shot|court)|top[\s-]?spin|acceleration|aggressive\s+lob|lobs?|drop\s+shots?|volleys?|slices?|serves?|forehand|backhand|groundstrokes?|counterpunching|counter|net(?:[- ]?(?:first|finish|play))?|touch|cross[- ]court|down[- ]the[- ]line|angle|corner|target\w*|direction|baseline|rally|first\s+strike)\b/i;
const tacticalActionTerms =
  /\b(?:us(?:e|es|ing|ed)|choos\w*|favor\w*|prefer\w*|attack\w*|approach\w*|aim\w*|target\w*|build\w*|creat\w*|draw\w*|finish\w*|hit\w*|play\w*|redirect\w*|sav\w*|mov(?:e|es|ed|ing)|tak\w*|try\w*|set up|look for|hold|open|vary\w*|wait\w*|keep\w*|cover\w*|protect\w*|prioriti[sz]\w*|should|could|must|can|suit\w*|help\w*|allow\w*|best|ideal|better|work\w*|specializ\w*|excel\w*|known for|concentrat\w*|stronger|weaker|strongest|weakest|strengths?|weakness\w*|risk\w*|vulnerab\w*|good at)\b/i;

function cleanProfileSourceAttribution(sentence) {
  const trimmed = sentence.trim();
  const exchangeFitNotes = new Map([
    ['wtsl quick-point fit is around the roster midpoint.', 'Around the roster midpoint.'],
    ['wtsl neutral-rally fit is above the midpoint.', 'Above the roster midpoint.'],
    ['wtsl sustained-play fit is among the roster leaders.', 'Among the roster leaders.'],
  ]);
  const exchangeFitNote = exchangeFitNotes.get(trimmed.toLowerCase());
  if (exchangeFitNote) return exchangeFitNote;

  const sourceFree = trimmed
    .replace(
      /^(?:according to\s+)?(?:the\s+)?(?:official\s+)?(?:TE4\s+)?manual(?:\s+(?:says|states|notes|describes|confirms))?\s*[:,]?\s*/i,
      '',
    )
    .replace(
      /\b(?:according to|as noted in|as described by)\s+(?:the\s+)?(?:official\s+)?(?:TE4\s+)?manual[:,]?\s*/gi,
      '',
    );
  return /\b(?:WTSL|manual)\b/i.test(sourceFree) ? '' : sourceFree;
}

export function cleanCharacterGuidance(value) {
  if (typeof value !== 'string') return '';
  return normalizeCharacterCopy(value)
    .replace(
      /It matters most when your plan depends on repeated wide-court recoveries;\s*defend through the middle,\s*recover,\s*and counter when the reply is short\.?/gi,
      'This character is most vulnerable against opponents who repeatedly pull them wide; deep, central replies can limit their angles and give more time to recover.',
    )
    .split(/(?<=[.!?])\s+/)
    .map(cleanProfileSourceAttribution)
    .filter((sentence) =>
      sentence &&
      !/\b(?:weight|body mass)\b/i.test(sentence) &&
      !(
        shotChoiceTerms.test(sentence) &&
        tacticalActionTerms.test(sentence) &&
        !/\bhit shots on the rise\b/i.test(sentence)
      ),
    )
    .join(' ')
    .trim();
}

export function cleanRallyFit(value) {
  if (typeof value !== 'string') return '';
  return normalizeCharacterCopy(value)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) =>
      sentence
        .replace(
          /^(?:according to\s+)?(?:the\s+)?(?:official\s+)?(?:TE4\s+)?manual(?:\s+(?:says|states|notes|describes|confirms))?\s*[:,]?\s*/i,
          '',
        )
        .replace(
          /\b(?:according to|as noted in|as described by)\s+(?:the\s+)?(?:official\s+)?(?:TE4\s+)?manual[:,]?\s*/gi,
          '',
        )
        .replace(/\bWTSL\b/gi, '')
        .replace(
          /^short exchanges?:\s*rates the quick-point fit as\s+/i,
          'Quick-point fit is ',
        )
        .replace(
          /^stamina is a roster-leading support for repeated movement and accelerations\.?$/i,
          'High Stamina helps this character keep covering ground through longer rallies.',
        )
        .replace(
          /^the groundstroke consistency is not an obvious roster-level weakness in a sustained exchange\.?$/i,
          "Groundstrokes should hold up in longer rallies, even if they are not a standout strength.",
        )
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((sentence) => sentence && !/\b(?:weight|body mass)\b/i.test(sentence))
    .join(' ')
    .trim();
}

export function cleanCharacterMechanic(value, character = '') {
  if (typeof value !== 'string') return '';
  let text = normalizeCharacterCopy(value)
    .replace(/\s+This character's leading roster edges are\b[\s\S]*$/i, '')
    .replace(/\s+The clearest roster-relative limits are\b[\s\S]*$/i, '')
    .trim();

  const name = String(character ?? '').trim();
  if (name) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(`^${escapedName}:\\s*`, 'i'), '');
  }

  return capitalize(cleanCharacterGuidance(text.trim()));
}

function findProfileRating(ratings, attribute) {
  const target = attributeKey(attribute);
  return Array.isArray(ratings)
    ? ratings.find((rating) => attributeKey(rating?.attribute) === target)
    : null;
}

function profileStatsAndStyle(profileOrStats, styleFallback = '') {
  if (Array.isArray(profileOrStats)) {
    return { stats: profileOrStats, style: String(styleFallback ?? '') };
  }
  if (!profileOrStats || typeof profileOrStats !== 'object') {
    return { stats: [], style: String(styleFallback ?? '') };
  }
  return {
    stats: Array.isArray(profileOrStats.stats) ? profileOrStats.stats : [],
    style: String(profileOrStats.style ?? styleFallback ?? ''),
  };
}

export function buildCounterInsight(profile) {
  const stats = profile && typeof profile === 'object' && Array.isArray(profile.stats)
    ? profile.stats
    : [];
  const counter = findProfileRating(stats, 'Counter');
  const value = numeric(counter?.value);
  if (value === null) return '';

  const percentile = rosterPercentile(counter);
  return `Counter ${displayNumber(value)}${percentile === null ? '' : ` (${ordinal(percentile)} percentile)`} helps with fast incoming balls; slower ones are harder to handle.`;
}

export function buildShotVarietyInsight(profile) {
  const stats = profile && typeof profile === 'object' && Array.isArray(profile.stats)
    ? profile.stats
    : [];
  const lobStat = findProfileRating(stats, 'Lob');
  const dropShotStat = findProfileRating(stats, 'Drop Shot');
  const sliceMasteryStat = findProfileRating(stats, 'Slice Mastery');
  const topspinStat = findProfileRating(stats, 'Topspin');
  const lob = numeric(lobStat?.value);
  const dropShot = numeric(dropShotStat?.value);
  const sliceMastery = numeric(sliceMasteryStat?.value);
  const topspin = numeric(topspinStat?.value);
  const lobPercentile = rosterPercentile(lobStat);
  const dropShotPercentile = rosterPercentile(dropShotStat);
  const sliceMasteryPercentile = rosterPercentile(sliceMasteryStat);
  const topspinPercentile = rosterPercentile(topspinStat);
  const commonCuePercentile = 75;
  const lobCuePercentile = 90;
  const lobStandout =
    lob !== null && lobPercentile !== null && lobPercentile >= lobCuePercentile;
  const dropShotStandout =
    dropShot !== null && dropShotPercentile !== null && dropShotPercentile >= commonCuePercentile;
  const sliceMasteryStandout =
    sliceMastery !== null
      && sliceMasteryPercentile !== null
      && sliceMasteryPercentile >= commonCuePercentile;
  const topspinStandout =
    topspin !== null
      && topspin > 50
      && topspinPercentile !== null
      && topspinPercentile >= commonCuePercentile;

  const values = [
    dropShot === null ? '' : `Drop Shot ${displayNumber(dropShot)}`,
    sliceMastery === null ? '' : `Slice Mastery ${displayNumber(sliceMastery)}`,
    topspinStandout ? `Topspin ${displayNumber(topspin)}%` : '',
    lobStandout ? `Lob ${displayNumber(lob)}` : '',
  ].filter(Boolean);
  if (!values.length) return '';

  const statements = [`${values.join(' · ')}.`];
  const cues = [];
  if (dropShotStandout) {
    cues.push('A strong Drop Shot can bring an opponent forward after they have been pushed deep.');
  }
  if (sliceMasteryStandout) {
    let sliceCue = 'High Slice Mastery makes the short slice a useful change of pace.';
    if (lobStandout) {
      sliceCue += ' With Lob also a strength, the squash-style slice may help in defense; save the Lob itself for an opponent at the net.';
    }
    cues.push(sliceCue);
  } else if (lobStandout) {
    cues.push('Save a strong Lob for an opponent at the net, rather than routine rallies.');
  }
  if (topspinStandout) {
    cues.push('High Topspin may suit a banana-shot variation when you want extra spin.');
  }
  if (cues.length) statements.push(cues.join(' '));
  return statements.join(' ');
}

function rosterPercentile(stat) {
  const percentile = numeric(stat?.percentile);
  if (percentile === null) return null;
  const score = percentile <= 1 ? percentile * 100 : percentile;
  return Math.round(Math.max(0, Math.min(100, score)));
}

export function buildServeInsight(profile, _fallbackText = '') {
  const stats = profile && typeof profile === 'object' && Array.isArray(profile.stats)
    ? profile.stats
    : [];
  const combinedRatings =
    profile && typeof profile === 'object' && Array.isArray(profile.combined_ratings)
      ? profile.combined_ratings
      : [];
  const power = findProfileRating(stats, 'Service Power');
  const consistency = findProfileRating(stats, 'Service Consistency');
  const precision = findProfileRating(stats, 'Service Precision');
  const powerValue = numeric(power?.value);
  const consistencyValue = numeric(consistency?.value);
  const precisionValue = numeric(precision?.value);
  if (powerValue === null || consistencyValue === null || precisionValue === null) {
    return '';
  }

  const serveRating = findProfileRating(combinedRatings, 'Serve Rating');
  const serveSpeed = numeric(serveRating?.max_serve_speed_kmh);

  let serveSuccessEstimate;
  if (powerValue > consistencyValue) {
    serveSuccessEstimate =
      'Estimated first-serve success: Strong below 70%; Normal likely below 85%.';
  } else if (powerValue < consistencyValue) {
    serveSuccessEstimate =
      'Estimated first-serve success: Strong above 70%; Normal likely above 85%.';
  } else {
    serveSuccessEstimate =
      'With even Power and Consistency, estimated first-serve success is Strong 70% and Normal 85%.';
  }

  const speedNote = serveSpeed !== null && serveSpeed > 0
    ? `Average maximal serve speed: ${serveSpeed.toFixed(1)} km/h. `
    : '';

  return `${speedNote}Power ${displayNumber(powerValue)}, Consistency ${displayNumber(consistencyValue)}, Precision ${displayNumber(precisionValue)}. ${serveSuccessEstimate}`;
}

export function buildGroundstrokeInsight(profile, _fallbackText = '') {
  const stats = profile && typeof profile === 'object' && Array.isArray(profile.stats)
    ? profile.stats
    : [];
  const combinedRatings =
    profile && typeof profile === 'object' && Array.isArray(profile.combined_ratings)
      ? profile.combined_ratings
      : [];
  const forehand = numeric(findProfileRating(combinedRatings, 'Forehand Rating')?.value);
  const backhand = numeric(findProfileRating(combinedRatings, 'Backhand Rating')?.value);
  const consistencyStats = [
    findProfileRating(stats, 'Forehand Consistency'),
    findProfileRating(stats, 'Backhand Consistency'),
  ].filter((stat) => numeric(stat?.value) !== null);
  const consistencyValues = consistencyStats.map((stat) => numeric(stat.value));
  const averageConsistency = consistencyValues.length
    ? consistencyValues.reduce((sum, value) => sum + value, 0) / consistencyValues.length
    : null;
  const statements = [];

  if (averageConsistency !== null) {
    const percentileValues = consistencyStats
      .map(rosterPercentile)
      .filter((percentile) => percentile !== null);
    const averagePercentile = percentileValues.length
      ? Math.round(percentileValues.reduce((sum, value) => sum + value, 0) / percentileValues.length)
      : null;
    const consistencyLabel = consistencyStats.length > 1
      ? `Forehand and Backhand Consistency average ${displayNumber(averageConsistency)}`
      : `${consistencyStats[0].attribute} ${displayNumber(averageConsistency)}`;
    const consistencyCue = averagePercentile !== null && averagePercentile >= 70
      ? ' It supports steadier difficult shots; use the Normal strike for depth or the Short strike as a change of pace after pushing the opponent back.'
      : averagePercentile !== null && averagePercentile <= 30
        ? ' It is a relative weakness for difficult shots compared with the tour roster.'
        : averagePercentile !== null
          ? ' It is near the tour midpoint and affects how steadily difficult shots can be played.'
          : ' It affects how steadily difficult shots can be played.';
    statements.push(
      `${consistencyLabel}${averagePercentile === null ? '' : ` (${ordinal(averagePercentile)} percentile)`}.${consistencyCue}`,
    );
  }

  if (forehand !== null && backhand !== null) {
    statements.push(`Forehand ${displayNumber(forehand)} · Backhand ${displayNumber(backhand)}.`);
  }

  return statements.join(' ');
}

export function buildPhysicalInsight(profile) {
  const stats = profile && typeof profile === 'object' && Array.isArray(profile.stats)
    ? profile.stats
    : [];
  const speedStat = findProfileRating(stats, 'Speed');
  const muscleToneStat = findProfileRating(stats, 'Muscle Tone');
  const staminaStat = findProfileRating(stats, 'Stamina');
  const speed = numeric(speedStat?.value);
  const muscleTone = numeric(muscleToneStat?.value);
  const stamina = numeric(staminaStat?.value);
  if (speed === null && muscleTone === null && stamina === null) return '';

  const speedPercentile = rosterPercentile(speedStat);
  const muscleTonePercentile = rosterPercentile(muscleToneStat);
  const staminaPercentile = rosterPercentile(staminaStat);
  const accelerationRating = speed !== null && muscleTone !== null
    ? (speed + muscleTone) / 2
    : null;
  const speedLow = speedPercentile !== null && speedPercentile <= 30;
  const speedHigh = speedPercentile !== null && speedPercentile >= 70;
  const muscleToneLow = muscleTonePercentile !== null && muscleTonePercentile <= 30;
  const muscleToneHigh = muscleTonePercentile !== null && muscleTonePercentile >= 70;
  const movementLimited = speedLow || muscleToneLow;

  let movementInsight = '';
  if (speedPercentile !== null && muscleTonePercentile !== null) {
    if (speedLow && muscleToneLow) {
      movementInsight = 'Both Speed and Muscle Tone are near the bottom of the roster, making wide-ball coverage and recovery difficult.';
    } else if (speedHigh && muscleToneHigh) {
      movementInsight = 'Strong Speed and Muscle Tone make court coverage and recovery a strength.';
    } else if (speedLow && muscleToneHigh) {
      movementInsight = 'Higher Muscle Tone supports acceleration, but low top Speed makes long chases harder.';
    } else if (speedHigh && muscleToneLow) {
      movementInsight = 'Strong top Speed helps cover ground, but lower Muscle Tone can slow the first step and recovery after a change of direction.';
    } else if (speedLow) {
      movementInsight = 'Low top Speed makes long chases harder.';
    } else if (muscleToneLow) {
      movementInsight = 'Lower Muscle Tone can slow acceleration and recovery.';
    } else if (speedHigh) {
      movementInsight = 'Strong top Speed helps cover wide balls.';
    } else if (muscleToneHigh) {
      movementInsight = 'Higher Muscle Tone supports quicker acceleration.';
    } else {
      movementInsight = 'Speed and Muscle Tone are around the roster midpoint, so court position and early recovery matter more than a pace advantage.';
    }
  } else if (speedPercentile !== null) {
    movementInsight = speedLow
      ? 'Low top Speed makes long chases harder.'
      : speedHigh
        ? 'Strong top Speed helps cover wide balls.'
        : 'Top Speed is around the roster midpoint; recover early to keep the next run short.';
  } else if (muscleTonePercentile !== null) {
    movementInsight = muscleToneLow
      ? 'Lower Muscle Tone can slow acceleration and recovery.'
      : muscleToneHigh
        ? 'Higher Muscle Tone supports quicker acceleration.'
        : 'Acceleration is around the roster midpoint; recover early to keep the next run short.';
  } else if (speed !== null || muscleTone !== null) {
    movementInsight = 'Speed and Muscle Tone shape court coverage; recover toward the middle after each shot to shorten the next run.';
  }

  let staminaInsight = '';
  if (stamina !== null) {
    if (staminaPercentile !== null && staminaPercentile >= 70) {
      staminaInsight = movementLimited
        ? 'High Stamina helps sustain repeated runs but cannot make the first step quicker; position early to limit long chases.'
        : 'High Stamina helps sustain repeated runs through longer exchanges.';
    } else if (staminaPercentile !== null && staminaPercentile <= 30) {
      staminaInsight = 'Low Stamina makes repeated running more draining; recover efficiently to preserve energy in longer rallies.';
    } else if (accelerationRating !== null && stamina > accelerationRating) {
      staminaInsight = 'Stamina helps sustain repeated runs through longer exchanges.';
    } else if (accelerationRating !== null && stamina < accelerationRating) {
      staminaInsight = 'Stamina trails the movement ratings, so repeated running can cost more energy.';
    } else {
      staminaInsight = 'Stamina is near the roster midpoint; efficient recovery helps preserve energy in longer exchanges.';
    }
  }

  return [movementInsight, staminaInsight].filter(Boolean).join(' ');
}

function ordinal(value) {
  const number = Math.round(value);
  const lastTwoDigits = number % 100;
  if (lastTwoDigits >= 11 && lastTwoDigits <= 13) return `${number}th`;
  if (number % 10 === 1) return `${number}st`;
  if (number % 10 === 2) return `${number}nd`;
  if (number % 10 === 3) return `${number}rd`;
  return `${number}th`;
}

export function buildNetPlayInsight(profileOrStats) {
  const { stats, style } = profileStatsAndStyle(profileOrStats);
  const attributes = ['Net Presence', 'Forehand Volley', 'Backhand Volley', 'Smash'];
  const entries = attributes.map((attribute) => {
    const stat = findProfileRating(stats, attribute);
    const value = numeric(stat?.value);
    return value === null ? null : { attribute, stat, value };
  });
  if (entries.every((entry) => entry === null)) return '';

  const ratingText = entries
    .filter(Boolean)
    .map(({ attribute, value }) => `${attribute} ${displayNumber(value)}`)
    .join(', ');
  const percentiles = entries
    .filter(Boolean)
    .map(({ stat }) => rosterPercentile(stat))
    .filter((percentile) => percentile !== null);
  const averagePercentile = percentiles.length
    ? percentiles.reduce((sum, percentile) => sum + percentile, 0) / percentiles.length
    : null;
  const availableEntries = entries.filter(Boolean);
  const averageValue = availableEntries
    .reduce((sum, entry) => sum + entry.value, 0) / availableEntries.length;
  const netLevel = averagePercentile === null
    ? averageValue >= 75 ? 'strength' : averageValue <= 50 ? 'weakness' : 'balanced'
    : averagePercentile >= 70 ? 'strength' : averagePercentile <= 30 ? 'weakness' : 'balanced';
  const isVolleyer = /volley/i.test(style);
  const netPresencePercentile = rosterPercentile(findProfileRating(stats, 'Net Presence'));
  const recommendation = netLevel === 'strength'
    ? isVolleyer
      ? 'This character’s Volleyer style and strong net ratings make forward play a regular option; approach after opening the court, not from neutral rallies.'
      : 'The strong net ratings make approaches a regular option for finishing after opening the court, rather than a pattern to force from neutral rallies.'
    : netLevel === 'weakness'
      ? isVolleyer
        ? 'Even with the Volleyer style, this character’s low net ratings make repeated approaches a poor default; come forward only on clear openings.'
        : 'Keep approaches rare: the weak net ratings make repeated trips forward a poor default, so take the net only on clear openings.'
      : isVolleyer
        ? 'The Volleyer style fits the net, but this character’s average ratings call for selective approaches rather than a net charge on every point.'
        : 'Treat net play as an occasional change-up after creating an opening, not as this character’s default pattern.';
  const rosterNote = averagePercentile === null
    ? ''
    : ` Available net ratings average at the ${ordinal(Math.round(averagePercentile))} roster percentile.`;
  const movementNote = netPresencePercentile === null
    ? 'Net Presence supports volley and smash accuracy and consistency, and affects how much movement a volley can tolerate.'
    : netPresencePercentile >= 70
      ? 'Strong Net Presence supports accurate, consistent volleys and smashes, and gives this character more room to move before movement affects a volley.'
      : netPresencePercentile <= 30
        ? 'Lower Net Presence weakens volley and smash accuracy and consistency, and makes movement more likely to affect a volley.'
        : 'Net Presence supports volley and smash accuracy and consistency, and sets how much movement a volley can tolerate.';
  return `${ratingText}.${rosterNote} ${movementNote} ${recommendation}`;
}

const slowCourtSupportAttributes = [
  'Forehand Consistency',
  'Backhand Consistency',
  'Forehand Precision',
  'Backhand Precision',
  'Forehand Power',
  'Backhand Power',
  'Counter',
  'Stamina',
  'Speed',
  'Muscle Tone',
];

const fastCourtSupportAttributes = [
  'Service Power',
  'Service Consistency',
  'Service Precision',
  'Counter',
  'Early Ball',
  'Forehand Power',
  'Backhand Power',
  'Forehand Precision',
  'Backhand Precision',
  'Forehand Volley',
  'Backhand Volley',
  'Net Presence',
  'Smash',
  'Speed',
  'Muscle Tone',
  'Stamina',
];

function averageAttributePercentile(stats, attributes) {
  const percentiles = attributes
    .map((attribute) => rosterPercentile(findProfileRating(stats, attribute)))
    .filter((percentile) => percentile !== null);
  return percentiles.length
    ? percentiles.reduce((sum, percentile) => sum + percentile, 0) / percentiles.length
    : 50;
}

function strongestSupportNames(stats, attributes) {
  return attributes
    .map((attribute) => ({
      attribute,
      percentile: rosterPercentile(findProfileRating(stats, attribute)),
    }))
    .filter((entry) => entry.percentile !== null && entry.percentile >= 70)
    .sort((first, second) => second.percentile - first.percentile)
    .slice(0, 2)
    .map((entry) => entry.attribute);
}

function surfaceFitLabel(score, minScore, maxScore) {
  if (maxScore - minScore < 8) return 'a similar fit to the other paces';
  if (score >= maxScore - 1) return 'the better overall match';
  if (score <= minScore + 1) return 'the tougher overall fit';
  return 'closer to neutral';
}

export function buildCourtSpeedInsight(profileOrStats, styleFallback = '') {
  const { stats, style } = profileStatsAndStyle(profileOrStats, styleFallback);
  const topspin = findProfileRating(stats, 'Topspin');
  const value = numeric(topspin?.value);

  if (value === null || value < 0 || value > 100) return '';
  const rating = `${displayNumber(value)}%`;
  const difference = Math.abs(value - 50);
  const styleName = style.toLowerCase();
  const isRallyStyle = /rally|counter|defensive|baseline/.test(styleName);
  const isVolleyer = /volley/.test(styleName);
  const slowBase = averageAttributePercentile(stats, slowCourtSupportAttributes);
  const fastBase = averageAttributePercentile(stats, fastCourtSupportAttributes);

  // Directional profile heuristic, not a TE4 match-win formula.
  const topspinShift = ((value - 50) / 50) * 14;
  const slowStyleWeight = isRallyStyle ? 1.2 : isVolleyer ? 0.8 : 1;
  const fastStyleWeight = isVolleyer ? 1.2 : isRallyStyle ? 0.8 : 1;
  const clamp = (score) => Math.max(0, Math.min(100, score));
  const scores = {
    slow: clamp(slowBase + topspinShift * slowStyleWeight),
    medium: clamp((slowBase + fastBase) / 2),
    fast: clamp(fastBase - topspinShift * fastStyleWeight),
  };
  const minScore = Math.min(...Object.values(scores));
  const maxScore = Math.max(...Object.values(scores));
  const topScore = maxScore;
  const supportingAttributes = scores.slow >= topScore - 1
    ? slowCourtSupportAttributes
    : scores.fast >= topScore - 1
      ? fastCourtSupportAttributes
      : [...new Set([...slowCourtSupportAttributes, ...fastCourtSupportAttributes])];
  const supportNames = strongestSupportNames(stats, supportingAttributes);
  const topspinLean = difference <= 2
    ? `Topspin ${rating} is close to neutral and adds little court-pace bias.`
    : value > 50
      ? `Topspin ${rating} leans toward slower courts and makes fast courts more demanding.`
      : `Topspin ${rating} leans toward faster courts and makes slow-court rallies more demanding.`;
  const fitSummary = [
    `Slow courts are ${surfaceFitLabel(scores.slow, minScore, maxScore)}`,
    `medium-paced courts are ${surfaceFitLabel(scores.medium, minScore, maxScore)}`,
    `fast courts are ${surfaceFitLabel(scores.fast, minScore, maxScore)}`,
  ].join('; ');
  const supportNote = supportNames.length
    ? ` Strong ${supportNames.join(' and ')} ratings support that overall fit.`
    : '';
  return `${topspinLean} ${fitSummary}.${supportNote}`;
}

export function cleanSizeReachInsight(value) {
  if (typeof value !== 'string') return '';
  const text = normalizeCharacterCopy(value);
  const statements = [];
  const heightMatch = text.match(
    /(?:At\s+([\d.]+)\s*cm\s*\(([^)]+)\)|Height\s+([\d.]+)\s*cm)/i,
  );
  const heightEffect = text.match(
    /That gives a small directional advantage against shoulder-high heavy-spin contact|That adds a small directional challenge against shoulder-high heavy-spin contact|Height itself is neutral in the model's high-ball estimate/i,
  )?.[0];
  const highBounceFit = text.match(
    /(?:this\s+(?:one-handed|two-handed)\s+)?backhand's\s+([\d.]+)\/100 directional fit/i,
  )?.[1];

  if (heightMatch) {
    const height = heightMatch[1] || heightMatch[3];
    const position = heightMatch[2];
    const comparison = position ? ` (${position})` : '';
    let heightNote = '';
    if (/directional advantage/i.test(heightEffect || '')) {
      heightNote = 'Slight edge against shoulder-high, heavy-spin contact only.';
    } else if (/directional challenge/i.test(heightEffect || '')) {
      heightNote = 'A slight challenge on shoulder-high balls when they carry heavy spin.';
    } else if (heightEffect) {
      heightNote = 'No clear height edge in the high-ball estimate.';
    }
    const fitContext = highBounceFit
      ? ` Backhand fit for this situation: ${displayNumber(Number(highBounceFit))}/100.`
      : '';
    statements.push([
      `Height ${height} cm${comparison}.`,
      heightNote,
      fitContext.trim(),
    ].filter(Boolean).join(' '));
  }

  return statements.join(' ');
}

function cleanGamePlanSection(value) {
  return value
    .split(/(?<=[.!?])\s+/)
    .map((sentence) =>
      sentence
        .replace(
          /^(?:according to\s+)?(?:the\s+)?(?:official\s+)?(?:TE4\s+)?manual(?:\s+(?:says|states|notes|describes|confirms))?\s*[:,]?\s*/i,
          '',
        )
        .replace(
          /\b(?:according to|as noted in|as described by)\s+(?:the\s+)?(?:official\s+)?(?:TE4\s+)?manual[:,]?\s*/gi,
          '',
        )
        .replace(/\bWTSL\b/gi, '')
        .replace(/^[\s:;,.-]+/, '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((sentence) => sentence && !/\b(?:weight|body mass)\b/i.test(sentence))
    .join(' ')
    .trim();
}

function removeGamePlanRatingHeading(section, ratingHeadings) {
  const separator = section.indexOf(':');
  if (separator < 0) return section;

  const heading = section.slice(0, separator).trim().toLowerCase();
  if (!ratingHeadings.has(heading)) return section;

  return section.slice(separator + 1).trim();
}

function uniqueGamePlanCopy(items, seen = new Set()) {
  return items.filter((item) => {
    const key = item
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildGamePlanSteps(value, _acceleration = '', stats = []) {
  if (typeof value !== 'string' || !value.trim()) return [];

  const ratingHeadings = new Set(
    (Array.isArray(stats) ? stats : [])
      .map((stat) => String(stat?.attribute ?? '').trim().toLowerCase())
      .filter(Boolean),
  );
  const sections = value
    .replace(/\r\n?/g, '\n')
    .trim()
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z][^:.\n]{1,60}:\s)/)
    .map(cleanGamePlanSection)
    .map((section) => removeGamePlanRatingHeading(section, ratingHeadings))
    .filter(Boolean);

  const seenSentences = new Set();
  return sections
    .map((section) =>
      uniqueGamePlanCopy(
        section.split(/(?<=[.!?])\s+/),
        seenSentences,
      ).join(' ').trim(),
    )
    .filter(Boolean);
}

export function splitRosterEvidenceNotes(stats, notes, excludedText = '') {
  const edgeNotes = new Map();
  const additionalNotes = [];
  const seenAttributes = new Set();
  const rosterStats = Array.isArray(stats) ? stats : [];
  const excludedCopy = typeof excludedText === 'string' ? excludedText : '';

  for (const note of Array.isArray(notes) ? notes : []) {
    const cleanedNote = cleanCharacterGuidance(note);
    if (!cleanedNote) continue;

    const separator = cleanedNote.indexOf(':');
    const name = (separator < 0 ? cleanedNote : cleanedNote.slice(0, separator)).trim();
    const description = separator < 0 ? '' : cleanedNote.slice(separator + 1).trim();
    const attribute = name
      .replace(/\s+\d+(?:\.\d+)?(?:\/100|%)(?:\s|$)[\s\S]*$/i, '')
      .trim();
    if (!attribute) continue;

    const matchingStat = rosterStats.find((stat) =>
      String(stat?.attribute ?? '').trim().toLowerCase() === attribute.toLowerCase(),
    );
    if (matchingStat) {
      if (description && !edgeNotes.has(matchingStat.attribute)) {
        edgeNotes.set(matchingStat.attribute, description);
      }
      continue;
    }

    const attributeKey = attribute.toLowerCase();
    const escapedAttribute = attribute.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    if (
      seenAttributes.has(attributeKey) ||
      new RegExp(`\\b${escapedAttribute}\\b`, 'i').test(excludedCopy)
    ) {
      continue;
    }

    seenAttributes.add(attributeKey);
    additionalNotes.push({ name, description });
  }

  return { edgeNotes, additionalNotes };
}

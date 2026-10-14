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

function weightRosterComparison(position) {
  const match = String(position ?? '').match(
    /\b(\d{1,3})(?:st|nd|rd|th) percentile in (?:the )?(ATP|WTA) roster\b/i,
  );
  if (!match) return '';

  const percentile = Math.max(0, Math.min(100, Number(match[1])));
  const tour = match[2].toUpperCase();
  if (percentile === 0) return `among the lightest ${tour} players`;
  if (percentile === 100) return `among the heaviest ${tour} players`;
  if (percentile === 50) return `around the middle of the ${tour} roster by weight`;
  if (percentile > 50) return `heavier than about ${percentile}% of the ${tour} roster`;
  return `lighter than about ${100 - percentile}% of the ${tour} roster`;
}

export function normalizeCharacterCopy(value) {
  if (typeof value !== 'string') return '';
  return value
    .trim()
    .replace(/\bUse the build\b/gi, (match) =>
      match[0] === match[0].toUpperCase() ? 'Use this character' : 'use this character',
    )
    .replace(/\bthis build(?=['’])/gi, 'this character')
    .replace(/\bThis build(?=['’])/g, 'This character');
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
    .split(/(?<=[.!?])\s+/)
    .map(cleanProfileSourceAttribution)
    .filter((sentence) => sentence && !(shotChoiceTerms.test(sentence) && tacticalActionTerms.test(sentence)))
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

  let serveSuccessAdvice;
  if (powerValue > consistencyValue) {
    serveSuccessAdvice =
      'Strong first-serve success is expected below 70%; Normal falls between Strong and Safe; Safe is 100%.';
  } else if (powerValue < consistencyValue) {
    serveSuccessAdvice =
      'Strong first-serve success is expected above 70%; Normal falls between Strong and Safe; Safe is 100%.';
  } else {
    serveSuccessAdvice =
      'With even Power and Consistency, Strong first-serve success is 70%, Normal is 85%, and Safe is 100%.';
  }

  const precisionRelation = precisionValue > powerValue
    ? 'Precision is the stronger serve attribute, helping with placement.'
    : precisionValue < powerValue
      ? 'Power leads Precision, so favor larger targets over the corners.'
      : 'Power and Precision are level; mix body and corner targets.';
  const speedNote = serveSpeed !== null && serveSpeed > 0
    ? `Average maximal serve speed: ${serveSpeed.toFixed(1)} km/h. `
    : '';

  return `${speedNote}Power ${displayNumber(powerValue)}, Consistency ${displayNumber(consistencyValue)}, Precision ${displayNumber(precisionValue)}. ${serveSuccessAdvice} ${precisionRelation}`;
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
      ? ' It supports steadier difficult shots; use Normal for depth or Short as a change of pace after pushing the opponent back.'
      : ' It helps steady difficult shots.';
    statements.push(
      `${consistencyLabel}${averagePercentile === null ? '' : ` (${ordinal(averagePercentile)} percentile)`}.${consistencyCue}`,
    );
  }

  if (forehand !== null && backhand !== null) {
    statements.push(`Forehand ${displayNumber(forehand)} · Backhand ${displayNumber(backhand)}.`);
  }

  const stamina = numeric(findProfileRating(stats, 'Stamina')?.value);
  if (stamina !== null && stamina >= 0 && stamina <= 100) {
    const accelerationCount = stamina >= 100 ? 5
      : stamina >= 75 ? 4
        : stamina >= 50 ? 3
          : stamina >= 25 ? 2 : 1;
    statements.push(
      `Stamina ${displayNumber(stamina)}% supports about ${accelerationCount} hard accelerations per point when Tiredness is off. Time them near the bounce.`,
    );
  }

  return statements.join(' ');
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

export function buildNetPlayInsight(stats, _fallbackText = '') {
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
  return `${ratingText}. Net Presence helps with control and movement at the net, not power.`;
}

export function buildCourtSpeedInsight(stats, _fallbackText = '') {
  const topspin = Array.isArray(stats)
    ? stats.find((stat) => attributeKey(stat?.attribute) === 'topspin')
    : null;
  const value = numeric(topspin?.value);

  if (value === null || value < 0 || value > 100) return '';
  const rating = `${displayNumber(value)}%`;
  let surfaceText;
  if (value > 50) {
    surfaceText = 'adds spin and suits slow courts, but can cost pace on fast courts.';
  } else if (value < 50) {
    surfaceText = 'is below neutral, so slow courts can be tougher; it is not an automatic fast-court bonus.';
  } else {
    surfaceText = 'is neutral for court fit.';
  }

  return `Topspin ${rating} ${surfaceText}`;
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
      heightNote = 'Small challenge against shoulder-high, heavy-spin contact only.';
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

  const weightMatch = text.match(
    /(?:At\s+([\d.]+)\s*kg\s+\(([^)]+)\)|weight\s+([\d.]+)\s*kg)/i,
  );
  if (weightMatch) {
    const weight = weightMatch[1] || weightMatch[3];
    const position = weightMatch[2];
    const comparison = weightRosterComparison(position);
    const rosterContext = comparison ? `; ${comparison}` : '';
    statements.push(
      `Weight ${weight} kg${rosterContext}. Weight itself does not change movement; Speed and Muscle Tone do.`,
    );
  }

  return statements.join(' ');
}

function normalizeGamePlanStep(value) {
  let step = normalizeCharacterCopy(value);
  step = step
    .replace(
      /Prepare early and choose direction before the ball reaches you\.?/i,
      'Prepare early and pick a target before contact.',
    )
    .replace(/\s+/g, ' ')
    .trim();
  return step;
}

export function buildGamePlanSteps(value, _acceleration = '') {
  if (typeof value !== 'string' || !value.trim()) return [];

  // Keep generic preparation/recovery only; shot-specific guidance is built from documented rules above.
  const approvedGenericSteps = new Set([
    'Prepare early and pick a target before contact.',
    'Recover through the middle after each shot.',
  ]);
  const sections = value
    .trim()
    .split(/\.\s+(?=[A-Z][^:.\n]{1,36}:\s)/)
    .map((section) => section.replace(/^[^:]{1,40}:\s*/, '').trim())
    .flatMap((section) => {
      const hasMiddleRecovery = /\brecover(?:ing)? through the middle\b/i.test(section);
      const withoutRecovery = section.replace(/\s+while recovering through the middle\b/i, '');
      const sentences = withoutRecovery
        .split(/(?<=[.!?])\s+|;\s+/)
        .map(normalizeGamePlanStep)
        .filter((step) => approvedGenericSteps.has(step));
      if (hasMiddleRecovery) sentences.unshift('Recover through the middle after each shot.');
      return [...new Set(sentences)];
    })
    .filter((step) => approvedGenericSteps.has(step));

  return sections;
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

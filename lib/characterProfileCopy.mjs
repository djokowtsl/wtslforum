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

export function cleanCharacterGuidance(value) {
  if (typeof value !== 'string') return '';
  return normalizeCharacterCopy(value)
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) =>
      !(shotChoiceTerms.test(sentence) && tacticalActionTerms.test(sentence)),
    )
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
  return `Counter ${displayNumber(value)}${percentile === null ? '' : ` (${ordinal(percentile)} roster percentile)`} is a rating, not a selectable strike. The TE4 manual documents up to 7.5 km/h of extra speed on Normal and Top Spin strikes against very fast incoming balls; higher Counter helps handle fast balls but makes slow incoming balls less easy.`;
}

export function buildShotVarietyInsight(profile) {
  const stats = profile && typeof profile === 'object' && Array.isArray(profile.stats)
    ? profile.stats
    : [];
  const lob = numeric(findProfileRating(stats, 'Lob')?.value);
  const dropShot = numeric(findProfileRating(stats, 'Drop Shot')?.value);
  if (lob === null && dropShot === null) return '';

  const ratings = [
    lob === null ? '' : `Lob ${displayNumber(lob)}`,
    dropShot === null ? '' : `Drop Shot ${displayNumber(dropShot)}`,
  ].filter(Boolean).join(' and ');
  const comparison = lob !== null && dropShot !== null
    ? 'these values alone do not establish which shot is better'
    : 'this value alone does not establish which shot is better';
  const skillValues = lob !== null && dropShot !== null
    ? 'are character-sheet skill values'
    : 'is a character-sheet skill value';
  return `${ratings} ${skillValues}. The TE4 manual says each skill is balanced with the Forehand or Backhand used, so ${comparison}. The higher weighted skill improves control of fast incoming balls; the manual warns that fast balls can send either shot too far.`;
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

  const powerPercentile = rosterPercentile(power);
  const consistencyPercentile = rosterPercentile(consistency);
  const precisionPercentile = rosterPercentile(precision);
  const powerLabel = `${displayNumber(powerValue)}${powerPercentile === null ? '' : ` (${ordinal(powerPercentile)} percentile)`}`;
  const consistencyLabel = `${displayNumber(consistencyValue)}${consistencyPercentile === null ? '' : ` (${ordinal(consistencyPercentile)} percentile)`}`;
  const precisionLabel = `${displayNumber(precisionValue)}${precisionPercentile === null ? '' : ` (${ordinal(precisionPercentile)} percentile)`}`;

  let serveTypeAdvice;
  if (powerValue > consistencyValue) {
    serveTypeAdvice =
      'Power exceeds Consistency; the TE4 manual says a Strong first serve then has under 70% success. Normal lies between Strong and Safe, while Safe is 100% successful.';
  } else if (powerValue < consistencyValue) {
    serveTypeAdvice =
      'Consistency exceeds Power; the TE4 manual says a Strong first serve then has over 70% success. Normal lies between Strong and Safe, while Safe is 100% successful.';
  } else {
    serveTypeAdvice =
      'With equal Power and Consistency, the TE4 manual gives Strong a 70% first-serve success rate, Normal 85%, and Safe 100%.';
  }

  const precisionRelation = precisionValue > powerValue
    ? `Precision ${precisionLabel} is above Power ${displayNumber(powerValue)}; the manual says this makes the serve more accurate.`
    : `Precision ${precisionLabel} is not above Power ${displayNumber(powerValue)}; the manual says service accuracy improves when Precision is raised above Power.`;
  const speedNote = serveSpeed !== null && serveSpeed > 0
    ? `WTSL estimates average maximum serve speed at ${serveSpeed.toFixed(1)} km/h. `
    : '';

  return `${speedNote}Service Power ${powerLabel}, Consistency ${consistencyLabel}, and Precision ${precisionLabel}. ${serveTypeAdvice} ${precisionRelation}`;
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
    statements.push(
      `${consistencyLabel}${averagePercentile === null ? '' : ` (${ordinal(averagePercentile)} roster percentile)`}. The TE4 manual says higher Consistency lowers faults on difficult balls, deepens Normal strikes, and shortens Short Strikes.`,
      'Manual timing rule: early preparation deepens Normal strikes and shortens Short Strikes; off-position contact can make short shots travel longer than intended.',
    );
  }

  if (forehand !== null && backhand !== null) {
    const forehandLabel = displayNumber(forehand);
    const backhandLabel = displayNumber(backhand);
    statements.push(forehandLabel === backhandLabel
      ? `WTSL combined groundstroke estimates are evenly rated at ${forehandLabel}; these ratings describe the profile, not a guaranteed outcome for a particular shot.`
      : `WTSL combined groundstroke estimates are Forehand ${forehandLabel} and Backhand ${backhandLabel}; these ratings describe the profile, not a guaranteed outcome for a particular shot.`);
  }

  const stamina = numeric(findProfileRating(stats, 'Stamina')?.value);
  if (stamina !== null && stamina >= 0 && stamina <= 100) {
    const accelerationCount = stamina >= 100 ? 5
      : stamina >= 75 ? 4
        : stamina >= 50 ? 3
          : stamina >= 25 ? 2 : 1;
    statements.push(
      `Stamina ${displayNumber(stamina)}% maps to ${accelerationCount} good accelerations and aggressive lobs per point when TE4 Tiredness is off; the profile does not show the match setting or current fatigue.`,
      'The manual says Acceleration is fastest near the top of the bounce; high contact and Danger Zone positioning reduce speed or accuracy.',
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
  const percentiles = entries
    .filter(Boolean)
    .map(({ stat }) => rosterPercentile(stat))
    .filter((percentile) => percentile !== null);
  const rosterText = percentiles.length
    ? ` These available net attributes average the ${ordinal(Math.round(percentiles.reduce((sum, value) => sum + value, 0) / percentiles.length))} roster percentile.`
    : '';

  return `${ratingText}.${rosterText} The TE4 manual says Net Presence combines with the selected Volley or Smash skill for precision and consistency, not power; higher Net Presence also allows more running while volleying without a movement handicap.`;
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
    surfaceText =
      'The manual says ratings above 50% give a bonus on clay and slow surfaces and a handicap on fast surfaces; the bonus is stronger for rally players and smaller for volley players.';
  } else if (value < 50) {
    surfaceText =
      'The manual says ratings below 50% increase the handicap on clay and slow surfaces as the value falls; it does not describe that as a bonus on fast courts.';
  } else {
    surfaceText =
      'The manual defines 50% as neutral: neither a bonus nor a handicap on fast or slow surfaces.';
  }

  return `Topspin ${rating}. ${surfaceText} The manual also says higher Topspin adds spin and slows Normal, Top Spin, Short, Acceleration, and Short Acceleration strikes. Top Spin is therefore a spin-versus-speed choice, not an automatic pick based on surface alone.`;
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
    let modelContext = '';
    if (/directional advantage/i.test(heightEffect || '')) {
      modelContext = ' WTSL describes the height signal as a small directional advantage for shoulder-high, heavy-spin contact.';
    } else if (/directional challenge/i.test(heightEffect || '')) {
      modelContext = ' WTSL describes the height signal as a small directional challenge for shoulder-high, heavy-spin contact.';
    } else if (heightEffect) {
      modelContext = ' WTSL describes height as neutral in its high-ball estimate.';
    }
    const fitContext = highBounceFit
      ? ` The WTSL backhand shoulder-height fit is ${displayNumber(Number(highBounceFit))}/100; this is a directional model estimate, not an in-game success rate.`
      : '';
    statements.push(
      `Height ${height} cm${comparison}.${modelContext}${fitContext} The TE4 manual says smaller characters accelerate slightly faster, with the small benefit offsetting their shorter wingspan. It also says Acceleration is fastest near the top of the bounce and high contact reduces speed.`,
    );
  }

  const weightMatch = text.match(
    /(?:At\s+([\d.]+)\s*kg\s+\(([^)]+)\)|weight\s+([\d.]+)\s*kg)/i,
  );
  if (weightMatch) {
    const weight = weightMatch[1] || weightMatch[3];
    const position = weightMatch[2];
    const comparison = weightRosterComparison(position);
    const rosterContext = comparison ? `; this character is ${comparison}` : '';
    statements.push(
      `Weight ${weight} kg${rosterContext}. The TE4 manual says weight is cosmetic; Speed determines maximum running speed and Speed with Muscle Tone determines running acceleration.`,
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

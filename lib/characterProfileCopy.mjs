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

  return capitalize(text.trim());
}

export function cleanCounterInsight(value) {
  if (typeof value !== 'string') return '';
  return value.replace(
    /Use Counter when the incoming ball already has pace;\s*this profile's (Forehand|Backhand) is the better redirecting option \(([\d.]+ vs [\d.]+)\)\./i,
    (_match, strongerWing, ratingComparison) =>
      `The Counter rating helps this character redirect incoming pace with its stronger ${strongerWing} (${ratingComparison}).`,
  );
}

export function buildCourtSpeedInsight(stats, fallbackText = '') {
  const topspin = Array.isArray(stats)
    ? stats.find((stat) => attributeKey(stat?.attribute) === 'topspin')
    : null;
  const value = numeric(topspin?.value);

  if (value !== null) {
    const rating = `${displayNumber(value)}%`;
    if (value > 50) {
      return `Topspin ${rating} is above neutral: it gives a bonus on clay and slow surfaces (stronger for rally players, smaller for volley players) but increases the handicap on fast surfaces.`;
    }
    if (value < 50) {
      return `Topspin ${rating} is below neutral: lower Topspin favors fast surfaces, while the handicap on slow surfaces grows as the rating falls.`;
    }
    return `Topspin ${rating} is neutral: it gives neither a bonus nor a handicap on fast or slow surfaces.`;
  }

  if (typeof fallbackText !== 'string') return '';
  return normalizeCharacterCopy(fallbackText)
    .replace(/(?:^|\s+)(?:Use|Choose) (?:a )?Top Spin\b[\s\S]*$/i, '')
    .trim();
}

export function cleanSizeReachInsight(value) {
  if (typeof value !== 'string') return '';
  const rewritten = normalizeCharacterCopy(value)
    .replace(
      /At\s+([\d.]+)\s*cm\s+\(([^)]+)\),\s*(That gives a small directional advantage against shoulder-high heavy-spin contact|That adds a small directional challenge against shoulder-high heavy-spin contact|Height itself is neutral in the model's high-ball estimate)\.\s+The more useful cue is this\s+(?:.+?)\s+backhand's\s+([\d.]+)\/100 directional fit;\s+that supports\s+(.+?)\./i,
      (_match, height, position, heightEffect, fit, contactAdvice) => {
        let heightDescription = 'height has little effect on the high-ball estimate';
        if (/directional advantage/i.test(heightEffect)) {
          heightDescription = 'shoulder-high, heavy-spin balls are a little easier to handle';
        } else if (/directional challenge/i.test(heightEffect)) {
          heightDescription = 'shoulder-high, heavy-spin balls are a little harder to handle';
        }

        const contactSentence = /taking a balanced shoulder-height ball early/i.test(contactAdvice)
          ? "Once you're set, take those balls early to attack."
          : "Play a steady rally ball first, then attack once you're set.";

        return `At ${height} cm (${position}), ${heightDescription}. This character's backhand scores ${fit}/100 for shoulder-height contact. ${contactSentence}`;
      },
    )
    .replace(
      /At\s+([\d.]+)\s*kg\s+\(([^)]+)\), body mass is distinctive but has no separate documented pace or movement effect; Speed and Muscle Tone are the relevant court-coverage ratings\./i,
      (_match, weight, position) => {
        const comparison = weightRosterComparison(position);
        const weightContext = comparison
          ? `this character is ${comparison}`
          : `this character's roster weight is ${position}`;
        return `At ${weight} kg, ${weightContext}. Weight alone doesn't tell us how quickly they move; Speed and Muscle Tone are better guides to court coverage.`;
      },
    )
    .replace(
      /That gives a small directional advantage against shoulder-high heavy-spin contact\./i,
      'Shoulder-high, heavy-spin balls are a little easier to handle at this height.',
    )
    .replace(
      /That adds a small directional challenge against shoulder-high heavy-spin contact\./i,
      'Shoulder-high, heavy-spin balls are a little harder to handle at this height.',
    )
    .replace(
      /Height itself is neutral in the model's high-ball estimate\./i,
      'Height has little effect on the high-ball estimate.',
    )
    .replace(
      /;\s*that supports favor taking a balanced shoulder-height ball early\./i,
      ". Once you're set, take shoulder-height balls early to attack.",
    )
    .replace(
      /;\s*that supports favor a normal rally ball to regain balance before attacking\./i,
      ". Play a steady rally ball first, then attack once you're set.",
    );

  return rewritten.trim();
}

function normalizeGamePlanStep(value, hasSpecialAcceleration) {
  let step = normalizeCharacterCopy(value);
  step = step
    .replace(
      /Prepare early and choose direction before the ball reaches you\.?/i,
      'Prepare early and pick a target before contact.',
    )
    .replace(
      /Use deep forehand cross-court shape, then change direction when the reply sits short\.?/i,
      'Keep the forehand deep and cross-court; change direction when a short ball gives you time.',
    )
    .replace(
      /Use normal or Top Spin rally strikes while recovering through the middle; choose an acceleration only when balanced and the reply is short\.?/i,
      hasSpecialAcceleration
        ? "Recover through the middle after each shot. Use Top Spin when you need extra clearance; save acceleration for a short ball once you're set."
        : 'Recover through the middle after each shot. Use Top Spin when you need extra clearance; rely on timing and positioning rather than a special acceleration.',
    )
    .replace(
      /Build with depth, recover to the middle, and attack (?:a )?short repl(?:y|ies)\.?/i,
      'Use depth to open the court, recover through the middle, then attack a short ball.',
    )
    .replace(
      /Approach only after a short or defensive reply; direct the first volley toward the side the opponent has just left open\.?/i,
      'Move forward only after drawing a short or defensive reply. Aim the first volley into the space the opponent has left.',
    )
    .replace(/\s+/g, ' ')
    .trim();
  return step;
}

export function buildGamePlanSteps(value, acceleration = '') {
  if (typeof value !== 'string' || !value.trim()) return [];

  const hasSpecialAcceleration =
    String(acceleration ?? '').trim().toLowerCase() !== '' &&
    String(acceleration ?? '').trim().toLowerCase() !== 'none';
  const sections = value
    .trim()
    .split(/\.\s+(?=[A-Z][^:.\n]{1,36}:\s)/)
    .map((section) => section.replace(/^[^:]{1,40}:\s*/, '').trim())
    .map((section) => normalizeGamePlanStep(section, hasSpecialAcceleration))
    .filter(Boolean);

  return sections;
}

export function splitRosterEvidenceNotes(stats, notes, excludedText = '') {
  const edgeNotes = new Map();
  const additionalNotes = [];
  const seenAttributes = new Set();
  const rosterStats = Array.isArray(stats) ? stats : [];
  const excludedCopy = typeof excludedText === 'string' ? excludedText : '';

  for (const note of Array.isArray(notes) ? notes : []) {
    if (typeof note !== 'string' || !note.trim()) continue;

    const separator = note.indexOf(':');
    const name = (separator < 0 ? note : note.slice(0, separator)).trim();
    const description = separator < 0 ? '' : note.slice(separator + 1).trim();
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

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
      `The Counter rating helps this character redirect incoming pace with its stronger ${strongerWing} (${ratingComparison}). Use a Normal strike when stretched; save Acceleration or Short Acceleration for a short reply reached in balance.`,
  );
}

export function cleanShotVarietyInsight(value) {
  if (typeof value !== 'string') return '';
  const text = normalizeCharacterCopy(value);
  const selectableMatch = text.match(
    /Lob\s+([\d.]+)\s+and drop shot\s+([\d.]+)\s+support selectable shot variation: use the drop shot after pushing the opponent deep, or choose a lob when they close the net\./i,
  );
  const supportingMatch = text.match(
    /Lob\s+([\d.]+)\s+and drop shot\s+([\d.]+)\s+are supporting options\. Establish depth first and use either only when court position gives the shot a purpose\./i,
  );
  const match = selectableMatch || supportingMatch;
  if (!match) return text;

  const lob = Number(match[1]);
  const dropShot = Number(match[2]);
  const lobText = displayNumber(lob);
  const dropShotText = displayNumber(dropShot);
  const difference = displayNumber(Math.abs(lob - dropShot));
  const hasSelectableOptions = Boolean(selectableMatch);
  let tailoredCopy;

  if (lob > dropShot) {
    tailoredCopy = hasSelectableOptions
      ? `Lob ${lobText} is higher than drop shot ${dropShotText} by ${difference} points. Favor the lob when the opponent closes in; use the drop shot after pushing them deep.`
      : `Lob ${lobText} leads drop shot ${dropShotText} by ${difference} points, though neither is a standout. Build depth first, then look for the lob when the opponent closes in.`;
  } else if (dropShot > lob) {
    tailoredCopy = hasSelectableOptions
      ? `Drop shot ${dropShotText} is higher than lob ${lobText} by ${difference} points. Favor it after pushing the opponent deep; keep the lob for when they close in.`
      : `Drop shot ${dropShotText} leads lob ${lobText} by ${difference} points, though neither is a standout. Build depth first, then use the drop shot only when the opponent stays deep.`;
  } else {
    tailoredCopy = hasSelectableOptions
      ? `Lob and drop shot are tied at ${lobText}; use the drop shot after pushing the opponent deep and lob when they close in.`
      : `Lob and drop shot are tied at ${lobText}, and neither is a standout. Establish depth first and use either only when court position creates an opening.`;
  }

  return `${text.slice(0, match.index)}${tailoredCopy}${text.slice(match.index + match[0].length)}`;
}

export function cleanNetInsight(value) {
  if (typeof value !== 'string') return '';
  const text = normalizeCharacterCopy(value);
  return text.replace(
    /Net Presence\s+([\d.]+), average volley\s+([\d.]+), and smash\s+([\d.]+) support a net finish\. Approach after a short or defensive reply, then aim the first volley toward the side the opponent has left open\./i,
    (_match, netPresence, volleyAverage, smash) =>
      `Net Presence ${netPresence}, average volley ${volleyAverage}, and smash ${smash} make a net finish a situational option, not a net-first plan. Approach only after a short or defensive reply; target the open side with the first volley.`,
  );
}

export function cleanStrokeMechanicsInsight(value) {
  if (typeof value !== 'string') return '';
  const text = normalizeCharacterCopy(value);
  return text.replace(
    /The (forehand|backhand) is the stronger groundstroke \(([\d.]+) vs ([\d.]+)\); use it to attack a shorter reply\./i,
    (match, _strongerWing, strongerRating, weakerRating) => {
      if (Number(strongerRating) !== Number(weakerRating)) return match;
      return `Forehand and backhand are evenly rated (${strongerRating} each); neither has a rating edge. Choose the better-positioned wing to attack a shorter reply.`;
    },
  );
}

function findProfileRating(ratings, attribute) {
  const target = attributeKey(attribute);
  return Array.isArray(ratings)
    ? ratings.find((rating) => attributeKey(rating?.attribute) === target)
    : null;
}

function rosterPercentile(stat) {
  const percentile = numeric(stat?.percentile);
  if (percentile === null) return null;
  const score = percentile <= 1 ? percentile * 100 : percentile;
  return Math.round(Math.max(0, Math.min(100, score)));
}

export function buildServeInsight(profile, fallbackText = '') {
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
  const fallback = normalizeCharacterCopy(fallbackText);
  if (powerValue === null || consistencyValue === null || precisionValue === null) {
    return fallback;
  }

  const serveRating = findProfileRating(combinedRatings, 'Serve Rating');
  let serveSpeed = numeric(serveRating?.max_serve_speed_kmh);
  if (serveSpeed === null || serveSpeed <= 0) {
    const speedMatch = fallback.match(/Average maximal serve speed is\s+([\d.]+)\s+km\/h/i);
    serveSpeed = speedMatch ? numeric(speedMatch[1]) : null;
  }
  if (serveSpeed === null || serveSpeed <= 0) return fallback;

  const powerPercentile = rosterPercentile(power);
  const consistencyPercentile = rosterPercentile(consistency);
  const precisionPercentile = rosterPercentile(precision);
  const powerLabel = `${displayNumber(powerValue)}${powerPercentile === null ? '' : ` (${ordinal(powerPercentile)} percentile)`}`;
  const consistencyLabel = `${displayNumber(consistencyValue)}${consistencyPercentile === null ? '' : ` (${ordinal(consistencyPercentile)} percentile)`}`;
  const precisionLabel = `${displayNumber(precisionValue)}${precisionPercentile === null ? '' : ` (${ordinal(precisionPercentile)} percentile)`}`;

  const rawBalance = powerValue - consistencyValue;
  const percentileBalance =
    powerPercentile === null || consistencyPercentile === null
      ? null
      : powerPercentile - consistencyPercentile;
  let serveBalanceAdvice;
  if (rawBalance >= 12) {
    serveBalanceAdvice =
      'Power clearly leads consistency; use the extra pace selectively and protect the second serve.';
  } else if (rawBalance <= -12) {
    serveBalanceAdvice =
      'Consistency clearly leads power; prioritize a reliable serve over forcing extra pace.';
  } else if (percentileBalance !== null && percentileBalance >= 15) {
    serveBalanceAdvice =
      'Power is the stronger roster-relative asset despite the close raw ratings; use first-serve pace selectively and protect the second serve.';
  } else if (percentileBalance !== null && percentileBalance <= -15) {
    serveBalanceAdvice =
      'Consistency is the stronger roster-relative asset despite the close raw ratings; value reliability over extra pace.';
  } else {
    serveBalanceAdvice =
      'Power and consistency are close, so keep pace within a reliable margin.';
  }

  let placementAdvice;
  if (precisionPercentile !== null && precisionPercentile >= 75) {
    placementAdvice =
      'Placement is a top-quartile strength; use it to vary body and corner targets.';
  } else if (precisionPercentile !== null && precisionPercentile < 50) {
    placementAdvice =
      'Placement is below the roster midpoint; favor the body and higher-margin targets rather than chasing corners.';
  } else if (precisionPercentile !== null) {
    placementAdvice =
      'Placement is not a top-quartile strength; mix body and corner targets to create an opening.';
  } else if (precisionValue >= powerValue + 8) {
    placementAdvice =
      'Precision outpaces power, so use placement to move the returner with body and corner targets.';
  } else if (precisionValue <= powerValue - 8) {
    placementAdvice =
      'Power outpaces precision; favor body and higher-margin targets instead of chasing corners.';
  } else {
    placementAdvice = 'Mix body and corner targets to create an opening.';
  }

  const forehand = numeric(findProfileRating(combinedRatings, 'Forehand Rating')?.value);
  const backhand = numeric(findProfileRating(combinedRatings, 'Backhand Rating')?.value);
  let firstShotAdvice =
    'Use a Normal strike to keep a neutral return deep; choose Acceleration or Short Acceleration only when a short reply gives you balanced contact.';
  if (forehand !== null && backhand !== null) {
    const forehandDisplay = Number(displayNumber(forehand));
    const backhandDisplay = Number(displayNumber(backhand));
    if (forehandDisplay > backhandDisplay) {
      firstShotAdvice =
        `Use a Normal strike to keep a neutral return deep. When the serve draws a short, balanced ball, attack with an Acceleration for depth or a Short Acceleration into the open short court, using the forehand (${displayNumber(forehand)} vs ${displayNumber(backhand)}).`;
    } else if (backhandDisplay > forehandDisplay) {
      firstShotAdvice =
        `Use a Normal strike to keep a neutral return deep. When the serve draws a short, balanced ball, attack with an Acceleration for depth or a Short Acceleration into the open short court, using the backhand (${displayNumber(backhand)} vs ${displayNumber(forehand)}).`;
    } else {
      firstShotAdvice =
        `Use a Normal strike to keep a neutral return deep. When the serve draws a short, balanced ball, choose an Acceleration for depth or a Short Acceleration into the open short court; the groundstrokes are evenly rated (${displayNumber(forehand)} each), so use the better-positioned wing.`;
    }
  }

  return `Average maximal serve speed is ${serveSpeed.toFixed(1)} km/h. Service Power ${powerLabel}, Consistency ${consistencyLabel}, and Precision ${precisionLabel}. ${serveBalanceAdvice} ${placementAdvice} ${firstShotAdvice}`;
}

export function buildGroundstrokeInsight(profile, fallbackText = '') {
  const stats = profile && typeof profile === 'object' && Array.isArray(profile.stats)
    ? profile.stats
    : [];
  const combinedRatings =
    profile && typeof profile === 'object' && Array.isArray(profile.combined_ratings)
      ? profile.combined_ratings
      : [];
  const source = normalizeCharacterCopy(fallbackText);
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
  const consistencyPercentiles = consistencyStats
    .map(rosterPercentile)
    .filter((percentile) => percentile !== null);
  const averageConsistencyPercentile = consistencyPercentiles.length
    ? Math.round(
        consistencyPercentiles.reduce((sum, percentile) => sum + percentile, 0) /
          consistencyPercentiles.length,
      )
    : null;
  const consistencyEvidence = averageConsistency === null
    ? ''
    : consistencyStats.length > 1
      ? `Forehand and backhand Consistency average ${displayNumber(averageConsistency)}`
        + (averageConsistencyPercentile === null
          ? '.'
          : ` (${ordinal(averageConsistencyPercentile)} percentile).`)
      : `${consistencyStats[0].attribute} is ${displayNumber(averageConsistency)}`
        + (averageConsistencyPercentile === null
          ? '.'
          : ` (${ordinal(averageConsistencyPercentile)} percentile).`);

  let shortStrikeAdvice;
  if (averageConsistencyPercentile !== null && averageConsistencyPercentile >= 75) {
    shortStrikeAdvice =
      'That relative consistency supports using a Short Strike after pushing the opponent deep.';
  } else if (averageConsistencyPercentile !== null && averageConsistencyPercentile < 50) {
    shortStrikeAdvice =
      'Keep the Short Strike selective, using it when the opponent is well behind the baseline.';
  } else {
    shortStrikeAdvice =
      'Use a Short Strike as a change-up after moving the opponent deep.';
  }

  let strongerWing = 'better-positioned wing';
  let wingAdvice = 'Use the better-positioned wing for the first attack.';
  if (forehand !== null && backhand !== null) {
    const forehandDisplay = Number(displayNumber(forehand));
    const backhandDisplay = Number(displayNumber(backhand));
    if (forehandDisplay > backhandDisplay) {
      strongerWing = 'forehand';
      wingAdvice =
        `The forehand rates higher (${displayNumber(forehand)} vs ${displayNumber(backhand)}); use it for the first attack when balance and court position allow.`;
    } else if (backhandDisplay > forehandDisplay) {
      strongerWing = 'backhand';
      wingAdvice =
        `The backhand rates higher (${displayNumber(backhand)} vs ${displayNumber(forehand)}); use it for the first attack when balance and court position allow.`;
    } else {
      wingAdvice =
        `Forehand and backhand are evenly rated (${displayNumber(forehand)} each); choose the wing that is better positioned.`;
    }
  }

  const staminaPercentile = rosterPercentile(findProfileRating(stats, 'Stamina'));
  const accelerationAdvice = staminaPercentile !== null && staminaPercentile < 50
    ? 'Stamina is below the roster midpoint, so save Acceleration and Short Acceleration for clear, balanced short balls.'
    : `When a short ball gives time to set, use an Acceleration for a deeper attack or a Short Acceleration toward the open short court through the ${strongerWing}.`;

  return [
    source,
    consistencyEvidence,
    'Use a Normal strike for depth on neutral or difficult contact.',
    shortStrikeAdvice,
    wingAdvice,
    accelerationAdvice,
  ].filter(Boolean).join(' ');
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

export function buildNetPlayInsight(stats, fallbackText = '') {
  const attributes = ['Net Presence', 'Forehand Volley', 'Backhand Volley', 'Smash'];
  const rankedStats = attributes.map((attribute) => {
    const stat = Array.isArray(stats)
      ? stats.find((item) => attributeKey(item?.attribute) === attributeKey(attribute))
      : null;
    const value = numeric(stat?.value);
    const percentile = numeric(stat?.percentile);
    if (stat?.rank == null || value === null || percentile === null) return null;
    const normalizedPercentile = percentile <= 1 ? percentile * 100 : percentile;
    return {
      value,
      percentile: Math.max(0, Math.min(100, normalizedPercentile)),
    };
  });

  if (rankedStats.some((stat) => stat === null)) return cleanNetInsight(fallbackText);

  const [netPresence, forehandVolley, backhandVolley, smash] = rankedStats;
  const averageVolley = (forehandVolley.value + backhandVolley.value) / 2;
  const averageNetPercentile = Math.round(
    rankedStats.reduce((sum, stat) => sum + stat.percentile, 0) / rankedStats.length,
  );
  const ratings = `Net Presence ${displayNumber(netPresence.value)}, average volley ${displayNumber(averageVolley)}, and Smash ${displayNumber(smash.value)}. Across the selected roster, the four net attributes average the ${ordinal(averageNetPercentile)} percentile.`;

  let tacticalAdvice;
  if (averageNetPercentile >= 75) {
    tacticalAdvice =
      'Net play is a relative strength, so approach behind a deep Normal strike or after drawing a short reply—not as a default net-first pattern.';
  } else if (averageNetPercentile >= 50) {
    tacticalAdvice =
      'Net play is not a top-quarter strength; keep Normal strikes deep and approach only after a short or defensive reply.';
  } else {
    tacticalAdvice =
      'Net play is below the roster midpoint; use Normal strikes to hold the baseline and come forward only to finish a clear short ball.';
  }

  let volleyContext;
  if (forehandVolley.value >= backhandVolley.value + 5) {
    volleyContext = `The forehand volley (${displayNumber(forehandVolley.value)}) is the stronger finishing wing than the backhand volley (${displayNumber(backhandVolley.value)}).`;
  } else if (backhandVolley.value >= forehandVolley.value + 5) {
    volleyContext = `The backhand volley (${displayNumber(backhandVolley.value)}) is the stronger finishing wing than the forehand volley (${displayNumber(forehandVolley.value)}).`;
  } else {
    volleyContext = `Forehand and backhand volleys are close (${displayNumber(forehandVolley.value)} and ${displayNumber(backhandVolley.value)}), so court position matters more than choosing one wing.`;
  }

  return `${ratings} ${tacticalAdvice} ${volleyContext}`;
}

export function buildCourtSpeedInsight(stats, fallbackText = '') {
  const topspin = Array.isArray(stats)
    ? stats.find((stat) => attributeKey(stat?.attribute) === 'topspin')
    : null;
  const value = numeric(topspin?.value);

  if (value !== null) {
    const rating = `${displayNumber(value)}%`;
    if (value > 50) {
      return `Topspin ${rating} is above neutral: it gives a bonus on clay and slow surfaces (stronger for rally players, smaller for volley players) but increases the handicap on fast surfaces. Choose the Top Spin stroke when slow-court clearance matters; use a Normal strike on faster courts when preserving pace is more important.`;
    }
    if (value < 50) {
      return `Topspin ${rating} is below neutral: lower Topspin favors fast surfaces, while the handicap on slow surfaces grows as the rating falls. On slow courts, choose the Top Spin stroke when you need more clearance; on fast courts, a Normal strike keeps the shot flatter.`;
    }
    return `Topspin ${rating} is neutral: it gives neither a bonus nor a handicap on fast or slow surfaces. Use a Normal strike for the neutral rally and choose the Top Spin stroke when extra clearance matters more than pace.`;
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
          ? 'Take balanced shoulder-height contact early to attack; if it climbs to head height, choose a Normal strike rather than forcing Acceleration.'
          : "Play a steady rally ball first with a Normal strike, then attack once you're set; avoid Acceleration from a rushed or head-height contact.";

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

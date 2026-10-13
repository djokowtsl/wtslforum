const excludedAttributes = new Set([
  'sliceserve',
  'topspinserve',
  'twistserve',
  'boomboomserver',
  'ontimeserver',
]);

function attributeKey(attribute) {
  return String(attribute ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function numeric(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function percentileValue(value) {
  const parsed = numeric(value);
  if (parsed === null || parsed < 0) return null;
  const percent = parsed <= 1 ? parsed * 100 : parsed;
  return Math.round(Math.max(0, Math.min(100, percent)));
}

function ordinal(value) {
  const lastTwo = value % 100;
  const suffix = lastTwo >= 11 && lastTwo <= 13
    ? 'th'
    : ({ 1: 'st', 2: 'nd', 3: 'rd' }[value % 10] || 'th');
  return `${value}${suffix}`;
}

function formatRating(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function joinNatural(items) {
  if (items.length < 2) return items[0] || '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

function collectRatedAttributes(stats) {
  if (!Array.isArray(stats)) return [];
  const seen = new Set();
  return stats.flatMap((stat) => {
    if (!stat || typeof stat !== 'object') return [];
    const attribute = String(stat.attribute ?? '').trim();
    const key = attributeKey(attribute);
    const rating = numeric(stat.value);
    if (!attribute || !key || excludedAttributes.has(key) || rating === null || rating <= 0 || seen.has(key)) {
      return [];
    }
    seen.add(key);
    return [{
      attribute,
      key,
      rating,
      percentile: percentileValue(stat.percentile),
      rank: numeric(stat.rank),
      count: numeric(stat.count),
    }];
  });
}

function rankingContext(stat) {
  if (Number.isInteger(stat.rank) && Number.isInteger(stat.count) && stat.count > 0) {
    return `rank #${stat.rank} of ${stat.count}`;
  }
  return stat.percentile === null
    ? ''
    : `${ordinal(stat.percentile)} percentile`;
}

function describeRating(stat) {
  const context = rankingContext(stat);
  return `${stat.attribute} ${formatRating(stat.rating)}/100${context ? ` (${context})` : ''}`;
}

function compareRosterRanks(first, second) {
  if (first.rank !== null && second.rank !== null && first.rank !== second.rank) {
    return first.rank - second.rank;
  }
  return (second.percentile ?? -1) - (first.percentile ?? -1)
    || second.rating - first.rating
    || first.attribute.localeCompare(second.attribute);
}

export function buildCharacterProfileSummary(character, stats, combinedRatings = []) {
  const name = String(character ?? '').trim() || 'This character';
  const combined = collectRatedAttributes(combinedRatings)
    .sort(compareRosterRanks);
  if (combined.length) {
    const forehand = combined.find((stat) => stat.key === 'forehandrating');
    const backhand = combined.find((stat) => stat.key === 'backhandrating');
    let groundstrokeNote = '';
    if (forehand && backhand) {
      const difference = Math.abs(forehand.rating - backhand.rating);
      groundstrokeNote = difference < 0.1
        ? `Forehand and Backhand ratings are level at ${formatRating(forehand.rating)}.`
        : `${forehand.rating > backhand.rating ? 'Forehand' : 'Backhand'} leads the other groundstroke rating by ${formatRating(difference)} points.`;
    }
    const leader = combined[0];
    return `${name}'s combined skill ratings are ${joinNatural(combined.map(describeRating))}. The highest-ranked is ${leader.attribute}${leader.rank ? ` (#${leader.rank} of ${leader.count})` : ''}.${groundstrokeNote ? ` ${groundstrokeNote}` : ''}`;
  }

  const standout = collectRatedAttributes(stats)
    .sort((first, second) => {
      const percentileDifference = (second.percentile ?? -1) - (first.percentile ?? -1);
      return percentileDifference
        || second.rating - first.rating
        || first.attribute.localeCompare(second.attribute);
    })
    .slice(0, 3);

  if (!standout.length) {
    return `${name} does not have enough rating data for a character-specific summary yet.`;
  }

  return `${name}'s leading roster ratings are ${joinNatural(standout.map(describeRating))}.`;
}

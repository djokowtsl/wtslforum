const excludedAttributes = new Set([
  'sliceserve',
  'topspinserve',
  'twistserve',
  'boomboomserver',
  'ontimeserver',
]);

const signaturePatterns = new Map([
  ['servicepower', 'first-serve pressure'],
  ['serviceconsistency', 'reliable serve-plus-one points'],
  ['serviceprecision', 'serve placement and first-ball setup'],
  ['forehandpower', 'forehand-led first strikes'],
  ['backhandpower', 'backhand-led attacks'],
  ['forehandconsistency', 'forehand depth under pressure'],
  ['backhandconsistency', 'backhand depth under pressure'],
  ['forehandprecision', 'precise forehand direction changes'],
  ['backhandprecision', 'precise backhand direction changes'],
  ['forehandvolley', 'controlled forehand-volley finishes'],
  ['backhandvolley', 'backhand-volley transitions'],
  ['netpresence', 'planned net approaches'],
  ['smash', 'finishing high balls'],
  ['ballfeeling', 'touch after opening the court'],
  ['earlyball', 'early-contact attacks'],
  ['topspin', 'surface-aware height and spin'],
  ['counter', 'redirecting incoming pace'],
  ['speed', 'recovery and court coverage'],
  ['muscletone', 'quick recovery movement'],
  ['stamina', 'sustained movement across long points'],
  ['focus', 'early preparation'],
  ['slicemastery', 'slice variation'],
  ['lob', 'defensive lob resets'],
  ['dropshot', 'short-ball changes of pace'],
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
    }];
  });
}

export function buildCharacterProfileSummary(character, stats) {
  const name = String(character ?? '').trim() || 'This character';
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

  const evidence = standout.map((stat) => {
    const percentile = stat.percentile === null
      ? ''
      : ` (${ordinal(stat.percentile)} percentile)`;
    return `${stat.attribute} ${formatRating(stat.rating)}/100${percentile}`;
  });
  const patterns = [...new Set(standout.map((stat) =>
    signaturePatterns.get(stat.key) || `a game shaped by ${stat.attribute}`,
  ))];

  return `${name} stands out for ${joinNatural(evidence)}, supporting ${joinNatural(patterns)}.`;
}

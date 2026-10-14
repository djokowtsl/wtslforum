import { normalizeCharacterCopy } from './characterProfileCopy.mjs';

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

function compareRosterRanks(first, second) {
  if (first.rank !== null && second.rank !== null && first.rank !== second.rank) {
    return first.rank - second.rank;
  }
  return (second.percentile ?? -1) - (first.percentile ?? -1)
    || second.rating - first.rating
    || first.attribute.localeCompare(second.attribute);
}

const summaryAttributeLabels = new Map([
  ['servicepower', 'serve pace'],
  ['serviceconsistency', 'serve reliability'],
  ['serviceprecision', 'serve placement'],
  ['forehandpower', 'forehand power'],
  ['forehandconsistency', 'forehand consistency'],
  ['forehandprecision', 'forehand placement'],
  ['backhandpower', 'backhand power'],
  ['backhandconsistency', 'backhand consistency'],
  ['backhandprecision', 'backhand placement'],
  ['spinnybackhand', 'backhand spin'],
  ['flatbackhand', 'flat backhand'],
  ['slicemastery', 'slice control'],
  ['earlyball', 'early-ball timing'],
  ['netpresence', 'net positioning'],
  ['forehandvolley', 'forehand volleys'],
  ['backhandvolley', 'backhand volleys'],
  ['ballfeeling', 'touch'],
  ['smash', 'overhead finishing'],
  ['speed', 'court coverage'],
  ['muscletone', 'powerful movement'],
  ['stamina', 'stamina'],
  ['claymover', 'clay-court movement'],
  ['slider', 'sliding movement'],
  ['lob', 'lobs'],
  ['dropshot', 'drop shots'],
  ['focus', 'focus under pressure'],
  ['counter', 'counterpunching'],
  ['topspin', 'heavy topspin'],
]);

function distinctSummaryAttributes(guidance, stats) {
  const seen = new Set();
  const attributes = [];
  const add = (items) => {
    for (const item of Array.isArray(items) ? items : []) {
      const attribute = typeof item === 'string' ? item.trim() : String(item?.attribute ?? '').trim();
      const key = attributeKey(attribute);
      const rating = typeof item === 'string' ? null : numeric(item?.value);
      if (
        !attribute ||
        !key ||
        excludedAttributes.has(key) ||
        seen.has(key) ||
        (rating !== null && rating <= 0)
      ) {
        continue;
      }
      seen.add(key);
      attributes.push(attribute);
    }
  };

  add(guidance?.top_edges);
  add(collectRatedAttributes(stats).sort(compareRosterRanks));
  return attributes.slice(0, 5);
}

function summaryAttributeLabel(attribute) {
  const key = attributeKey(attribute);
  return summaryAttributeLabels.get(key) || String(attribute ?? '').trim().toLowerCase();
}

function joinSummaryLabels(labels) {
  if (labels.length < 2) return labels[0] || '';
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')}, and ${labels.at(-1)}`;
}

function hasGeneratedSelectionTemplate(value) {
  return /\bsuits\s+[^.]+\.\s+Use this character to\s+.+\.?$/i.test(value);
}

function buildDistinctiveSummary(name, guidance, stats) {
  const attributes = distinctSummaryAttributes(guidance, stats);
  if (!attributes.length) return '';

  const labels = attributes.map(summaryAttributeLabel);
  return `${name} stands out for ${joinSummaryLabels(labels)}. These are roster-relative ratings, not per-shot predictions.`;
}

function guidanceText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function buildCharacterProfileSummary(
  character,
  stats,
  combinedRatings = [],
  selectionGuidance = {},
) {
  const name = String(character ?? '').trim() || 'This character';
  const guidance = selectionGuidance && typeof selectionGuidance === 'object'
    ? selectionGuidance
    : {};
  const whySelect = normalizeCharacterCopy(guidanceText(guidance.why_select));

  if (whySelect && hasGeneratedSelectionTemplate(whySelect)) {
    const distinctiveSummary = buildDistinctiveSummary(
      name,
      guidance,
      stats,
    );
    if (distinctiveSummary) return distinctiveSummary;
  }

  const combined = collectRatedAttributes(combinedRatings)
    .sort(compareRosterRanks);
  if (combined.length) {
    const strongest = combined[0];
    const weakest = combined.at(-1);
    const lines = [
      `${name}'s strongest WTSL-combined roster rating is ${strongest.attribute}.`,
    ];
    if (weakest && weakest.key !== strongest.key) {
      lines.push(`${weakest.attribute} is the comparatively lower-ranked combined rating.`);
    }
    lines.push('These are roster comparisons, not per-shot predictions.');
    return lines.join(' ');
  }

  const standout = collectRatedAttributes(stats)
    .sort(compareRosterRanks);

  if (!standout.length) {
    return `${name} does not have enough rating data for a character-specific summary yet.`;
  }

  return `${name}'s clearest roster edge is ${standout[0].attribute}. This is a roster comparison, not an outcome prediction.`;
}

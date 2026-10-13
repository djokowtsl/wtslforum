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

function tacticalUse(attribute) {
  const key = attributeKey(attribute);
  if (key.includes('serve')) return 'Use the serve to set up the first groundstroke, rather than relying on a free point.';
  if (key.includes('forehand')) return 'Build patterns through the forehand and look to attack a short reply.';
  if (key.includes('backhand')) return 'Use the backhand as a deliberate rally option, while staying alert to pressure on that wing.';
  if (key.includes('volley') || key.includes('netpresence') || key.includes('ballfeeling')) {
    return 'Create a short reply first, then use touch or a controlled net finish.';
  }
  if (key.includes('stamina') || key.includes('speed') || key.includes('mover')) {
    return 'Use the movement or stamina edge to recover between shots and sustain neutral exchanges.';
  }
  if (key.includes('consistency')) return 'Use it to keep neutral exchanges stable and make the opponent create the risk.';
  return 'Treat it as this build’s clearest relative option, not as a prediction of match outcomes.';
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
  const whySelect = guidanceText(guidance.why_select);
  const whyNotSelect = guidanceText(guidance.why_not_select || guidance.tradeoff);

  if (whySelect) {
    return whySelect;
  }

  const bestFor = guidanceText(guidance.best_for);
  if (bestFor) {
    return [bestFor, whyNotSelect]
      .filter((text, index, lines) => text && (index === 0 || text !== lines[0]))
      .join(' ');
  }

  const combined = collectRatedAttributes(combinedRatings)
    .sort(compareRosterRanks);
  if (combined.length) {
    const strongest = combined[0];
    const weakest = combined.at(-1);
    const lines = [
      `${name}'s strongest WTSL-combined roster skill is ${strongest.attribute}. ${tacticalUse(strongest.attribute)}`,
    ];
    if (weakest && weakest.key !== strongest.key) {
      lines.push(`${weakest.attribute} is the comparatively lower-ranked combined skill, so avoid forcing every pattern through it.`);
    }
    return lines.join(' ');
  }

  const standout = collectRatedAttributes(stats)
    .sort(compareRosterRanks);

  if (!standout.length) {
    return `${name} does not have enough rating data for a character-specific summary yet.`;
  }

  return `${name}'s clearest roster edge is ${standout[0].attribute}. ${tacticalUse(standout[0].attribute)}`;
}

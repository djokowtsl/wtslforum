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
  return 'Treat it as this character’s clearest relative option, not as a prediction of match outcomes.';
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

function summaryTacticalCue(attributes) {
  const keys = attributes.map(attributeKey);
  const has = (test) => keys.some((key) => test.test(key));
  const hasServe = has(/^service/);
  const hasNet = has(/volley|netpresence|ballfeeling|smash/);
  const hasGroundstroke = has(/forehand|backhand/);
  const hasMovement = has(/speed|stamina|muscletone|mover|slider/);

  if (hasServe && hasNet) {
    return 'Use serve placement to draw a short reply, then finish with touch or a volley.';
  }
  if (hasServe && hasGroundstroke) {
    return 'Use the serve to set up the stronger groundstroke rather than chasing a free point.';
  }
  if (hasServe) {
    return 'Vary serve targets to control how the point starts.';
  }
  if (hasNet && has(/ballfeeling/)) {
    return 'Move the opponent deep before using touch to finish.';
  }
  if (hasNet) {
    return 'Draw a short reply before moving forward to finish.';
  }
  if (hasGroundstroke && has(/forehand/) && has(/backhand/)) {
    return 'Use the stronger wing to open the court, then change direction when balanced.';
  }
  if (has(/forehand/)) {
    return 'Build through the forehand, then attack a short reply.';
  }
  if (has(/backhand/)) {
    return 'Use backhand depth to absorb pace and redirect when the court opens.';
  }
  if (has(/counter/) && hasMovement) {
    return 'Recover through the middle, then turn incoming pace into an attack.';
  }
  if (hasMovement) {
    return 'Recover between shots and wait for a shorter reply before accelerating.';
  }
  if (has(/precision/)) {
    return 'Open the court with measured direction changes before attempting a sharper angle.';
  }
  if (has(/topspin/)) {
    return 'Use extra shape when you need net clearance or a heavier bounce.';
  }
  return 'Use these strengths to open the court before forcing a finish.';
}

function hasGeneratedSelectionTemplate(value) {
  return /\bsuits\s+[^.]+\.\s+Use this character to\s+.+\.?$/i.test(value);
}

function styleFromSelectionTemplate(name, value) {
  const prefix = `${name} (`;
  if (!value.startsWith(prefix)) return '';
  const styleEnd = value.indexOf(') suits ', prefix.length);
  return styleEnd > prefix.length ? value.slice(prefix.length, styleEnd).trim() : '';
}

function buildDistinctiveSummary(name, guidance, stats) {
  const attributes = distinctSummaryAttributes(guidance, stats);
  if (!attributes.length) return '';

  const labels = attributes.map(summaryAttributeLabel);
  const style = styleFromSelectionTemplate(name, guidanceText(guidance?.why_select));
  const lead = style
    ? `${name} (${style}) stands out for ${joinSummaryLabels(labels)}.`
    : `${name} stands out for ${joinSummaryLabels(labels)}.`;
  return `${lead} ${summaryTacticalCue(attributes)}`;
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
  const whyNotSelect = normalizeCharacterCopy(
    guidanceText(guidance.why_not_select || guidance.tradeoff),
  );

  if (whySelect) {
    if (hasGeneratedSelectionTemplate(whySelect)) {
      const distinctiveSummary = buildDistinctiveSummary(
        name,
        guidance,
        stats,
      );
      if (distinctiveSummary) return distinctiveSummary;
    }
    return whySelect;
  }

  const bestFor = normalizeCharacterCopy(guidanceText(guidance.best_for));
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

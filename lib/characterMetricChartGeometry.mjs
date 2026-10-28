export const NORMALIZED_DOMAIN = Object.freeze({ min: -10, max: 110 });
export const DEFAULT_RADAR_METRICS = Object.freeze([
  'Forehand Rating',
  'Backhand Rating',
  'Serve Rating',
]);
export const MIN_RADAR_METRICS = 3;
export const MAX_RADAR_METRICS = 6;

export function toggleRadarMetricSelection(
  current,
  metricName,
  checked,
  availableMetrics,
  maximum = MAX_RADAR_METRICS,
) {
  if (!Array.isArray(current) || !Array.isArray(availableMetrics)) return [];
  const available = new Set(availableMetrics);
  const selected = [...new Set(current)].filter((name) => available.has(name));
  if (!available.has(metricName)) return selected;

  if (checked) {
    if (selected.includes(metricName) || selected.length >= maximum) return selected;
    return [...selected, metricName];
  }

  if (!selected.includes(metricName)) return selected;
  return selected.filter((name) => name !== metricName);
}

export function axisTicks(domain, normalized) {
  if (
    normalized
    && domain.min === NORMALIZED_DOMAIN.min
    && domain.max === NORMALIZED_DOMAIN.max
  ) {
    return [-10, 0, 20, 40, 60, 80, 100, 110];
  }

  return Array.from({ length: 5 }, (_, index) =>
    domain.min + ((domain.max - domain.min) * index) / 4,
  );
}

export function tooltipPosition({
  x,
  y,
  width,
  height,
  viewportWidth,
  viewportHeight,
  padding = 8,
  gap = 10,
}) {
  const maxLeft = Math.max(padding, viewportWidth - width - padding);
  const left = Math.max(padding, Math.min(x - width / 2, maxLeft));
  const maxTop = Math.max(padding, viewportHeight - height - padding);
  const above = y - height - gap;
  const top = above >= padding
    ? above
    : Math.max(padding, Math.min(y + gap, maxTop));

  return { left, top };
}

export function radarProfileValues(characters, selectedCharacter, metricNames) {
  if (!Array.isArray(characters) || !selectedCharacter || !Array.isArray(metricNames)) {
    return [];
  }

  const selectedName = String(selectedCharacter).trim().toLocaleLowerCase();
  const character = characters.find(
    (row) => String(row?.character ?? '').trim().toLocaleLowerCase() === selectedName,
  );
  if (!character?.metrics || typeof character.metrics !== 'object') return [];

  return [...new Set(metricNames)].flatMap((name) => {
    const readValue = (row) => {
      const value = row?.metrics?.[name];
      if (value === null || value === undefined || value === '') return null;
      const number = Number(value);
      return Number.isFinite(number) ? number : null;
    };
    const value = readValue(character);
    if (value === null) return [];

    const rosterValues = characters
      .map(readValue)
      .filter((item) => item !== null);
    if (!rosterValues.length) return [];

    const minimum = Math.min(...rosterValues);
    const maximum = Math.max(...rosterValues);
    const score = maximum === minimum
      ? 50
      : ((value - minimum) / (maximum - minimum)) * 100;
    return [{ name, value, score }];
  });
}

export function radarCoordinates(values, centerX, centerY, radius) {
  if (!Array.isArray(values) || values.length < 3) return [];
  const scores = values.map(Number);
  if (scores.some((score) => !Number.isFinite(score))) return [];

  return scores.map((score, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / scores.length;
    const distance = radius * Math.max(0, Math.min(100, score)) / 100;
    return {
      x: centerX + Math.cos(angle) * distance,
      y: centerY + Math.sin(angle) * distance,
    };
  });
}

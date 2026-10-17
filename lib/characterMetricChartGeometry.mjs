export const NORMALIZED_DOMAIN = Object.freeze({ min: -10, max: 110 });

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

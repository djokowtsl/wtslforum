export const NORMALIZED_DOMAIN: Readonly<{ min: number; max: number }>;

export function axisTicks(
  domain: { min: number; max: number },
  normalized: boolean,
): number[];

export function tooltipPosition({
  x,
  y,
  width,
  height,
  viewportWidth,
  viewportHeight,
  padding,
  gap,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
  padding?: number;
  gap?: number;
}): { left: number; top: number };

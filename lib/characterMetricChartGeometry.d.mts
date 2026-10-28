export const NORMALIZED_DOMAIN: Readonly<{ min: number; max: number }>;
export const DEFAULT_RADAR_METRICS: readonly string[];
export const MIN_RADAR_METRICS: number;
export const MAX_RADAR_METRICS: number;

export function toggleRadarMetricSelection(
  current: string[],
  metricName: string,
  checked: boolean,
  availableMetrics: string[],
  maximum?: number,
): string[];

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

export function radarProfileValues(
  characters: Array<{
    character?: string | null;
    metrics?: Record<string, unknown>;
  }>,
  selectedCharacter: string,
  metricNames: string[],
): Array<{ name: string; value: number; score: number }>;

export function radarCoordinates(
  values: number[],
  centerX: number,
  centerY: number,
  radius: number,
): Array<{ x: number; y: number }>;

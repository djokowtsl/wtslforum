export function normalizeCharacterCopy(value: unknown): string;
export function cleanCharacterGuidance(value: unknown): string;
export function cleanCharacterMechanic(value: unknown, character?: unknown): string;
export function buildCounterInsight(profile: unknown): string;
export function buildShotVarietyInsight(profile: unknown): string;
export function buildServeInsight(profile: unknown, fallbackText?: unknown): string;
export function buildGroundstrokeInsight(profile: unknown, fallbackText?: unknown): string;
export function buildNetPlayInsight(stats: unknown, fallbackText?: unknown): string;
export function buildCourtSpeedInsight(stats: unknown, fallbackText?: unknown): string;
export function cleanSizeReachInsight(value: unknown): string;
export function buildGamePlanSteps(value: unknown, acceleration?: unknown): string[];
export function splitRosterEvidenceNotes(
  stats: Array<{ attribute?: string }>,
  notes: unknown,
  excludedText?: unknown,
): {
  edgeNotes: Map<string, string>;
  additionalNotes: Array<{ name: string; description: string }>;
};

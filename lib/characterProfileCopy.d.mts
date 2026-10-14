export function normalizeCharacterCopy(value: unknown): string;
export function cleanCharacterMechanic(value: unknown, character?: unknown): string;
export function cleanCounterInsight(value: unknown): string;
export function cleanShotVarietyInsight(value: unknown): string;
export function cleanNetInsight(value: unknown): string;
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

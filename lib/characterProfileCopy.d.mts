export function normalizeCharacterCopy(value: unknown): string;
export function cleanCharacterGuidance(value: unknown): string;
export function cleanRallyFit(value: unknown): string;
export function cleanCharacterMechanic(value: unknown, character?: unknown): string;
export function buildCounterInsight(profile: unknown): string;
export function buildShotVarietyInsight(profile: unknown): string;
export function buildServeInsight(profile: unknown, fallbackText?: unknown): string;
export function buildGroundstrokeInsight(profile: unknown, fallbackText?: unknown): string;
export function buildPhysicalInsight(profile: unknown): string;
export function buildNetPlayInsight(profile: unknown): string;
export function buildCourtSpeedInsight(profile: unknown, style?: unknown): string;
export function cleanSizeReachInsight(value: unknown): string;
export function buildGamePlanSteps(value: unknown, acceleration?: unknown, stats?: unknown): string[];
export function splitRosterEvidenceNotes(
  stats: Array<{ attribute?: string }>,
  notes: unknown,
  excludedText?: unknown,
): {
  edgeNotes: Map<string, string>;
  additionalNotes: Array<{ name: string; description: string }>;
};

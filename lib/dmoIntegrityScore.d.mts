export type DmoIntegrityLevel = 'high' | 'medium' | 'weak' | 'none';

export const DMO_INTEGRITY_ANALYZER_VERSION: string;
export const DMO_INTEGRITY_LEVELS: Record<DmoIntegrityLevel, { label: string; toolGrade: string; rank: number }>;

export type DmoIntegrityPlayerSummary = {
  name: string;
  longPreparations: number;
  shortGapPreparations: number;
  repeatedGapPreparations: number;
  repeatedGapShare: number;
  flaggedWindows: number;
  weakWindows: number;
  intermediateWindows: number;
  convergingWindows: number;
  recordedPlateaus: number;
  recordedCheckedPassages: number;
  recordedConfirmedPassages: number;
  strongPassagesChecked: number;
  strongPassagesConfirmed: number;
  aimGaps: number;
  moveGaps: number;
  changesPer100s: number;
  impactShots: number;
  impactMedianCm: number | null;
};

export type DmoIntegrityPassage = {
  player: number;
  point: number;
  score: string;
  matchTimeSeconds: number;
  intoPointSeconds: number | null;
  durationSeconds: number;
  strength: number;
  methods: string[];
  recordedAim: { minCm: number; maxCm: number; medianCm: number; plateau: boolean } | null;
};

export type DmoIntegritySummary = {
  version: string;
  match: {
    names: string[];
    finalScore: string;
    points: number;
    frames: number;
    durationSeconds: number;
    build: string;
    format: number;
    lagFrames: number;
    fps: number;
    recordedCoverage: number;
    impactAvailable: boolean;
  };
  players: DmoIntegrityPlayerSummary[];
  passages: DmoIntegrityPassage[];
};

export type DmoIntegrityPlayerAssessment = {
  player: number;
  name: string;
  level: DmoIntegrityLevel;
  score: number;
  reasons: string[];
};

export type DmoIntegrityAssessment = {
  level: DmoIntegrityLevel;
  score: number;
  flaggedPlayers: number[];
  players: DmoIntegrityPlayerAssessment[];
};

export function summarizeAnalyzerRun(input: {
  demo: unknown;
  timing: unknown;
  analysis: unknown;
  impact?: unknown;
}): DmoIntegritySummary;
export function assessPlayer(
  own: Pick<DmoIntegrityPlayerSummary, 'convergingWindows' | 'intermediateWindows' | 'weakWindows'>,
): Omit<DmoIntegrityPlayerAssessment, 'player' | 'name'>;
export function assessDmoIntegrity(summary: DmoIntegritySummary): DmoIntegrityAssessment;
export function compareIntegrityScans(
  a: { status: string; level?: string | null; score?: number | null; submissionDate?: string | null },
  b: { status: string; level?: string | null; score?: number | null; submissionDate?: string | null },
): number;

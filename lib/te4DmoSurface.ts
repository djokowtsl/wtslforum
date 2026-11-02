import type { Te4CourtSurface } from './te4DmoTypes';

const tournamentSurfaceRules: Array<{ surface: Exclude<Te4CourtSurface, 'unknown'>; patterns: RegExp[] }> = [
  {
    surface: 'grass',
    patterns: [
      /\bgrass\b/i,
      /\blawn\b/i,
      /\bwimbledon\b/i,
      /\bqueen['’]s(?: club)?\b/i,
      /\bhalle\b/i,
      /\beastbourne\b/i,
      /\bmallorca\b/i,
      /\bnottingham\b/i,
      /\bsurbiton\b/i,
      /\bnewport\b/i,
      /\bbad homburg\b/i,
      /\blibema\b/i,
      /\bstuttgart atp\b/i,
      /\bberlin open\b/i,
    ],
  },
  {
    surface: 'clay',
    patterns: [
      /\bclay\b/i,
      /\bterre battue\b/i,
      /\broland garros\b/i,
      /\bfrench open\b/i,
      /\b(?:philippe|phillipe)\s+(?:chatrier|chartrier)\b/i,
      /\bmonte[- ]carlo\b/i,
      /\binternazionali d['’]italia\b/i,
      /\bitalian open\b/i,
      /\brome(?: open| masters)?\b/i,
      /\bmadrid(?: open| masters)?\b/i,
      /\bbarcelona(?: open)?\b/i,
      /\bhamburg(?: european)?(?: open)?\b/i,
      /\bcharleston(?: open)?\b/i,
      /\bestoril\b/i,
      /\bmarrakech\b/i,
      /\bbastad\b/i,
      /\bgstaad\b/i,
      /\bkitzb[uü]hel\b/i,
      /\bumag\b/i,
      /\bgeneva open\b/i,
      /\blyon open\b/i,
      /\bstuttgart wta\b/i,
      /\bbuenos aires(?: open)?\b/i,
      /\brio open\b/i,
      /\bsantiago open\b/i,
      /\bc[oó]rdoba open\b/i,
    ],
  },
  {
    surface: 'hard',
    patterns: [
      /\bhard(?:court)?\b/i,
      /\baustralian open\b/i,
      /\bao rod laver\b/i,
      /\brod laver day\b/i,
      /\bus open\b/i,
      /\blaver cup\b/i,
      /\btokyo\b/i,
      /\bindian wells\b/i,
      /\bbnp paribas open\b/i,
      /\bmiami open\b/i,
      /\bcincinnati\b/i,
      /\bcanadian open\b/i,
      /\bcanada masters\b/i,
      /\bmontreal\b/i,
      /\btoronto\b/i,
      /\bshanghai\b/i,
      /\bparis[- ]bercy\b/i,
      /\bparis masters\b/i,
      /\batp finals\b/i,
      /\bdubai open\b/i,
      /\bqatar open\b/i,
      /\bdoha\b/i,
      /\brotterdam\b/i,
      /\bbeijing\b/i,
      /\bacapulco\b/i,
      /\bwashington\b/i,
      /\batlanta\b/i,
      /\bvienna\b/i,
      /\bbasel\b/i,
      /\bmoscow\b/i,
      /\bstockholm\b/i,
      /\bmetz\b/i,
      /\bantwerp\b/i,
      /\bsydney\b/i,
      /\bbrisbane\b/i,
      /\bauckland\b/i,
      /\badelaide\b/i,
      /\bunited cup\b/i,
    ],
  },
];

function normalizeTournamentName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^\s*\d{3,4}\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function displayDmoTournamentName(value: string | null): string {
  if (!value) return 'Tournament not recorded in DMO';
  return value.replace(/^\s*\d{3,4}\s+/, '').trim() || 'Tournament not recorded in DMO';
}

export function surfaceForDmoTournament(value: string | null): Te4CourtSurface {
  if (!value) return 'unknown';
  const tournament = normalizeTournamentName(value);
  for (const rule of tournamentSurfaceRules) {
    if (rule.patterns.some((pattern) => pattern.test(tournament))) return rule.surface;
  }
  return 'unknown';
}

export function courtSurfaceDisplayName(surface: Te4CourtSurface): string {
  return surface === 'unknown' ? 'SURFACE UNKNOWN' : `${surface.toUpperCase()} COURT`;
}

/** Decorative venue treatment; never changes the recorded surface or ball physics. */
export function isIndoorDmoVenue(stadium: string | null | undefined): boolean {
  return /\b(indoor|bercy|paris masters|atp finals|rotterdam|vienna|basel|stockholm|metz|antwerp)\b/i
    .test(stadium ?? '');
}

export function courtSurfaceSoundProfile(surface: Te4CourtSurface) {
  const profiles = {
    clay: {
      stepNoiseHz: 420,
      slideNoiseHz: 650,
      stepToneHz: [88, 48],
      slideToneHz: [820, 390],
      slideToneGain: 0.0055,
      racketHz: [650, 240],
      racketGain: 0.078,
      racketDuration: 0.085,
      bounceHz: [310, 125],
      bounceGain: 0.056,
      bounceDuration: 0.16,
    },
    grass: {
      stepNoiseHz: 320,
      slideNoiseHz: 430,
      stepToneHz: [72, 40],
      slideToneHz: [650, 310],
      slideToneGain: 0.0045,
      racketHz: [680, 250],
      racketGain: 0.08,
      racketDuration: 0.08,
      bounceHz: [270, 120],
      bounceGain: 0.05,
      bounceDuration: 0.15,
    },
    hard: {
      stepNoiseHz: 850,
      slideNoiseHz: 1_250,
      stepToneHz: [125, 60],
      slideToneHz: [1_950, 1_250],
      slideToneGain: 0.009,
      racketHz: [800, 270],
      racketGain: 0.09,
      racketDuration: 0.07,
      bounceHz: [510, 180],
      bounceGain: 0.08,
      bounceDuration: 0.1,
    },
    unknown: {
      stepNoiseHz: 600,
      slideNoiseHz: 800,
      stepToneHz: [105, 58],
      slideToneHz: [1_100, 580],
      slideToneGain: 0.0065,
      racketHz: [720, 260],
      racketGain: 0.085,
      racketDuration: 0.075,
      bounceHz: [390, 150],
      bounceGain: 0.072,
      bounceDuration: 0.12,
    },
  } satisfies Record<Te4CourtSurface, {
    stepNoiseHz: number;
    slideNoiseHz: number;
    stepToneHz: [number, number];
    slideToneHz: [number, number];
    slideToneGain: number;
    racketHz: [number, number];
    racketGain: number;
    racketDuration: number;
    bounceHz: [number, number];
    bounceGain: number;
    bounceDuration: number;
  }>;
  return profiles[surface];
}

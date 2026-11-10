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

export type CourtSurfaceVisualProfile = {
  playing: string;
  runoff: string;
  stadiumApron: string;
  practiceApron: string;
};

const courtSurfaceVisualProfiles: Record<Te4CourtSurface, CourtSurfaceVisualProfile> = {
  hard: {
    playing: '#2878aa',
    runoff: '#3d718b',
    stadiumApron: '#263752',
    practiceApron: '#d4dce8',
  },
  clay: {
    playing: '#b96045',
    runoff: '#914c3c',
    stadiumApron: '#353d4c',
    practiceApron: '#ebe1d7',
  },
  grass: {
    playing: '#477644',
    runoff: '#355d3a',
    stadiumApron: '#2e3d4b',
    practiceApron: '#e0e6dc',
  },
  unknown: {
    playing: '#68788a',
    runoff: '#526273',
    stadiumApron: '#2a3a52',
    practiceApron: '#e0e6ec',
  },
};

export function courtSurfaceVisualProfile(surface: Te4CourtSurface): CourtSurfaceVisualProfile {
  return courtSurfaceVisualProfiles[surface];
}

/** Decorative venue treatment; never changes the recorded surface or ball physics. */
export function isIndoorDmoVenue(stadium: string | null | undefined): boolean {
  const name = (stadium ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[_-]+/g, ' ');
  return /\b(indoors?|bercy|paris masters|atp finals|rotterdam|vienna|basel|stockholm|metz|antwerp|swiss indoors|erste bank|wiener stadthalle|st\.? jakobshalle)\b/i
    .test(name);
}

export function courtSurfaceSoundProfile(surface: Te4CourtSurface) {
  const profiles = {
    clay: {
      stepNoiseHz: 420,
      stepToneHz: [88, 48],
      racketHz: [650, 240],
      racketGain: 0.078,
      racketDuration: 0.085,
      bounceHz: [310, 125],
      bounceGain: 0.056,
      bounceDuration: 0.16,
    },
    grass: {
      stepNoiseHz: 320,
      stepToneHz: [72, 40],
      racketHz: [680, 250],
      racketGain: 0.08,
      racketDuration: 0.08,
      bounceHz: [270, 120],
      bounceGain: 0.05,
      bounceDuration: 0.15,
    },
    hard: {
      stepNoiseHz: 850,
      stepToneHz: [125, 60],
      racketHz: [800, 270],
      racketGain: 0.09,
      racketDuration: 0.07,
      bounceHz: [510, 180],
      bounceGain: 0.08,
      bounceDuration: 0.1,
    },
    unknown: {
      stepNoiseHz: 600,
      stepToneHz: [105, 58],
      racketHz: [720, 260],
      racketGain: 0.085,
      racketDuration: 0.075,
      bounceHz: [390, 150],
      bounceGain: 0.072,
      bounceDuration: 0.12,
    },
  } satisfies Record<Te4CourtSurface, {
    stepNoiseHz: number;
    stepToneHz: [number, number];
    racketHz: [number, number];
    racketGain: number;
    racketDuration: number;
    bounceHz: [number, number];
    bounceGain: number;
    bounceDuration: number;
  }>;
  return profiles[surface];
}

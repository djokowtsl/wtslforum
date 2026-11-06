export type DmoVenueProfile = {
  label: string;
  capacity: number;
  upperRows: number;
  tierRows: number;
};

const venueReferences: Array<{ label: string; capacity: number; matches: RegExp[] }> = [
  // Published capacities: Arthur Ashe 23,771; Wimbledon Centre Court 14,979;
  // Philippe-Chatrier 15,000; Delray Beach Tennis Center 8,200.
  { label: 'Louis Armstrong Stadium', capacity: 14_000, matches: [/\blouis armstrong\b/i] },
  { label: 'Arthur Ashe Stadium', capacity: 23_771, matches: [/\barthur ashe\b/i, /\bus open\b/i, /\bflushing meadows\b/i] },
  { label: 'Wimbledon No. 1 Court', capacity: 12_345, matches: [/\bwimbledon.*(?:no\.?\s*1|court\s*1)\b/i, /\bno\.?\s*1 court\b/i] },
  { label: 'Wimbledon Centre Court', capacity: 14_979, matches: [/\bwimbledon\b/i, /\bcentre court\b/i, /\bcenter court\b/i] },
  { label: 'Suzanne Lenglen Court', capacity: 10_068, matches: [/\bsuzanne lenglen\b/i] },
  { label: 'Philippe-Chatrier Court', capacity: 15_000, matches: [/\bphilippe[- ]chatrier\b/i, /\broland[- ]garros\b/i, /\bfrench open\b/i] },
  { label: 'Rod Laver Arena', capacity: 14_820, matches: [/\brod laver\b/i, /\baustralian open\b/i] },
  { label: 'Indian Wells Stadium 1', capacity: 16_100, matches: [/\bindian wells\b/i, /\bbnp paribas open\b/i] },
  { label: 'Delray Beach Tennis Center', capacity: 8_200, matches: [/\bdelray\b/i] },
  { label: 'ATP Finals arena', capacity: 17_500, matches: [/\batp finals\b/i, /\bnitto finals\b/i, /\bo2 arena\b/i] },
  { label: 'Paris indoor arena', capacity: 15_000, matches: [/\bbercy\b/i, /\bparis masters\b/i] },
];

function normalizeVenue(value: string) {
  return value.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^\s*\d{3,4}\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function profile(label: string, capacity: number, fallbackRows?: number): DmoVenueProfile {
  const upperRows = fallbackRows ?? Math.max(6, Math.min(18, Math.round(capacity / 1_300)));
  return {
    label,
    capacity,
    upperRows,
    tierRows: Math.max(2, Math.round(upperRows / 3)),
  };
}

/** Venue scale affects the decorative bowl only, never court or ball dimensions. */
export function resolveDmoVenueProfile(value: string | null | undefined): DmoVenueProfile {
  const normalized = normalizeVenue(value ?? '');
  const venue = venueReferences.find((candidate) => candidate.matches.some((pattern) => pattern.test(normalized)));
  // Keep the previous full bowl when a replay has no venue metadata; do not
  // invent a capacity for it. Known venue data scales the bowl down or up.
  return venue ? profile(venue.label, venue.capacity) : profile('Unspecified tennis venue', 0, 18);
}

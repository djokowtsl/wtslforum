export type DmoVenueProfile = {
  label: string;
  /** City lettering shown beside the court; absent when the location is ambiguous. */
  cityLabel?: string;
  /** Real venue has no city lettering painted on the court. */
  hideCourtCityLabel?: boolean;
  capacity: number;
  upperRows: number;
  tierRows: number;
};

const venueReferences: Array<{ label: string; cityLabel?: string; capacity: number; matches: RegExp[] }> = [
  // Published capacities: Arthur Ashe 23,771; Wimbledon Centre Court 14,979;
  // Philippe-Chatrier 15,000; Delray Beach Tennis Center 8,200.
  { label: 'Louis Armstrong Stadium', cityLabel: 'NEW YORK', capacity: 14_000, matches: [/\blouis armstrong\b/i] },
  { label: 'Arthur Ashe Stadium', cityLabel: 'NEW YORK', capacity: 23_771, matches: [/\barthur ashe\b/i, /\bus open\b/i, /\bflushing meadows\b/i] },
  { label: 'Wimbledon No. 1 Court', cityLabel: 'LONDON', capacity: 12_345, matches: [/\bwimbledon.*(?:no\.?\s*1|court\s*1)\b/i, /\bno\.?\s*1 court\b/i] },
  { label: 'Wimbledon Centre Court', cityLabel: 'LONDON', capacity: 14_979, matches: [/\bwimbledon\b/i, /\bcentre court\b/i, /\bcenter court\b/i] },
  { label: 'Suzanne Lenglen Court', cityLabel: 'PARIS', capacity: 10_068, matches: [/\bsuzanne lenglen\b/i] },
  { label: 'Philippe-Chatrier Court', cityLabel: 'PARIS', capacity: 15_000, matches: [/\bphilippe[- ]chatrier\b/i, /\broland[- ]garros\b/i, /\bfrench open\b/i] },
  { label: 'Rod Laver Arena', cityLabel: 'MELBOURNE', capacity: 14_820, matches: [/\brod laver\b/i, /\baustralian open\b/i] },
  { label: 'Indian Wells Stadium 1', cityLabel: 'INDIAN WELLS', capacity: 16_100, matches: [/\bindian wells\b/i, /\bbnp paribas open\b/i] },
  { label: 'Delray Beach Tennis Center', cityLabel: 'DELRAY BEACH', capacity: 8_200, matches: [/\bdelray\b/i] },
  // The ATP Finals move between cities; only print a city when the source names it.
  { label: 'ATP Finals arena', capacity: 17_500, matches: [/\batp finals\b/i, /\bnitto finals\b/i, /\bo2 arena\b/i] },
  { label: 'Paris indoor arena', cityLabel: 'PARIS', capacity: 15_000, matches: [/\bbercy\b/i, /\bparis masters\b/i] },
];

/** City aliases for tour events whose source name does not include a stadium. */
const cityReferences: Array<{ cityLabel: string; matches: RegExp[] }> = [
  { cityLabel: 'VIENNA', matches: [/\bvienna\b/i, /\bwien\b/i, /\bwiener stadthalle\b/i, /\berste bank open\b/i] },
  { cityLabel: 'LONDON', matches: [/\blondon\b/i, /\bqueen['’]?s(?: club)?\b/i, /\bo2 arena\b/i] },
  { cityLabel: 'NEW YORK', matches: [/\bnew york\b/i, /\bflushing meadows\b/i] },
  { cityLabel: 'PARIS', matches: [/\bparis\b/i, /\broland[- ]garros\b/i, /\bfrench open\b/i, /\bbercy\b/i] },
  { cityLabel: 'MELBOURNE', matches: [/\bmelbourne\b/i, /\baustralian open\b/i, /\brod laver\b/i] },
  { cityLabel: 'INDIAN WELLS', matches: [/\bindian wells\b/i, /\bbnp paribas open\b/i] },
  { cityLabel: 'DELRAY BEACH', matches: [/\bdelray beach\b/i] },
  { cityLabel: 'TURIN', matches: [/\bturin\b/i, /\btorino\b/i] },
  { cityLabel: 'SHANGHAI', matches: [/\bshanghai\b/i] },
  { cityLabel: 'ADELAIDE', matches: [/\badelaide\b/i] },
  { cityLabel: 'AUCKLAND', matches: [/\bauckland\b/i] },
  { cityLabel: 'BRISBANE', matches: [/\bbrisbane\b/i] },
  { cityLabel: 'SYDNEY', matches: [/\bsydney\b/i] },
  { cityLabel: 'HOBART', matches: [/\bhobart\b/i] },
  { cityLabel: 'MIAMI', matches: [/\bmiami\b/i] },
  { cityLabel: 'DOHA', matches: [/\bdoha\b/i, /\bqatar open\b/i] },
  { cityLabel: 'DUBAI', matches: [/\bdubai\b/i] },
  { cityLabel: 'ABU DHABI', matches: [/\babu dhabi\b/i, /\bmubadala\b/i] },
  { cityLabel: 'ROTTERDAM', matches: [/\brotterdam\b/i, /\babn amro\b/i] },
  { cityLabel: 'MONTE CARLO', matches: [/\bmonte[- ]carlo\b/i, /\bmonaco\b/i] },
  { cityLabel: 'MADRID', matches: [/\bmadrid\b/i] },
  { cityLabel: 'ROME', matches: [/\brome\b/i, /\binternazionali d['’]italia\b/i, /\bitalian open\b/i] },
  { cityLabel: 'BARCELONA', matches: [/\bbarcelona\b/i] },
  { cityLabel: 'HAMBURG', matches: [/\bhamburg\b/i] },
  { cityLabel: 'CHARLESTON', matches: [/\bcharleston\b/i] },
  { cityLabel: 'STUTTGART', matches: [/\bstuttgart\b/i] },
  { cityLabel: 'MUNICH', matches: [/\bmunich\b/i, /\bbmw open\b/i] },
  { cityLabel: 'MARSEILLE', matches: [/\bmarseille\b/i] },
  { cityLabel: 'HOUSTON', matches: [/\bhouston\b/i] },
  { cityLabel: 'DALLAS', matches: [/\bdallas\b/i] },
  { cityLabel: 'AUSTIN', matches: [/\baustin\b/i] },
  { cityLabel: 'SAN DIEGO', matches: [/\bsan diego\b/i] },
  { cityLabel: 'OSTRAVA', matches: [/\bostrava\b/i] },
  { cityLabel: 'LUXEMBOURG', matches: [/\bluxembourg\b/i] },
  { cityLabel: 'ST PETERSBURG', matches: [/\bst\.?\s*petersburg\b/i] },
  { cityLabel: 'BELGRADE', matches: [/\bbelgrade\b/i] },
  { cityLabel: 'SOFIA', matches: [/\bsofia\b/i] },
  { cityLabel: 'ASTANA', matches: [/\bastana\b/i] },
  { cityLabel: 'ALMATY', matches: [/\balmaty\b/i] },
  { cityLabel: 'SHENZHEN', matches: [/\bshenzhen\b/i] },
  { cityLabel: 'ZHENGZHOU', matches: [/\bzhengzhou\b/i] },
  { cityLabel: 'ZHUHAI', matches: [/\bzhuhai\b/i] },
  { cityLabel: 'PORTOROZ', matches: [/\bportoro[zž]\b/i] },
  { cityLabel: 'TASHKENT', matches: [/\btashkent\b/i] },
  { cityLabel: 'BERLIN', matches: [/\bberlin\b/i] },
  { cityLabel: 'HALLE', matches: [/\bhalle\b/i, /\bterra wortmann\b/i, /\bgerry weber\b/i] },
  { cityLabel: 'EASTBOURNE', matches: [/\beastbourne\b/i] },
  { cityLabel: 'NOTTINGHAM', matches: [/\bnottingham\b/i] },
  { cityLabel: 'SURBITON', matches: [/\bsurbiton\b/i] },
  { cityLabel: 'SANTA PONSA', matches: [/\bmallorca\b/i, /\bsanta pon[cç]a\b/i] },
  { cityLabel: 'DEN BOSCH', matches: [/\blibema\b/i, /\brosmalen\b/i, /\bs.?hertogenbosch\b/i] },
  { cityLabel: 'NEWPORT', matches: [/\bnewport\b/i, /\bhall of fame tennis\b/i] },
  { cityLabel: 'BAD HOMBURG', matches: [/\bbad homburg\b/i] },
  { cityLabel: 'ESTORIL', matches: [/\bestoril\b/i] },
  { cityLabel: 'MARRAKECH', matches: [/\bmarrakech\b/i] },
  { cityLabel: 'BASTAD', matches: [/\bbastad\b/i] },
  { cityLabel: 'GSTAAD', matches: [/\bgstaad\b/i] },
  { cityLabel: 'KITZBUHEL', matches: [/\bkitzb[uü]hel\b/i] },
  { cityLabel: 'UMAG', matches: [/\bumag\b/i] },
  { cityLabel: 'GENEVA', matches: [/\bgeneva\b/i] },
  { cityLabel: 'LYON', matches: [/\blyon\b/i] },
  { cityLabel: 'BUENOS AIRES', matches: [/\bbuenos aires\b/i] },
  { cityLabel: 'RIO DE JANEIRO', matches: [/\brio de janeiro\b/i, /\brio open\b/i] },
  { cityLabel: 'SANTIAGO', matches: [/\bsantiago\b/i] },
  { cityLabel: 'CORDOBA', matches: [/\bcordoba\b/i] },
  { cityLabel: 'CINCINNATI', matches: [/\bcincinnati\b/i] },
  { cityLabel: 'MONTREAL', matches: [/\bmontreal\b/i] },
  { cityLabel: 'TORONTO', matches: [/\btoronto\b/i] },
  { cityLabel: 'TOKYO', matches: [/\btokyo\b/i] },
  { cityLabel: 'BEIJING', matches: [/\bbeijing\b/i] },
  { cityLabel: 'ACAPULCO', matches: [/\bacapulco\b/i] },
  { cityLabel: 'WASHINGTON, D.C.', matches: [/\bwashington\b/i] },
  { cityLabel: 'ATLANTA', matches: [/\batlanta\b/i] },
  { cityLabel: 'BASEL', matches: [/\bbasel\b/i] },
  { cityLabel: 'STOCKHOLM', matches: [/\bstockholm\b/i] },
  { cityLabel: 'METZ', matches: [/\bmetz\b/i] },
  { cityLabel: 'ANTWERP', matches: [/\bantwerp\b/i] },
  { cityLabel: 'MOSCOW', matches: [/\bmoscow\b/i] },
  { cityLabel: 'HONG KONG', matches: [/\bhong kong\b/i] },
  { cityLabel: 'SINGAPORE', matches: [/\bsingapore\b/i] },
  { cityLabel: 'RIYADH', matches: [/\briyadh\b/i] },
  { cityLabel: 'JEDDAH', matches: [/\bjeddah\b/i] },
  { cityLabel: 'SEOUL', matches: [/\bseoul\b/i] },
  { cityLabel: 'GUADALAJARA', matches: [/\bguadalajara\b/i] },
  { cityLabel: 'MONTERREY', matches: [/\bmonterrey\b/i] },
  { cityLabel: 'MERIDA', matches: [/\bmerida\b/i] },
  { cityLabel: 'CLEVELAND', matches: [/\bcleveland\b/i] },
  { cityLabel: 'WUHAN', matches: [/\bwuhan\b/i] },
  { cityLabel: 'NINGBO', matches: [/\bningbo\b/i] },
  { cityLabel: 'OSAKA', matches: [/\bosaka\b/i] },
  { cityLabel: 'LINZ', matches: [/\blinz\b/i] },
  { cityLabel: 'PRAGUE', matches: [/\bprague\b/i] },
  { cityLabel: 'STRASBOURG', matches: [/\bstrasbourg\b/i] },
  { cityLabel: 'LAUSANNE', matches: [/\blausanne\b/i] },
  { cityLabel: 'PALERMO', matches: [/\bpalermo\b/i] },
  { cityLabel: 'BUCHAREST', matches: [/\bbucharest\b/i] },
  { cityLabel: 'CLUJ-NAPOCA', matches: [/\bcluj\b/i] },
  { cityLabel: 'IASI', matches: [/\biasi\b/i] },
];

function normalizeVenue(value: string) {
  return value.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^\s*\d{3,4}\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function profile(label: string, capacity: number, fallbackRows?: number, cityLabel?: string): DmoVenueProfile {
  const upperRows = fallbackRows ?? Math.max(6, Math.min(18, Math.round(capacity / 1_300)));
  return {
    label,
    ...(cityLabel ? { cityLabel } : {}),
    capacity,
    upperRows,
    tierRows: Math.max(2, Math.round(upperRows / 3)),
  };
}

/** Venue scale affects the decorative bowl only, never court or ball dimensions. */
export function resolveDmoVenueProfile(value: string | null | undefined): DmoVenueProfile {
  const normalized = normalizeVenue(value ?? '');
  const venue = venueReferences.find((candidate) => candidate.matches.some((pattern) => pattern.test(normalized)));
  const cityLabel = cityReferences.find((candidate) => candidate.matches.some((pattern) => pattern.test(normalized)))
    ?.cityLabel ?? venue?.cityLabel;
  const hideCourtCityLabel = /\b(?:roland[- ]garros|french open|philippe[- ]chatrier|suzanne[- ]lenglen|simonne[- ]mathieu)\b/i.test(normalized);
  // Keep the previous full bowl when a replay has no venue metadata; do not
  // invent a capacity for it. Known venue data scales the bowl down or up.
  const resolved = venue
    ? profile(venue.label, venue.capacity, undefined, cityLabel)
    : profile('Unspecified tennis venue', 0, 18, cityLabel);
  return hideCourtCityLabel ? { ...resolved, hideCourtCityLabel: true } : resolved;
}

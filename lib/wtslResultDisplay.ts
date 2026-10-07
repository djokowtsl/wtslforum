type MatchRow = Record<string, unknown>;

const PLACEHOLDER_NAMES = new Set([
  'tbc',
  'tba',
  'tbd',
  'tobeconfirmed',
  'tobeannounced',
  'bye',
  'unknown',
]);

function text(value: unknown) {
  return value == null ? '' : String(value).trim();
}

function normalizeTournamentReference(value: unknown) {
  return text(value).toLowerCase();
}

/** Index canonical tournament names by both the forum key and WTSL's event ID. */
export function buildWtslTournamentNameLookup(tournaments: unknown[]) {
  const entries: Array<[string, string]> = [];
  for (const value of tournaments) {
    if (!value || typeof value !== 'object') continue;
    const row = value as MatchRow;
    const name = text(row.name);
    if (!name) continue;

    const references = [row.wtsl_tournament_key];
    try {
      const eventId = new URL(text(row.official_url)).searchParams.get('tournament');
      if (eventId) references.push(eventId);
    } catch {
      // A missing or malformed official URL does not prevent lookup by the forum key.
    }
    for (const reference of references) {
      const key = normalizeTournamentReference(reference);
      if (key) entries.push([key, name]);
    }
  }
  return Object.fromEntries(entries);
}

export function lookupWtslTournamentName(
  tournamentKey: unknown,
  names?: Record<string, string>,
) {
  const key = normalizeTournamentReference(tournamentKey);
  return key ? names?.[key] : undefined;
}

function normalizeName(value: unknown) {
  return text(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function isPlaceholder(value: unknown) {
  const normalized = normalizeName(value);
  return !normalized
    || PLACEHOLDER_NAMES.has(normalized)
    || /^(tbc|tba|tbd)\d*$/.test(normalized);
}

function normalizeDate(value: unknown) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const raw = text(value);
  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const dayFirst = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (dayFirst) {
    return `${dayFirst[3]}-${dayFirst[2].padStart(2, '0')}-${dayFirst[1].padStart(2, '0')}`;
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : '';
}

function normalizePlayedAt(value: unknown) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }
  const raw = text(value);
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(raw)) {
    const timestamp = Date.parse(raw);
    if (Number.isFinite(timestamp)) return new Date(timestamp).toISOString();
  }
  return normalizeDate(raw);
}

function normalizeTour(value: unknown) {
  const normalized = normalizeName(value);
  if (['atp', 'te4', 'atpcharacters'].includes(normalized)) return 'TE4';
  if (['wta', 'te4f', 'wtacharacters'].includes(normalized)) return 'TE4_(F)';
  return '';
}

function isOfficialWtslUrl(value: unknown) {
  try {
    const host = new URL(text(value)).hostname.toLowerCase();
    return host === 'playwtsl.com' || host.endsWith('.playwtsl.com');
  } catch {
    return false;
  }
}

function completedResult(value: unknown) {
  const result = text(value);
  if (!result || /\bscheduled\b|\btbc\b|\btbd\b/i.test(result)) return false;
  return /\d+\s*[-–]\s*\d+/.test(result)
    || /\bwalk.?over\b|\bret(?:ired)?\b|\bdefault\b/i.test(result);
}

function scoreIdentity(value: unknown) {
  const score = text(value);
  const sets = [...score.matchAll(/(\d+)\s*[-–]\s*(\d+)/g)].map((match) => {
    const left = Number(match[1]);
    const right = Number(match[2]);
    return `${Math.min(left, right)}-${Math.max(left, right)}`;
  });
  return sets.length ? sets.join(' ') : normalizeName(score);
}

function matchIdentity(
  tour: string,
  firstName: unknown,
  secondName: unknown,
  playedAt: unknown,
  score: unknown,
) {
  const names = [normalizeName(firstName), normalizeName(secondName)].sort();
  const date = normalizeDate(playedAt);
  const scoreKey = scoreIdentity(score);
  if (!date || !names[0] || !names[1] || !scoreKey) return '';
  return `${tour}|${date}|${names[0]}|${names[1]}|${scoreKey}`;
}

function validProfileRow(row: MatchRow, tour: string) {
  if (!text(row.source_id).startsWith('recent:')) return false;
  if (text(row.tour) !== tour) return false;
  if (isPlaceholder(row.player_one_name) || isPlaceholder(row.player_two_name)) return false;
  return Boolean(matchIdentity(
    tour,
    row.player_one_name,
    row.player_two_name,
    row.played_at,
    row.score,
  ));
}

function profileForName(profileRows: MatchRow[]) {
  const profiles = new Map<string, MatchRow>();
  const ambiguous = new Set<string>();
  const add = (
    name: unknown,
    id: unknown,
    avatar: unknown,
    flag: unknown,
    country: unknown,
  ) => {
    const key = normalizeName(name);
    if (!key || id == null || ambiguous.has(key)) return;
    const existing = profiles.get(key);
    if (existing && String(existing.id) !== String(id)) {
      profiles.delete(key);
      ambiguous.add(key);
      return;
    }
    profiles.set(key, { id, avatar, flag, country });
  };

  for (const row of profileRows) {
    if (!text(row.source_id).startsWith('recent:')) continue;
    add(row.player_one_name, row.player_one_id, row.player_one_avatar, row.player_one_flag, row.player_one_country);
    add(row.player_two_name, row.player_two_id, row.player_two_avatar, row.player_two_flag, row.player_two_country);
  }
  return profiles;
}

/** Combine the official WTSL cache with official profile rows; never admit imported match rows. */
export function buildPublicWtslResults(
  coreRows: unknown[],
  profileRows: unknown[],
  tour: string,
  limit: number,
) {
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 20;
  if (safeLimit === 0) return [];

  const profiles = profileForName(
    profileRows.filter((row): row is MatchRow => Boolean(row) && typeof row === 'object'),
  );
  const candidates: Array<{
    identity: string;
    priority: number;
    time: number;
    order: number;
    match: MatchRow;
  }> = [];

  profileRows.forEach((value, order) => {
    if (!value || typeof value !== 'object') return;
    const row = value as MatchRow;
    if (!validProfileRow(row, tour)) return;
    const identity = matchIdentity(
      tour,
      row.player_one_name,
      row.player_two_name,
      row.played_at,
      row.score,
    );
    candidates.push({
      identity,
      priority: 0,
      time: Date.parse(normalizeDate(row.played_at)),
      order,
      // WTSL player-profile result tables publish a date, not a finish time. Store it as
      // date-only so downstream display does not invent elapsed hours from midnight UTC.
      match: { ...row, played_at: normalizeDate(row.played_at) },
    });
  });

  coreRows.forEach((value, order) => {
    if (!value || typeof value !== 'object') return;
    const row = value as MatchRow;
    if (!isOfficialWtslUrl(row.source_url)) return;
    if (normalizeTour(row.tour) !== tour) return;

    const firstName = row.p1 ?? row.player1;
    const secondName = row.p2 ?? row.player2;
    const score = row.result ?? row.score;
    const playedAt = normalizePlayedAt(row.played_at ?? row.date);
    const playedDate = normalizeDate(playedAt);
    const tournamentName = text(row.tournament ?? row.tournament_name);
    if (
      isPlaceholder(firstName)
      || isPlaceholder(secondName)
      || !completedResult(score)
      || !playedDate
      || !tournamentName
    ) return;

    const identity = matchIdentity(tour, firstName, secondName, playedDate, score);
    if (!identity) return;
    const firstProfile = profiles.get(normalizeName(firstName));
    const secondProfile = profiles.get(normalizeName(secondName));
    const p1Id = row.player_one_id ?? row.p1_id ?? firstProfile?.id ?? null;
    const p2Id = row.player_two_id ?? row.p2_id ?? secondProfile?.id ?? null;
    const match: MatchRow = {
      id: `wtsl-site:${identity}`,
      tour,
      tournament_key: row.tournament_key ?? null,
      tournament_name: tournamentName,
      round_name: text(row.round ?? row.round_name) || null,
      player_one_id: p1Id,
      player_one_name: text(firstName),
      player_one_avatar: row.player_one_avatar ?? firstProfile?.avatar ?? null,
      player_one_flag: row.player_one_flag ?? firstProfile?.flag ?? null,
      player_one_country: row.player_one_country ?? firstProfile?.country ?? null,
      player_two_id: p2Id,
      player_two_name: text(secondName),
      player_two_avatar: row.player_two_avatar ?? secondProfile?.avatar ?? null,
      player_two_flag: row.player_two_flag ?? secondProfile?.flag ?? null,
      player_two_country: row.player_two_country ?? secondProfile?.country ?? null,
      score: text(score),
      played_at: playedAt,
      winner_id: row.winner_id ?? null,
      source_id: 'wtsl-site-cache',
    };

    // Prefer the profile-page label and database-backed card when both WTSL sources report a match.
    const sourcePriority = text(row.source_url).includes('player_page.php') ? 1 : 2;
    candidates.push({
      identity,
      priority: sourcePriority,
      time: Date.parse(playedAt),
      order,
      match,
    });
  });

  candidates.sort(
    (left, right) =>
      right.time - left.time
      || left.priority - right.priority
      || left.order - right.order,
  );

  const seen = new Set<string>();
  const matches: MatchRow[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.identity)) continue;
    seen.add(candidate.identity);
    matches.push(candidate.match);
    if (matches.length >= safeLimit) break;
  }
  return matches;
}

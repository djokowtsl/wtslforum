type FixtureRef = {
  first_id?: string | number | null;
  second_id?: string | number | null;
  tour?: string | null;
  tournament?: string | null;
  tournament_id?: string | number | null;
  round_deadline?: string | Date | null;
};

type TournamentRecord = {
  tour?: string | null;
  name?: string | null;
  status?: string | null;
  start_date?: string | Date | null;
  official_url?: string | null;
};

type TournamentOrder = {
  statusRank: number;
  startTime: number | null;
};

function normalizeTour(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}

function normalizeTournamentName(value: unknown) {
  return String(value ?? '')
    .trim()
    .replace(/\s+\([^)]*\)\s*$/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function fixtureKey(tour: unknown, value: unknown) {
  const normalizedTour = normalizeTour(tour);
  const normalizedValue = String(value ?? '').trim().toLowerCase();
  return normalizedTour && normalizedValue
    ? `${normalizedTour}|${normalizedValue}`
    : null;
}

function officialTournamentId(value: unknown) {
  if (!value) return null;
  try {
    return new URL(
      String(value),
      'https://www.playwtsl.com',
    ).searchParams.get('tournament');
  } catch {
    return null;
  }
}

function normalizeExactTournamentName(value: unknown) {
  return String(value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

const ROUND_SUFFIX = /\s+\((R\d+|QF|SF|F)\)\s*$/i;

function tournamentBaseAndRoundCount(value: unknown) {
  let name = String(value ?? '').trim();
  let roundCount = 0;
  let roundLabel: string | null = null;
  while (ROUND_SUFFIX.test(name)) {
    const match = name.match(ROUND_SUFFIX);
    if (!match) break;
    roundLabel ??= match[1].toUpperCase();
    name = name.replace(ROUND_SUFFIX, '').trim();
    roundCount += 1;
  }
  return {
    baseName: normalizeExactTournamentName(name),
    roundCount,
    roundLabel,
  };
}

function comparableDeadline(value: unknown) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? raw.toLowerCase() : String(parsed);
}

/**
 * Hide stale copies where the schedule feed and official tournament directory
 * label the same round fixture differently.
 *
 * Only collapse rows with the same official event, player IDs, deadline and
 * round. Keep the row with fewer appended round labels; other markets,
 * including the same players in a different event or at a different deadline,
 * remain visible.
 */
export function deduplicateRedundantRoundFixtures<T extends FixtureRef>(
  fixtures: T[],
  tournaments: TournamentRecord[],
): T[] {
  const eventNames = new Map<string, Set<string>>();
  const events: Array<{ tour: string; id: string; name: string }> = [];
  for (const tournament of tournaments) {
    const id = officialTournamentId(tournament.official_url);
    const tour = normalizeTour(tournament.tour);
    const name = normalizeExactTournamentName(tournament.name);
    if (!id || !tour || !name) continue;
    const eventKey = `${tour}|${id}`;
    const names = eventNames.get(eventKey) ?? new Set<string>();
    names.add(name);
    eventNames.set(eventKey, names);
    if (!events.some((event) => event.tour === tour && event.id === id && event.name === name)) {
      events.push({ tour, id, name });
    }
  }

  const resolveEvent = (
    tour: string,
    fixtureId: string,
    baseName: string,
  ): { id: string; isCanonical: boolean } | null => {
    if (!tour || !baseName) return null;
    if (fixtureId) {
      const names = eventNames.get(`${tour}|${fixtureId}`);
      if (!names) return null;
      if (names.has(baseName)) return { id: fixtureId, isCanonical: true };
      // The fixture ID ties this label to the official event. The schedule may
      // add details missing from the directory name, so allow a unique prefix
      // relationship in either direction.
      const aliases = [...names].filter(
        (name) => name.startsWith(baseName) || baseName.startsWith(name),
      );
      return aliases.length === 1
        ? { id: fixtureId, isCanonical: false }
        : null;
    }

    const sameTour = events.filter((event) => event.tour === tour);
    const exact = sameTour.filter((event) => event.name === baseName);
    const matches = exact.length
      ? exact
      : sameTour.filter((event) => event.name.startsWith(baseName));
    const matchingIds = new Set(matches.map((event) => event.id));
    if (matchingIds.size !== 1) return null;

    const id = [...matchingIds][0];
    const names = eventNames.get(`${tour}|${id}`);
    if (!names) return null;
    if (names.has(baseName)) return { id, isCanonical: true };
    const aliases = [...names].filter((name) => name.startsWith(baseName));
    return aliases.length === 1 ? { id, isCanonical: false } : null;
  };

  const candidates = new Map<
    string,
    Array<{ index: number; roundCount: number; isCanonical: boolean }>
  >();

  fixtures.forEach((fixture, index) => {
    const tour = normalizeTour(fixture.tour);
    const tournamentId = String(fixture.tournament_id ?? '').trim();
    const firstId = String(fixture.first_id ?? '').trim();
    const secondId = String(fixture.second_id ?? '').trim();
    const deadline = comparableDeadline(fixture.round_deadline);
    if (!tour || !tournamentId || !firstId || !secondId || !deadline) return;

    const { baseName, roundCount, roundLabel } = tournamentBaseAndRoundCount(
      fixture.tournament,
    );
    if (roundCount < 1 || !roundLabel) return;
    const event = resolveEvent(tour, tournamentId, baseName);
    if (!event) return;

    const pair = [firstId, secondId].sort();
    const groupKey = JSON.stringify([
      tour,
      event.id,
      pair,
      deadline,
      roundLabel,
    ]);
    const group = candidates.get(groupKey) ?? [];
    group.push({ index, roundCount, isCanonical: event.isCanonical });
    candidates.set(groupKey, group);
  });

  const remove = new Set<number>();
  for (const group of candidates.values()) {
    const canonical = group.filter((item) => item.isCanonical);
    if (!canonical.length) continue;
    const fewestRoundLabels = Math.min(
      ...canonical.map((item) => item.roundCount),
    );
    for (const item of group) {
      if (!item.isCanonical || item.roundCount > fewestRoundLabels) {
        remove.add(item.index);
      }
    }
  }

  return fixtures.filter((_, index) => !remove.has(index));
}

function statusRank(value: unknown) {
  switch (String(value ?? '').trim().toLowerCase()) {
    case 'ongoing':
      return 0;
    case 'upcoming':
      return 1;
    case 'completed':
      return 2;
    case 'cancelled':
      return 3;
    default:
      return 4;
  }
}

function startTime(value: unknown) {
  if (!value) return null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function orderForTournament(tournament: TournamentRecord): TournamentOrder {
  return {
    statusRank: statusRank(tournament.status),
    startTime: startTime(tournament.start_date),
  };
}

function compareTournamentOrder(
  left: TournamentOrder,
  right: TournamentOrder,
) {
  if (left.statusRank !== right.statusRank) {
    return left.statusRank - right.statusRank;
  }
  if (left.startTime !== right.startTime) {
    if (left.startTime === null) return 1;
    if (right.startTime === null) return -1;
    return right.startTime - left.startTime;
  }
  return 0;
}

function keepBestOrder(
  orders: Map<string, TournamentOrder>,
  key: string | null,
  candidate: TournamentOrder,
) {
  if (!key) return;
  const existing = orders.get(key);
  if (!existing || compareTournamentOrder(candidate, existing) < 0) {
    orders.set(key, candidate);
  }
}

/** Group fixtures by event, putting current and recently-started tournaments first. */
export function sortOpenFixturesByTournamentRecency<T extends FixtureRef>(
  fixtures: T[],
  tournaments: TournamentRecord[],
): T[] {
  const byId = new Map<string, TournamentOrder>();
  const byName = new Map<string, TournamentOrder>();

  for (const tournament of tournaments) {
    const order = orderForTournament(tournament);
    const id = officialTournamentId(tournament.official_url);
    keepBestOrder(byId, fixtureKey(tournament.tour, id), order);
    keepBestOrder(
      byName,
      fixtureKey(tournament.tour, normalizeTournamentName(tournament.name)),
      order,
    );
  }

  const decorated = fixtures.map((fixture, index) => {
    const idKey = fixtureKey(fixture.tour, fixture.tournament_id);
    const nameKey = fixtureKey(
      fixture.tour,
      normalizeTournamentName(fixture.tournament),
    );
    const groupKey = idKey ?? nameKey ?? `fixture-${index}`;
    return {
      fixture,
      index,
      groupKey,
      order: (idKey ? byId.get(idKey) : undefined)
        ?? (nameKey ? byName.get(nameKey) : undefined)
        ?? null,
    };
  });

  const groupOrder = new Map<string, number>();
  for (const item of decorated) {
    if (!groupOrder.has(item.groupKey)) {
      groupOrder.set(item.groupKey, item.index);
    }
  }

  const unknownOrder: TournamentOrder = { statusRank: 4, startTime: null };
  return decorated
    .sort((left, right) => {
      const eventOrder = compareTournamentOrder(
        left.order ?? unknownOrder,
        right.order ?? unknownOrder,
      );
      if (eventOrder !== 0) return eventOrder;
      const groupPosition =
        (groupOrder.get(left.groupKey) ?? left.index)
        - (groupOrder.get(right.groupKey) ?? right.index);
      return groupPosition || left.index - right.index;
    })
    .map(({ fixture }) => fixture);
}
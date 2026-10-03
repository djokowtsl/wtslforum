type FixtureRef = {
  tour?: string | null;
  tournament?: string | null;
  tournament_id?: string | number | null;
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
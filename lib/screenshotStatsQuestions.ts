export type ScreenshotStatsTour = 'TE4' | 'TE4_(F)';

export type ScreenshotStatsRow = {
  playerName: string;
  metrics: Record<string, number>;
};

export type ScreenshotStatsMetric = {
  label: string;
  sourceLabel: string;
  valueFormat: 'number' | 'percent';
  direction: 'asc' | 'desc';
};

export type ScreenshotStatsPopulations = Record<
  ScreenshotStatsTour,
  ScreenshotStatsRow[]
>;

const METRIC_ALIASES: Record<string, string[]> = {
  '1st Serve %': ['first serve percentage', 'first serve percent'],
  '1st Serve Won %': ['first serve points won', 'first serve won percentage'],
  '2nd Serve Won %': ['second serve points won', 'second serve won percentage'],
  Aces: ['ace'],
  'Double Faults': ['double fault'],
  'Fastest Serve': ['fastest serve speed', 'fastest serve'],
  'Avg 1st Serve Speed': ['average first serve speed', 'first serve speed average'],
  'Avg 2nd Serve Speed': ['average second serve speed', 'second serve speed average'],
  Winners: ['winner'],
  'Forced Errors': ['forced error'],
  'Unforced Errors': ['unforced error'],
  'Net Points Won %': ['net points percentage', 'net points won percentage'],
  'Break Points Won %': ['break point conversion', 'break points converted'],
  'Total Points Won': ['points won'],
  'Short Rallies Won (<5) %': ['short rallies', 'short rally points won'],
  'Medium Rallies Won (5-8) %': ['medium rallies', 'medium rally points won'],
  'Long Rallies Won (>8) %': ['long rallies', 'long rally points won'],
  'Average Rally Length': ['rally length', 'average rally length'],
  'Set Points Saved': ['set point saves'],
  'Match Points Saved': ['match point saves'],
  'Return Points Won %': ['return percentage', 'return points percentage'],
  'Return Winners': ['return winner'],
  'Breaks / Games %': ['breaks per games', 'break conversion rate'],
  '1st Serve Return Points Won %': [
    'first serve return points',
    'first serve return percentage',
  ],
  '2nd Serve Return Points Won %': [
    'second serve return points',
    'second serve return percentage',
  ],
  'Break Points Saved %': ['break point save percentage', 'break points saved'],
  'Tie-breaks Won %': ['tiebreak percentage', 'tie break percentage'],
  'Deciding Sets Won %': ['deciding set percentage', 'deciding sets'],
};

function normalizeWords(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\bfirst\b/g, '1st')
    .replace(/\bsecond\b/g, '2nd')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function hasPhrase(text: string, phrase: string): boolean {
  return Boolean(phrase) && ` ${text} `.includes(` ${phrase} `);
}

function formatValue(value: number, metric: ScreenshotStatsMetric): string {
  if (metric.valueFormat === 'percent') {
    const points = value >= 0 && value <= 1 ? value * 100 : value;
    return `${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 }).format(points)}%`;
  }
  return new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }).format(value);
}

function tourFromQuestion(
  question: string,
  defaultTour: ScreenshotStatsTour,
): ScreenshotStatsTour | null {
  const words = ` ${normalizeWords(question)} `;
  const asksAtp = ['atp', 'men', 'mens'].some((word) => hasPhrase(words.trim(), word));
  const asksWta = ['wta', 'women', 'womens'].some((word) =>
    hasPhrase(words.trim(), word),
  );
  if (asksAtp && asksWta) return null;
  if (asksAtp) return 'TE4';
  if (asksWta) return 'TE4_(F)';
  return defaultTour;
}

function metricFromQuestion(
  question: string,
  metrics: ScreenshotStatsMetric[],
): ScreenshotStatsMetric | null {
  const normalized = normalizeWords(question);
  const candidates = metrics
    .flatMap((metric) => {
      const aliases = [
        metric.label,
        metric.sourceLabel,
        ...(METRIC_ALIASES[metric.sourceLabel] ?? []),
        ...(METRIC_ALIASES[metric.label] ?? []),
      ];
      return aliases.map((alias) => ({
        metric,
        phrase: normalizeWords(alias),
      }));
    })
    .filter((candidate) => candidate.phrase)
    .sort((a, b) => b.phrase.split(' ').length - a.phrase.split(' ').length);

  return candidates.find((candidate) =>
    hasPhrase(normalized, candidate.phrase),
  )?.metric ?? null;
}

function findNamedPlayers(
  question: string,
  rows: ScreenshotStatsRow[],
): ScreenshotStatsRow[] {
  const normalizedQuestion = normalizeWords(question);
  return rows
    .filter((row) => hasPhrase(normalizedQuestion, normalizeWords(row.playerName)))
    .sort((a, b) => {
      const aName = normalizeWords(a.playerName);
      const bName = normalizeWords(b.playerName);
      const positionDifference = normalizedQuestion.indexOf(` ${aName} `)
        - normalizedQuestion.indexOf(` ${bName} `);
      return positionDifference || bName.length - aName.length;
    });
}

function sortedByValue(
  rows: Array<{ playerName: string; value: number }>,
  direction: 'asc' | 'desc',
) {
  return [...rows].sort((a, b) =>
    direction === 'desc'
      ? b.value - a.value || a.playerName.localeCompare(b.playerName)
      : a.value - b.value || a.playerName.localeCompare(b.playerName),
  );
}

/**
 * Interpret only supported statistic questions, then calculate the answer from
 * the published player-level snapshot. Returns null for ambiguous or unsupported
 * questions rather than guessing.
 */
export function answerScreenshotStatsQuestion(
  question: string,
  populations: ScreenshotStatsPopulations,
  metrics: ScreenshotStatsMetric[],
  defaultTour: ScreenshotStatsTour,
): string | null {
  const normalizedQuestion = normalizeWords(question);
  if (!normalizedQuestion) return null;

  const tour = tourFromQuestion(question, defaultTour);
  const metric = metricFromQuestion(question, metrics);
  if (!tour || !metric) return null;

  const tourLabel = tour === 'TE4' ? 'ATP' : 'WTA';
  const playerRows = populations[tour] ?? [];
  const values = playerRows
    .map((row) => ({
      playerName: row.playerName,
      value: row.metrics[metric.sourceLabel],
    }))
    .filter((row): row is { playerName: string; value: number } =>
      Number.isFinite(row.value),
    );
  if (!values.length) return null;

  const namedPlayers = findNamedPlayers(question, playerRows);
  const compareRequested = /\b(compare|versus|vs)\b/.test(normalizedQuestion)
    || (namedPlayers.length === 2 && /\band\b/.test(normalizedQuestion));
  if (compareRequested) {
    if (namedPlayers.length !== 2) return null;
    const compared = namedPlayers.map((player) => values.find(
      (row) => row.playerName === player.playerName,
    ));
    if (compared.some((row) => !row)) return null;
    const [first, second] = compared as [
      { playerName: string; value: number },
      { playerName: string; value: number },
    ];
    const difference = Math.abs(first.value - second.value);
    return `${first.playerName}: ${formatValue(first.value, metric)}; ${second.playerName}: ${formatValue(second.value, metric)}. Difference: ${formatValue(difference, metric)} (${metric.label}, ${tourLabel}).`;
  }

  if (namedPlayers.length === 1) {
    const player = values.find((row) => row.playerName === namedPlayers[0].playerName);
    if (!player) return null;
    return `${player.playerName}: ${formatValue(player.value, metric)} for ${metric.label} (${tourLabel}).`;
  }
  if (namedPlayers.length > 1) return null;

  const asksForAverage = /\b(average|mean|avg)\b/.test(normalizedQuestion);
  if (asksForAverage) {
    const mean = values.reduce((sum, row) => sum + row.value, 0) / values.length;
    return `Mean of the published player-level ${metric.label} values: ${formatValue(mean, metric)} (${tourLabel}).`;
  }

  const asksForRawMaximum = /\b(highest|maximum|max|most|greatest|largest|fastest)\b/.test(normalizedQuestion);
  const asksForRawMinimum = /\b(lowest|minimum|min|least|fewest|smallest)\b/.test(normalizedQuestion);
  const asksForBest = /\b(best|top|leader|leading|leads)\b/.test(normalizedQuestion);
  const asksForWorst = /\b(worst|bottom)\b/.test(normalizedQuestion);
  if (asksForRawMaximum && asksForRawMinimum) return null;

  let direction: 'asc' | 'desc';
  if (asksForRawMaximum) direction = 'desc';
  else if (asksForRawMinimum) direction = 'asc';
  else if (asksForBest) direction = metric.direction;
  else if (asksForWorst) direction = metric.direction === 'desc' ? 'asc' : 'desc';
  else return null;

  const ranked = sortedByValue(values, direction);
  const topCountMatch = normalizedQuestion.match(/\btop (\d{1,2})\b/);
  const resultCount = topCountMatch
    ? Math.min(Math.max(Number(topCountMatch[1]), 1), 10)
    : 1;
  const results = ranked.slice(0, resultCount);
  const rankingLabel = asksForRawMaximum
    ? 'highest raw'
    : asksForRawMinimum
      ? 'lowest raw'
      : asksForWorst
        ? 'worst'
        : 'best';
  const lines = results.map((row, index) =>
    `${index + 1}. ${row.playerName} — ${formatValue(row.value, metric)}`,
  );
  return `${results.length > 1 ? `Top ${results.length}` : `${rankingLabel} ${metric.label}`} for ${tourLabel}:\n${lines.join('\n')}`;
}
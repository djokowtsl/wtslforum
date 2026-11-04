const INSIGHT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type Te4CoachInsight = {
  id: string;
  question: string;
};

export type Te4CoachInsightIndex = {
  insights: Te4CoachInsight[];
};

export type Te4CoachInsightRow = {
  label: string;
  shots: number;
  shotsDisplay: string;
  wonDisplay: string | null;
  missedDisplay: string | null;
  worthDisplay: string | null;
};

export type Te4CoachInsightDetail = {
  id: string;
  mod: 'WTSL';
  question: string;
  asOf: string;
  matches: number;
  shots: number;
  rows: Te4CoachInsightRow[];
};

function nonNegativeInteger(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function validDate(value: unknown): value is string {
  return typeof value === 'string'
    && DATE.test(value)
    && !Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime());
}

export function parseTe4CoachInsightIndex(value: unknown): Te4CoachInsightIndex | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (!Array.isArray(data.insights)) return null;

  const seen = new Set<string>();
  const insights = data.insights.flatMap((item): Te4CoachInsight[] => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    if (
      typeof row.id !== 'string'
      || !INSIGHT_ID.test(row.id)
      || typeof row.question !== 'string'
      || !row.question.trim()
      || row.question.length > 200
      || seen.has(row.id)
    ) {
      return [];
    }
    seen.add(row.id);
    return [{ id: row.id, question: row.question.trim() }];
  });

  return insights.length ? { insights } : null;
}

function rowMetricDisplay(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const display = (value as Record<string, unknown>).display;
  return typeof display === 'string' && display.length <= 40 ? display : null;
}

function parseInsightRows(value: unknown): Te4CoachInsightRow[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) return null;
  const rows = value.flatMap((item): Te4CoachInsightRow[] => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const shots = nonNegativeInteger(row.shots);
    if (
      typeof row.label !== 'string'
      || !row.label.trim()
      || row.label.length > 120
      || shots === null
    ) {
      return [];
    }
    const wonDisplay = rowMetricDisplay(row.won);
    const missedDisplay = rowMetricDisplay(row.missed);
    const worthDisplay = rowMetricDisplay(row.worth);
    if (!wonDisplay && !missedDisplay && !worthDisplay) return [];
    const shotsDisplay = typeof row.shots_display === 'string' && row.shots_display.length <= 40
      ? row.shots_display
      : shots.toLocaleString('en-GB');
    return [{
      label: row.label.trim(),
      shots,
      shotsDisplay,
      wonDisplay,
      missedDisplay,
      worthDisplay,
    }];
  });
  return rows.length === value.length ? rows : null;
}

export function parseTe4CoachInsightDetail(value: unknown): Te4CoachInsightDetail | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  const shots = nonNegativeInteger(data.shots);
  const matches = nonNegativeInteger(data.matches);
  const rows = parseInsightRows(data.rows);
  if (
    typeof data.id !== 'string'
    || !INSIGHT_ID.test(data.id)
    || typeof data.mod !== 'string'
    || data.mod.trim().toUpperCase() !== 'WTSL'
    || typeof data.question !== 'string'
    || !validDate(data.as_of)
    || shots === null
    || matches === null
    || !rows
    || rows.reduce((total, row) => total + row.shots, 0) !== shots
  ) {
    return null;
  }
  return {
    id: data.id,
    mod: 'WTSL',
    question: data.question.trim(),
    asOf: data.as_of,
    matches,
    shots,
    rows,
  };
}

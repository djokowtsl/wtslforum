const INSIGHT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type Te4CoachInsight = {
  id: string;
  question: string;
};

export type Te4CoachCorpus = {
  asOf: string;
  matches: number;
  players: number;
  shots: number;
};

export type Te4CoachInsightIndex = {
  insights: Te4CoachInsight[];
  everyone: Te4CoachCorpus | null;
};

export type Te4CoachInsightDetail = {
  id: string;
  question: string;
  sentence: string;
  caveat: string;
  asOf: string;
  matches: number;
  shots: number;
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

  const rawEveryone = data.everyone;
  let everyone: Te4CoachCorpus | null = null;
  if (rawEveryone && typeof rawEveryone === 'object') {
    const corpus = rawEveryone as Record<string, unknown>;
    const matches = nonNegativeInteger(corpus.matches);
    const players = nonNegativeInteger(corpus.players);
    const shots = nonNegativeInteger(corpus.shots);
    if (matches !== null && players !== null && shots !== null && validDate(corpus.as_of)) {
      everyone = { matches, players, shots, asOf: corpus.as_of };
    }
  }

  return insights.length ? { insights, everyone } : null;
}

export function parseTe4CoachInsightDetail(value: unknown): Te4CoachInsightDetail | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  const shots = nonNegativeInteger(data.shots);
  const matches = nonNegativeInteger(data.matches);
  if (
    typeof data.id !== 'string'
    || !INSIGHT_ID.test(data.id)
    || typeof data.question !== 'string'
    || typeof data.sentence !== 'string'
    || !data.sentence.trim()
    || typeof data.caveat !== 'string'
    || !data.caveat.trim()
    || !validDate(data.as_of)
    || shots === null
    || matches === null
  ) {
    return null;
  }
  return {
    id: data.id,
    question: data.question.trim(),
    sentence: data.sentence.trim(),
    caveat: data.caveat.trim(),
    asOf: data.as_of,
    matches,
    shots,
  };
}

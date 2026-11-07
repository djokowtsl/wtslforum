import type { Te4SetScore, Te4ViewerData, Te4ViewerPoint } from './te4DmoTypes';

export type Te4DmoReplayScore = {
  setNumber: number;
  sets: Te4SetScore[];
  games: [number, number];
  pointText: [string, string];
  tiebreak: boolean;
  server: 1 | 2 | null;
  final: boolean;
};

export type Te4DmoReplayScoreEvent = {
  frame: number;
  score: Te4DmoReplayScore;
};

function gamesForPoint(point: Te4ViewerPoint): [number, number] {
  const values = point.g.match(/\d+/g)?.map(Number);
  return values?.length === 2 && values.every(Number.isInteger)
    ? [values[0], values[1]]
    : [0, 0];
}

function pointsForLabel(label: string): [string, string] {
  const score = label.match(/\(([^()]*)\)\s*$/)?.[1] ?? label;
  const normalized = score.trim().toUpperCase();
  if (normalized === 'DEUCE') return ['40', '40'];

  const advantage = normalized.match(/^AD\s*([12])$/);
  if (advantage) return advantage[1] === '1' ? ['AD', '40'] : ['40', 'AD'];

  const pair = normalized.match(/^(AD|ADV|A|\d+)\s*[-–]\s*(AD|ADV|A|\d+)$/);
  if (!pair) return ['—', '—'];
  const value = (part: string) => ['AD', 'ADV', 'A'].includes(part) ? 'AD' : part;
  return [value(pair[1]), value(pair[2])];
}

function scoreAtPoint(point: Te4ViewerPoint): Te4DmoReplayScore {
  return {
    setNumber: Math.max(1, point.set),
    sets: point.ss.map(([first, second]) => [first, second]),
    games: gamesForPoint(point),
    pointText: pointsForLabel(point.pt),
    tiebreak: point.tb === 1,
    server: point.s === 1 || point.s === 2 ? point.s : null,
    final: false,
  };
}

function finalScore(viewer: Te4ViewerData, lastPoint?: Te4ViewerPoint): Te4DmoReplayScore {
  const sets = (viewer.final.ss.length ? viewer.final.ss : lastPoint?.ss ?? [])
    .map(([first, second]) => [first, second] as [number, number]);
  const lastSet = sets.at(-1) ?? [0, 0];
  return {
    setNumber: Math.max(1, lastPoint?.set ?? sets.length),
    sets,
    games: [lastSet[0], lastSet[1]],
    pointText: ['—', '—'],
    tiebreak: false,
    server: null,
    final: true,
  };
}

export function buildTe4DmoReplayScoreTimeline(
  viewer: Te4ViewerData,
): Te4DmoReplayScoreEvent[] {
  const points = viewer.pts;
  const frameCount = Number.isInteger(viewer.match?.n) && viewer.match.n > 0
    ? viewer.match.n
    : 1;
  if (!points.length) return [{ frame: 0, score: finalScore(viewer) }];

  const timeline: Te4DmoReplayScoreEvent[] = [
    { frame: 0, score: scoreAtPoint(points[0]) },
  ];

  points.forEach((point, index) => {
    if (!Number.isInteger(point.mf) || point.fc <= 0) return;
    const frame = Math.min(frameCount - 1, Math.max(0, point.mf + point.fc - 1));
    const nextPoint = points[index + 1];
    timeline.push({
      frame,
      score: nextPoint ? scoreAtPoint(nextPoint) : finalScore(viewer, point),
    });
  });

  const lastEvent = timeline.at(-1);
  if (!lastEvent?.score.final) {
    timeline.push({ frame: frameCount - 1, score: finalScore(viewer, points.at(-1)) });
  }

  return timeline
    .map((event, order) => ({ ...event, order }))
    .sort((first, second) => first.frame - second.frame || first.order - second.order)
    .map(({ frame, score }) => ({ frame, score }));
}

export function te4DmoReplayScoreAtFrame(
  timeline: Te4DmoReplayScoreEvent[],
  frame: number,
): Te4DmoReplayScore | null {
  if (!timeline.length) return null;
  const target = Number.isFinite(frame) ? frame : 0;
  let low = 0;
  let high = timeline.length - 1;
  let match = 0;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (timeline[middle].frame <= target) {
      match = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return timeline[match].score;
}

export function te4DmoReplayScoreKey(score: Te4DmoReplayScore): string {
  return [
    score.final ? 'final' : 'point',
    score.setNumber,
    score.sets.map(([first, second]) => `${first}-${second}`).join(','),
    score.games.join('-'),
    score.pointText.join('-'),
    score.tiebreak ? 'tb' : 'game',
    score.server ?? '-',
  ].join('|');
}

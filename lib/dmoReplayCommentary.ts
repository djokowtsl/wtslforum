import type { Te4ViewerData } from './te4DmoTypes';

/** Keep the viewer's separate game and point scores distinct in spoken calls. */
export function buildDmoReplayCommentaryPoints(viewer: Te4ViewerData) {
  if (!Number.isInteger(viewer.match?.n)) return [];
  const lastFrame = Math.max(0, viewer.match.n - 1);
  return viewer.pts.flatMap((point, index) => {
    if (!Number.isInteger(point.fc) || point.fc <= 0) return [];
    const frame = Math.min(lastFrame, point.mf + point.fc - 1);
    if (frame < 0) return [];
    const next = viewer.pts[index + 1];
    return [{
      frame, number: point.k, server: point.s, winner: point.w,
      rallyHits: point.n, rallyShotCount: point.n, highlightReasons: point.rs,
      faults: point.f, inferred: point.inferred, isTiebreak: point.tb === 1,
      shots: point.sh, shotEndTime: point.fc - 1,
      scoreBeforeLabel: `${point.g}(${point.pt})`,
      scoreAfterLabel: next ? `${next.g}(${next.pt})` : undefined,
    }];
  });
}

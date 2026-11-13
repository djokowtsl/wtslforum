import type { Te4SetScore, Te4ViewerData } from './te4DmoTypes';

function setsWon(sets: readonly Te4SetScore[] | undefined): [number, number] | null {
  if (!Array.isArray(sets)) return null;
  const won: [number, number] = [0, 0];
  for (const set of sets) {
    if (!Array.isArray(set) || set.length !== 2 || set[0] === set[1]) return null;
    won[set[0] > set[1] ? 0 : 1] += 1;
  }
  return won;
}

function setsToWinFor(viewer: Te4ViewerData, bestOf?: number | null) {
  if (bestOf === 1 || bestOf === 3 || bestOf === 5) return Math.ceil(bestOf / 2);
  // Recordings don't store the format, and a recording can stop part-way
  // through a match. Like the replay page, assume best of three unless the
  // recording shows someone winning three sets; never fewer than two, so a
  // set point in an unfinished recording is never called a match point.
  const final = setsWon(viewer.final?.ss);
  return Math.max(2, final ? Math.max(final[0], final[1]) : 0);
}

/** Keep the viewer's separate game and point scores distinct in spoken calls. */
export function buildDmoReplayCommentaryPoints(
  viewer: Te4ViewerData,
  { bestOf = null }: { bestOf?: number | null } = {},
) {
  if (!Number.isInteger(viewer.match?.n)) return [];
  const lastFrame = Math.max(0, viewer.match.n - 1);
  const setsToWin = setsToWinFor(viewer, bestOf);
  const finalSets = Array.isArray(viewer.final?.ss) ? viewer.final.ss : null;
  const finalWon = setsWon(finalSets ?? undefined);
  return viewer.pts.flatMap((point, index) => {
    if (!Number.isInteger(point.fc) || point.fc <= 0) return [];
    const frame = Math.min(lastFrame, point.mf + point.fc - 1);
    if (frame < 0) return [];
    const next = viewer.pts[index + 1];
    const setsWonBefore = setsWon(point.ss);
    const matchOver = !next && !point.inferred && Boolean(
      finalSets && finalWon && setsToWin && setsWonBefore && Array.isArray(point.ss)
      && finalSets.length === point.ss.length + 1
      && finalWon[point.w - 1] === setsToWin
      && finalWon[point.w - 1] > finalWon[point.w === 1 ? 1 : 0],
    );
    return [{
      frame, number: point.k, server: point.s, winner: point.w,
      rallyHits: point.n, rallyShotCount: point.n, highlightReasons: point.rs,
      faults: point.f, inferred: point.inferred, isTiebreak: point.tb === 1,
      shots: point.sh, shotEndTime: point.fc - 1,
      scoreBeforeLabel: `${point.g}(${point.pt})`,
      scoreAfterLabel: next ? `${next.g}(${next.pt})` : undefined,
      setBefore: point.set,
      setAfter: next?.set,
      setsWonBefore: setsWonBefore ?? undefined,
      setsToWin: setsToWin ?? undefined,
      ...(matchOver ? { matchOver: true, finalSets: finalSets!.map(([a, b]) => [a, b] as [number, number]) } : {}),
    }];
  });
}

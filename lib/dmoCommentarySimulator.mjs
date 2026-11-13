/**
 * Deterministic tennis matches built from real scoring rules, used to exercise
 * the commentary booth: by the tests, and by the server to learn which lines
 * a pairing's live matches are most likely to need, so those can be made in
 * advance.
 */

export function dmoCommentaryRandom(seed) {
  let state = seed;
  return () => ((state = Math.imul(state ^ (state >>> 15), 2246822507) + 0x6d2b79f5 | 0) >>> 0) / 2 ** 32;
}
export const dmoCommentaryTennisPoint = (value) => ['0', '15', '30', '40'][value];
export const dmoCommentaryPointText = (a, b, tiebreak) => tiebreak ? `${a}-${b}`
  : a >= 3 && b >= 3 ? (a === b ? '40-40' : a > b ? 'AD-40' : '40-AD') : `${dmoCommentaryTennisPoint(a)}-${dmoCommentaryTennisPoint(b)}`;
/**
 * A full match as replay-style commentary points, with frames at 30 fps
 * (roughly 10–25 seconds per point, longer for long rallies).
 */
export function simulateDmoCommentaryMatch(seed, { bestOf = 3, serveWinRate = 0.6 } = {}) {
  const next = dmoCommentaryRandom(seed);
  const points = []; const sets = []; let games = [0, 0]; let server = 1; let number = 0;
  let seconds = 0;
  const setsWon = () => [sets.filter(([a, b]) => a > b).length, sets.filter(([a, b]) => b > a).length];
  const setsToWin = Math.ceil(bestOf / 2);
  while (Math.max(...setsWon()) < setsToWin) {
    const tiebreak = games[0] === 6 && games[1] === 6;
    const opener = server; let score = [0, 0]; let played = 0;
    for (;;) {
      const serving = !tiebreak ? server
        : played === 0 ? opener : Math.floor((played - 1) / 2) % 2 === 0 ? 3 - opener : opener;
      const faults = next() < 0.07 ? 2 : next() < 0.35 ? 1 : 0;
      const winner = faults === 2 ? 3 - serving : next() < serveWinRate ? serving : 3 - serving;
      const rally = faults === 2 ? 0 : next() < 0.12 ? 0 : next() < 0.15 ? 10 + Math.floor(next() * 14) : 1 + Math.floor(next() * 8);
      seconds += 10 + rally * 1.1 + next() * 4;
      points.push({
        frame: Math.round(seconds * 30),
        number: ++number, winner, server: serving, rallyHits: rally, rallyShotCount: rally, faults, isTiebreak: tiebreak,
        scoreBeforeLabel: `${games[0]}-${games[1]}(${dmoCommentaryPointText(score[0], score[1], tiebreak)})`,
        setBefore: sets.length + 1, setsWonBefore: setsWon(), setsToWin,
      });
      score[winner - 1] += 1; played += 1;
      const target = tiebreak ? 7 : 4;
      if (Math.max(...score) >= target && Math.abs(score[0] - score[1]) >= 2) {
        games[winner - 1] += 1;
        server = tiebreak ? 3 - opener : 3 - server;
        if ((Math.max(...games) >= 6 && Math.abs(games[0] - games[1]) >= 2) || Math.max(...games) === 7) {
          sets.push([...games]); games = [0, 0];
        }
        break;
      }
    }
  }
  points.forEach((point, index) => {
    const following = points[index + 1];
    if (following) Object.assign(point, { scoreAfterLabel: following.scoreBeforeLabel, setAfter: following.setBefore });
    else Object.assign(point, { matchOver: true, finalSets: sets });
  });
  return points;
}

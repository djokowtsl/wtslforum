import type {
  Te4AnalysisResult,
  Te4Highlight,
  Te4Player,
  Te4SetScore,
  Te4ViewerPoint,
  Te4ViewerShot,
} from './te4DmoTypes';
import {
  MAX_DMO_BYTES,
  Te4DmoAnalysisError,
  Te4Replay,
  playScore,
  type Te4CompletedPoint,
  type Te4RawPoint,
  type Te4ScoreRow,
} from './te4DmoParser';

type ScoredPoint = Te4CompletedPoint;
type MatchModel = {
  match: (
    sets1: number,
    sets2: number,
    games1: number,
    games2: number,
    server: Te4Player,
    tiebreak: boolean,
    firstTiebreakServer: number,
  ) => number;
  point: (
    sets1: number,
    sets2: number,
    games1: number,
    games2: number,
    points1: number,
    points2: number,
    server: Te4Player,
    tiebreak: boolean,
    firstTiebreakServer: number,
  ) => number;
};

function round(value: number, digits = 0): number {
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function filenameDetails(filename: string): { names: [string, string]; score: string | null } {
  const leaf = filename.split(/[\\/]/).at(-1) || filename;
  const match = /_-_(.+?)_vs_(.+?)_((?:\d+-\d+_?)+)/.exec(leaf);
  if (!match) return { names: ['Player 1', 'Player 2'], score: null };
  return {
    names: [match[1], match[2]],
    score: match[3].replaceAll('_', ' ').trim(),
  };
}

function scoreTokens(score: string): string {
  return (score.match(/\d+-\d+/g) || []).join(' ');
}

function createMatchModel(serveRates: { 1: number; 2: number }, setsToWin: number): MatchModel {
  const gameCache = new Map<string, number>();
  const tiebreakCache = new Map<string, number>();
  const matchCache = new Map<string, number>();
  const pointCache = new Map<string, number>();

  const pointWinProbability = (server: Te4Player) => (
    server === 1 ? serveRates[1] : 1 - serveRates[2]
  );

  function gameProbability(points1: number, points2: number, server: Te4Player): number {
    const key = `${points1},${points2},${server}`;
    const cached = gameCache.get(key);
    if (cached !== undefined) return cached;

    const p = pointWinProbability(server);
    let result: number;
    if (points1 >= 4 && points1 - points2 >= 2) result = 1;
    else if (points2 >= 4 && points2 - points1 >= 2) result = 0;
    else if (points1 >= 3 && points2 >= 3) {
      const deuce = p * p / (p * p + (1 - p) ** 2);
      const difference = points1 - points2;
      result = difference === 0 ? deuce : difference === 1 ? p + (1 - p) * deuce : p * deuce;
    } else {
      result = p * gameProbability(points1 + 1, points2, server)
        + (1 - p) * gameProbability(points1, points2 + 1, server);
    }
    gameCache.set(key, result);
    return result;
  }

  function tiebreakProbability(points1: number, points2: number, firstServer: Te4Player): number {
    const key = `${points1},${points2},${firstServer}`;
    const cached = tiebreakCache.get(key);
    if (cached !== undefined) return cached;

    let result: number;
    if (points1 >= 7 && points1 - points2 >= 2) result = 1;
    else if (points2 >= 7 && points2 - points1 >= 2) result = 0;
    else if (points1 >= 6 && points2 >= 6) {
      const p = (serveRates[1] + 1 - serveRates[2]) / 2;
      const deuce = p * p / (p * p + (1 - p) ** 2);
      const difference = points1 - points2;
      result = difference === 0 ? deuce : difference === 1 ? p + (1 - p) * deuce : p * deuce;
    } else {
      const serveNumber = Math.floor((points1 + points2 + 1) / 2);
      const server = serveNumber % 2 === 0 ? firstServer : (3 - firstServer) as Te4Player;
      const p = pointWinProbability(server);
      result = p * tiebreakProbability(points1 + 1, points2, firstServer)
        + (1 - p) * tiebreakProbability(points1, points2 + 1, firstServer);
    }
    tiebreakCache.set(key, result);
    return result;
  }

  function match(
    sets1: number,
    sets2: number,
    games1: number,
    games2: number,
    server: Te4Player,
    tiebreak: boolean,
    firstTiebreakServer: number,
  ): number {
    if (sets1 >= setsToWin) return 1;
    if (sets2 >= setsToWin) return 0;
    const key = `${sets1},${sets2},${games1},${games2},${server},${Number(tiebreak)},${firstTiebreakServer}`;
    const cached = matchCache.get(key);
    if (cached !== undefined) return cached;
    const result = point(
      sets1, sets2, games1, games2, 0, 0, server, tiebreak, firstTiebreakServer,
    );
    matchCache.set(key, result);
    return result;
  }

  function afterGame(
    sets1: number,
    sets2: number,
    games1: number,
    games2: number,
    winner: Te4Player,
    server: Te4Player,
    tiebreak: boolean,
    firstTiebreakServer: number,
  ): number {
    if (tiebreak) {
      const nextServer = (3 - firstTiebreakServer) as Te4Player;
      return match(
        sets1 + Number(winner === 1),
        sets2 + Number(winner === 2),
        0,
        0,
        nextServer,
        false,
        0,
      );
    }

    const nextGames1 = games1 + Number(winner === 1);
    const nextGames2 = games2 + Number(winner === 2);
    if (
      (nextGames1 >= 6 && nextGames1 - nextGames2 >= 2)
      || nextGames1 === 7
    ) {
      return match(sets1 + 1, sets2, 0, 0, (3 - server) as Te4Player, false, 0);
    }
    if (
      (nextGames2 >= 6 && nextGames2 - nextGames1 >= 2)
      || nextGames2 === 7
    ) {
      return match(sets1, sets2 + 1, 0, 0, (3 - server) as Te4Player, false, 0);
    }
    if (nextGames1 === 6 && nextGames2 === 6) {
      const firstServer = (3 - server) as Te4Player;
      return match(sets1, sets2, nextGames1, nextGames2, firstServer, true, firstServer);
    }
    return match(sets1, sets2, nextGames1, nextGames2, (3 - server) as Te4Player, false, 0);
  }

  function point(
    sets1: number,
    sets2: number,
    games1: number,
    games2: number,
    points1: number,
    points2: number,
    server: Te4Player,
    tiebreak: boolean,
    firstTiebreakServer: number,
  ): number {
    const key = [
      sets1, sets2, games1, games2, points1, points2, server,
      Number(tiebreak), firstTiebreakServer,
    ].join(',');
    const cached = pointCache.get(key);
    if (cached !== undefined) return cached;

    const gameWin = tiebreak
      ? tiebreakProbability(points1, points2, firstTiebreakServer as Te4Player)
      : gameProbability(points1, points2, server);
    const result = gameWin * afterGame(
      sets1, sets2, games1, games2, 1, server, tiebreak, firstTiebreakServer,
    ) + (1 - gameWin) * afterGame(
      sets1, sets2, games1, games2, 2, server, tiebreak, firstTiebreakServer,
    );
    pointCache.set(key, result);
    return result;
  }

  return { match, point };
}

function pathMeters(replay: Te4Replay, start: number, end: number, x: Float64Array, y: Float64Array): number {
  const a = Math.max(0, start);
  const b = Math.min(replay.frameCount, end);
  let distance = 0;
  for (let i = a; i + 2 < b; i += 2) {
    distance += Math.hypot(x[i + 2] - x[i], y[i + 2] - y[i]);
  }
  return distance / 100;
}

function pointBallSpeed(replay: Te4Replay, hit: number): number | null {
  if (hit + 6 >= replay.frameCount) return null;
  const distance = Math.hypot(
    replay.ballX[hit + 6] - replay.ballX[hit + 2],
    replay.ballY[hit + 6] - replay.ballY[hit + 2],
  ) / 4;
  return distance * 0.6 * 3.6;
}

function rewatchTime(frame: number): string {
  const totalSeconds = Math.floor(frame / 60);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function toSignedInt16(value: number): number {
  const rounded = Math.max(-32768, Math.min(32767, Math.round(value)));
  return rounded;
}

function frameBytes(replay: Te4Replay, start: number, end: number): string {
  const frameIndices: number[] = [];
  for (let i = start; i < end; i += 2) frameIndices.push(i);
  const bytes = Buffer.allocUnsafe(frameIndices.length * 14);
  let offset = 0;
  for (const frame of frameIndices) {
    const ballX = replay.ballX[frame] > 3000 ? 0 : replay.ballX[frame];
    const values = [
      ballX,
      replay.ballY[frame],
      Math.max(0, Math.min(600, replay.ballZ[frame])),
      replay.p1X[frame],
      replay.p1Y[frame],
      replay.p2X[frame],
      replay.p2Y[frame],
    ];
    for (const value of values) {
      bytes.writeInt16LE(toSignedInt16(value), offset);
      offset += 2;
    }
  }
  return bytes.toString('base64');
}

function viewerShots(replay: Te4Replay, point: ScoredPoint, start: number): Te4ViewerShot[] {
  const candidates: Array<{ kind: 'serve' | 'rally'; frame: number; player: Te4Player }> = [
    { kind: 'serve', frame: point.serveFrame, player: point.server },
    ...point.hitFrames.map((frame) => ({
      kind: 'rally' as const,
      frame,
      player: replay.nearestPlayer(frame),
    })),
  ];

  return candidates.map(({ kind, frame, player }) => {
    const bounce = replay.firstBounceAfter(frame + (kind === 'serve' ? 2 : 0), 300);
    const x = player === 1 ? replay.p1X[frame] : replay.p2X[frame];
    const y = player === 1 ? replay.p1Y[frame] : replay.p2Y[frame];
    let speed = 0;
    if (frame + 6 < replay.frameCount) {
      if (kind === 'serve') {
        const measured = replay.serveRecord(frame).speedKmh;
        speed = measured === null
          ? Math.round((pointBallSpeed(replay, frame) || 0) / 0.928)
          : Math.round(measured);
      } else {
        speed = Math.round(pointBallSpeed(replay, frame) || 0);
      }
    }
    return {
      p: player,
      t: Math.round((frame - start) / 2),
      k: kind === 'serve' ? 's' : 'r',
      v: speed,
      z: kind === 'serve' ? 0 : Math.trunc(replay.ballZ[frame]),
      d: kind === 'serve' ? 0 : Math.trunc(Math.hypot(x - replay.ballX[frame], y - replay.ballY[frame])),
      bx: bounce === null ? null : Math.trunc(replay.ballX[bounce]),
      by: bounce === null ? null : Math.trunc(replay.ballY[bounce]),
      bt: bounce === null ? null : Math.round((bounce - start) / 2),
    };
  });
}

function viewerPoint(
  replay: Te4Replay,
  point: ScoredPoint,
  row: Te4ScoreRow,
  pointNumber: number,
  highlight: Te4Highlight | undefined,
): Te4ViewerPoint {
  const start = Math.max(0, point.serveFrame - 90);
  const lastHit = Math.max(point.serveFrame, ...point.hitFrames);
  const end = Math.min(point.end, lastHit + 300, replay.frameCount - 8);
  if (end <= start) {
    throw new Te4DmoAnalysisError(`Point ${pointNumber} has no usable replay frames.`);
  }
  return {
    k: pointNumber,
    ss: row.sets.map(([a, b]) => [a, b]),
    sc: highlight?.score ?? 0,
    rs: highlight?.reasons ?? '',
    wp: highlight?.wp ?? 0.5,
    rt: highlight?.rewatch ?? rewatchTime(start),
    set: row.sets.length + 1,
    g: `${row.games[0]}-${row.games[1]}`,
    pt: row.points,
    tb: row.tiebreak ? 1 : 0,
    s: point.server,
    w: point.winner,
    f: point.faults,
    n: point.hitFrames.length,
    sh: viewerShots(replay, point, start),
    d: frameBytes(replay, start, end),
  };
}

export function analyzeDmoBuffer(bytes: Buffer, filename: string): Te4AnalysisResult {
  if (bytes.length === 0) {
    throw new Te4DmoAnalysisError('The uploaded DMO file is empty.');
  }
  if (bytes.length > MAX_DMO_BYTES) {
    throw new Te4DmoAnalysisError('The DMO file is larger than the 64 MiB analysis limit.');
  }

  const replay = new Te4Replay(bytes);
  const { names, score: filenameScore } = filenameDetails(filename);
  const realPoints = replay.truePoints().filter(
    (point): point is ScoredPoint => !point.let && point.winner !== null,
  );
  if (realPoints.length < 4) {
    throw new Te4DmoAnalysisError('The recording does not contain enough scored points to analyze.');
  }
  const finalPoint = replay.finalPointFromPendingScore(realPoints);
  const points = [...realPoints, finalPoint];
  const scoreState = playScore(points.map((point) => [point.winner, point.server]));
  const setWins1 = scoreState.sets.filter(([a, b]) => a > b).length;
  const setWins2 = scoreState.sets.filter(([a, b]) => b > a).length;
  const setsToWin = Math.max(setWins1, setWins2) || 3;

  const serveCounts: { 1: [number, number]; 2: [number, number] } = {
    1: [0, 0],
    2: [0, 0],
  };
  for (const point of points) {
    serveCounts[point.server][0] += 1;
    serveCounts[point.server][1] += Number(point.winner === point.server);
  }
  if (serveCounts[1][0] === 0 || serveCounts[2][0] === 0) {
    throw new Te4DmoAnalysisError('The recording does not include serve data for both players.');
  }
  const serveWinRates = {
    1: serveCounts[1][1] / serveCounts[1][0],
    2: serveCounts[2][1] / serveCounts[2][0],
  };
  const model = createMatchModel(serveWinRates, setsToWin);
  const startProbability = model.match(0, 0, 0, 0, points[0].server, false, 0);
  let sets: [number, number] = [0, 0];
  let games: [number, number] = [0, 0];
  let currentPoints: [number, number] = [0, 0];
  let tiebreak = false;
  let firstTiebreakServer = 0;
  const highlights: Te4Highlight[] = [];
  const prePointRows: Te4ScoreRow[] = [];

  for (const [index, point] of points.entries()) {
    const server = point.server;
    if (tiebreak && firstTiebreakServer === 0) firstTiebreakServer = server;
    if (!tiebreak && games[0] === 6 && games[1] === 6) {
      tiebreak = true;
      firstTiebreakServer = server;
    }

    const row: Te4ScoreRow = {
      sets: scoreState.rows[index]?.sets.map(([a, b]) => [a, b]) ?? [],
      games: [games[0], games[1]],
      points: scoreState.rows[index]?.points ?? '0-0',
      tiebreak,
    };
    prePointRows.push(row);

    const currentTiebreakServer = tiebreak ? firstTiebreakServer : 0;
    const winIfPlayer1 = model.point(
      sets[0], sets[1], games[0], games[1],
      currentPoints[0] + 1, currentPoints[1], server, tiebreak, currentTiebreakServer,
    );
    const winIfPlayer2 = model.point(
      sets[0], sets[1], games[0], games[1],
      currentPoints[0], currentPoints[1] + 1, server, tiebreak, currentTiebreakServer,
    );
    const before = model.point(
      sets[0], sets[1], games[0], games[1],
      currentPoints[0], currentPoints[1], server, tiebreak, currentTiebreakServer,
    );
    const importance = Math.abs(winIfPlayer1 - winIfPlayer2);
    const start = point.serveFrame - 60;
    const end = point.end;
    const rallyLength = point.hitFrames.length;
    const serveSpeed = replay.serveRecord(point.serveFrame).speedKmh || 0;
    const distance1 = pathMeters(replay, start, end, replay.p1X, replay.p1Y);
    const distance2 = pathMeters(replay, start, end, replay.p2X, replay.p2Y);
    let fastestBall = 0;
    for (const hit of point.hitFrames) {
      fastestBall = Math.max(fastestBall, pointBallSpeed(replay, hit) || 0);
    }
    const excitement = Math.min(rallyLength / 18, 1) * 0.45
      + Math.min((distance1 + distance2) / 60, 1) * 0.3
      + Math.min(Math.max(fastestBall - 100, 0) / 40, 1) * 0.15
      + (rallyLength === 0 && point.winner === server && serveSpeed > 190 ? 0.1 : 0);
    const reasons: string[] = [];
    if (tiebreak) reasons.push('tiebreak');
    if (importance > 0.08) reasons.push(`swing ${Math.trunc(importance * 100)}% match chance`);
    if (rallyLength >= 12) reasons.push(`${rallyLength}-shot rally`);
    if (distance1 + distance2 > 45) reasons.push(`${Math.trunc(distance1 + distance2)} m covered`);
    if (rallyLength === 0 && point.winner === server) {
      reasons.push(`ace/unreturned ${Math.trunc(serveSpeed)} km/h`);
    }
    highlights.push({
      point: index + 1,
      rewatch: rewatchTime(start),
      frame: start,
      set: sets[0] + sets[1] + 1,
      games: `${games[0]}-${games[1]}`,
      winner: point.winner,
      wp: round(before, 4),
      importance: round(importance, 3),
      excitement: round(excitement, 3),
      score: round(0.6 * importance / 0.25 + 0.4 * excitement, 3),
      reasons: reasons.join('; '),
      rally: rallyLength,
    });

    currentPoints[point.winner - 1] += 1;
    const [p1, p2] = currentPoints;
    const gameWon = tiebreak
      ? Math.max(p1, p2) >= 7 && Math.abs(p1 - p2) >= 2
      : Math.max(p1, p2) >= 4 && Math.abs(p1 - p2) >= 2;
    if (!gameWon) continue;

    currentPoints = [0, 0];
    games[point.winner - 1] += 1;
    if (
      (Math.max(games[0], games[1]) >= 6 && Math.abs(games[0] - games[1]) >= 2)
      || Math.max(games[0], games[1]) === 7
    ) {
      sets[point.winner - 1] += 1;
      games = [0, 0];
      tiebreak = false;
      firstTiebreakServer = 0;
    } else {
      tiebreak = games[0] === 6 && games[1] === 6;
      firstTiebreakServer = 0;
    }
  }

  const topHighlights = [...highlights]
    .sort((a, b) => b.score - a.score || a.point - b.point)
    .slice(0, 12);
  const byPoint = new Map(topHighlights.map((highlight) => [highlight.point, highlight]));
  const viewerPoints = points.map((point, index) => viewerPoint(
    replay,
    point,
    prePointRows[index],
    index + 1,
    byPoint.get(index + 1),
  ));
  const computedScore = scoreState.sets.map(([a, b]) => `${a}-${b}`).join(' ');
  const warnings = [
    'TE4 DMO frame rules are reverse-engineered. Verify the reconstructed score against the recording before relying on the ranking.',
    'Match-win probabilities use this recording’s serve results; no career Elo file was supplied.',
  ];
  const displayScore = filenameScore || computedScore;
  if (filenameScore && scoreTokens(filenameScore) !== scoreTokens(computedScore)) {
    warnings.unshift(`The filename score (${filenameScore}) does not match the reconstructed score (${computedScore}).`);
  }
  const finalWinner = points.at(-1)!.winner;

  return {
    filename: filename.slice(0, 160),
    names,
    score: displayScore,
    sets: scoreState.sets as Te4SetScore[],
    pointsAnalyzed: points.length,
    durationSeconds: replay.frameCount / 60,
    meta: {
      setsToWin,
      eloMatchProbability: null,
      serveShift: 0,
      startProbability: round(startProbability, 4),
      finalWinner,
      serveWinRates,
      frameCount: replay.frameCount,
    },
    highlights: topHighlights,
    viewer: {
      names,
      score: displayScore,
      sets: scoreState.sets as Te4SetScore[],
      final: {
        ss: scoreState.sets.map(([a, b]) => [a, b]),
        wp: finalWinner === 1 ? 1 : 0,
      },
      pts: viewerPoints,
    },
    warnings,
  };
}

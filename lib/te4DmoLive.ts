export type Te4LivePlayer = 1 | 2;
export type Te4LiveBestOf = 1 | 3 | 5;
export type Te4DmoReplaySpeed = 1 | 2 | 4;

export const TE4_DMO_FRAMES_PER_SECOND = 60;
export const LIVE_DMO_UPDATE_INTERVAL_MS = 1200;
export const LIVE_DMO_COURT_SAMPLES = 72;

export function replayCourtWindowFrames(speed: Te4DmoReplaySpeed): number {
  return Math.round(TE4_DMO_FRAMES_PER_SECOND * LIVE_DMO_UPDATE_INTERVAL_MS * speed / 1000);
}

export function replayCourtWindowDurationMs(frameCount: number, speed: Te4DmoReplaySpeed): number {
  const safeFrameCount = Number.isFinite(frameCount) ? Math.max(0, Math.floor(frameCount)) : 0;
  return Math.max(
    LIVE_DMO_UPDATE_INTERVAL_MS,
    safeFrameCount * 1000 / (TE4_DMO_FRAMES_PER_SECOND * speed),
  );
}

type Header = {
  bad?: boolean;
  stadium?: string | null;
  p1?: string | null;
  p2?: string | null;
  umpire?: string | null;
};

type LivePoint = {
  server: Te4LivePlayer;
  winner: Te4LivePlayer | null;
  hits: number[];
  faults: number;
  start: number;
  end: number;
  serveFrame: number;
  let: boolean;
};

type ScoreState = {
  sets: [number, number][];
  games: [number, number];
  points: [number, number];
  tiebreak: boolean;
  firstTiebreakServer: Te4LivePlayer;
};

type ScoreRow = ScoreState & { server: Te4LivePlayer };

export type Te4LiveSnapshot = {
  version: 1;
  filename: string;
  stadium: string | null;
  players: [string, string];
  frameCount: number;
  courtFrameCount?: number;
  pointCount: number;
  bestOf: Te4LiveBestOf;
  score: {
    sets: [number, number][];
    games: [number, number];
    points: [number, number];
    pointText: [string, string];
    tiebreak: boolean;
    server: Te4LivePlayer | null;
  };
  currentPoint: {
    number: number;
    server: Te4LivePlayer | null;
    rallyHits: number;
    serveSpeedKmh: number | null;
    inProgress: boolean;
  };
  winChance: [number, number];
  winHistory: number[];
  stats: Array<{
    servicePoints: number;
    servicePointsWon: number;
    serviceWinRate: number | null;
    pointsWon: number;
    firstServeFaults: number;
    acesOrUnreturned: number;
  }>;
  recentPoints: Array<{
    number: number;
    server: Te4LivePlayer;
    winner: Te4LivePlayer;
    rallyHits: number;
    faults: number;
  }>;
  court: number[][];
  soundEvents?: Array<{
    frame: number;
    kind: 'racket' | 'bounce';
  }>;
};

export type Te4LiveSoundEvent = NonNullable<Te4LiveSnapshot['soundEvents']>[number];

export function hasCompletedDmoPoints(
  snapshot: Pick<Te4LiveSnapshot, 'pointCount'> | null | undefined,
): boolean {
  return Boolean(snapshot && Number.isInteger(snapshot.pointCount) && snapshot.pointCount > 0);
}

export function replayFrameAtElapsedTime(
  totalFrames: number,
  elapsedMs: number,
  speed: Te4DmoReplaySpeed,
): number {
  if (!Number.isFinite(totalFrames) || totalFrames < 10) return 0;
  const elapsedFrames = Math.floor(Math.max(0, elapsedMs) * TE4_DMO_FRAMES_PER_SECOND * speed / 1000);
  return Math.min(Math.floor(totalFrames), 10 + elapsedFrames);
}

const SIGNATURE = [0x0f, ...Array.from('DemoTEM2-1.0g.0').map((character) => character.charCodeAt(0))];
const UINT32_SCALE = 4_294_967_296;
const MAX_DMO_BYTES = 64 * 1024 * 1024;

/**
 * Browser-safe incremental reader for a growing TE4 DMO file.
 * Only derived match snapshots are sent to the Forum; the recording stays local.
 */
export class Te4DmoLiveParser {
  private buffer = new Uint8Array(1 << 20);
  private view = new DataView(this.buffer.buffer);
  private length = 0;
  private frame0 = -1;
  private scanPosition = 0x1000;
  private currentOffset = -1;
  private scanDistance = 128;
  private pendingOffset = -1;
  private finished = false;
  private readonly offsets: number[] = [];
  private readonly type110: number[] = [];
  private readonly type111: number[] = [];
  private readonly ballX: number[] = [];
  private readonly ballY: number[] = [];
  private readonly ballZ: number[] = [];
  private readonly player1X: number[] = [];
  private readonly player1Y: number[] = [];
  private readonly player2X: number[] = [];
  private readonly player2Y: number[] = [];

  header: Header | null = null;
  version = 0;

  get byteLength(): number {
    return this.length;
  }

  get frameCount(): number {
    return this.offsets.length;
  }

  append(bytes: Uint8Array): void {
    if (this.length + bytes.length > MAX_DMO_BYTES) {
      throw new Error('Live DMO files are limited to 64 MiB.');
    }
    if (this.length + bytes.length > this.buffer.length) {
      let size = this.buffer.length;
      while (size < this.length + bytes.length) size = Math.min(MAX_DMO_BYTES, size * 2);
      const next = new Uint8Array(size);
      next.set(this.buffer.subarray(0, this.length));
      this.buffer = next;
      this.view = new DataView(next.buffer);
    }
    this.buffer.set(bytes, this.length);
    this.length += bytes.length;
    this.advance();
  }

  private readFloat(offset: number): number {
    return this.view.getInt32(offset + 4, true) + this.view.getUint32(offset, true) / UINT32_SCALE;
  }

  private plausibleFrame(offset: number): boolean {
    if (offset < 0 || offset + 128 > this.length) return false;
    const read = (relative: number) => this.readFloat(offset + relative);
    const y1 = read(8);
    const x1 = read(16);
    const y2 = read(32);
    const x2 = read(40);
    if (!(Math.abs(y1) < 1500 && Math.abs(x1) < 2500 && Math.abs(y2) < 1500 && Math.abs(x2) < 2500)) {
      return false;
    }
    const energy1 = read(72);
    const energy2 = read(96);
    if (!(energy1 >= 0 && energy1 <= 100 && energy2 >= 0 && energy2 <= 100)) return false;
    return [56, 64, 80, 88].every((relative) => {
      const value = read(relative);
      return value >= -0.1 && value <= 1.5;
    });
  }

  private readFileHeader(): void {
    if (this.header || this.length < 1000) return;
    for (let index = 0; index < SIGNATURE.length; index += 1) {
      if (this.buffer[index] !== SIGNATURE[index]) {
        this.header = { bad: true };
        return;
      }
    }

    const runs: Array<[number, string]> = [];
    let text = '';
    let start = 0;
    for (let index = 0; index < Math.min(this.length, 900); index += 1) {
      const byte = this.buffer[index];
      if (byte >= 32 && byte < 127) {
        if (!text) start = index;
        text += String.fromCharCode(byte);
      } else {
        if (text.length >= 4) runs.push([start, text]);
        text = '';
      }
    }
    if (text.length >= 4) runs.push([start, text]);

    const stadium = runs.find(([position, value]) => position > 15 && /^\d+ /.test(value));
    const hudIndex = runs.findIndex(([, value]) => value.startsWith('HUD_'));
    let player1: string | null = null;
    let player2: string | null = null;
    if (hudIndex >= 0) {
      const names: string[] = [];
      for (let index = hudIndex + 1; index < runs.length && names.length < 4; index += 1) {
        const value = runs[index][1];
        if (/^(ChairUmpire|LineJudge|Umpire)/.test(value)) break;
        names.push(value);
      }
      player1 = names[0] || null;
      const clipped = (full: string, short: string) => short.length <= full.length && full.startsWith(short);
      player2 = names[1] && clipped(names[0] || '', names[1]) ? names[2] || null : names[1] || null;
    }
    const umpire = runs.find(([, value]) => value.startsWith('UmpireUS_') || (/^Umpire/.test(value) && value.includes('_')));
    this.header = {
      stadium: stadium?.[1].replace(/^\d+ /, '') || null,
      p1: player1,
      p2: player2,
      umpire: umpire?.[1].split('_').slice(1).join(' ') || null,
    };
  }

  private advance(): void {
    this.readFileHeader();
    if (this.finished || this.header?.bad) return;
    const buffer = this.buffer;
    const length = this.length;

    if (this.frame0 < 0) {
      const limit = Math.min(length - 400, 0x80000);
      for (; this.scanPosition < limit; this.scanPosition += 1) {
        const position = this.scanPosition;
        if (
          this.plausibleFrame(position)
          && this.plausibleFrame(position + 128)
          && this.plausibleFrame(position + 256)
          && this.plausibleFrame(position + 384)
        ) {
          this.frame0 = position;
          break;
        }
      }
      if (this.frame0 < 0) return;
    }

    if (this.currentOffset < 0) {
      if (this.frame0 < length - 1000 && this.plausibleFrame(this.frame0)) this.push(this.frame0);
      else return;
    }

    for (;;) {
      if (this.pendingOffset < 0) {
        const position = this.currentOffset;
        if (length < position + 256) return;
        if (buffer[position + 110] === 0 && buffer[position + 111] === 0 && this.plausibleFrame(position + 128)) {
          this.pendingOffset = position + 128;
        } else {
          let found = -1;
          const maxDistance = length - position - 256;
          for (; this.scanDistance <= maxDistance; this.scanDistance += 1) {
            const candidate = position + this.scanDistance;
            if (this.plausibleFrame(candidate) && this.plausibleFrame(candidate + 128)) {
              found = candidate;
              break;
            }
          }
          // A live file may pause or have a long frame gap. Keep the scan cursor
          // and resume when more bytes arrive instead of treating that as EOF.
          if (found < 0) return;
          this.pendingOffset = found;
        }
      }
      if (!(this.pendingOffset < length - 1000)) return;
      const nextOffset = this.pendingOffset;
      this.pendingOffset = -1;
      this.scanDistance = 128;
      this.push(nextOffset);
    }
  }

  private push(offset: number): void {
    this.currentOffset = offset;
    this.offsets.push(offset);
    this.type110.push(this.buffer[offset + 110]);
    this.type111.push(this.buffer[offset + 111]);
    const read = (word: number) => this.readFloat(offset + 8 * word);
    this.ballZ.push(read(0));
    this.ballY.push(read(14));
    this.ballX.push(read(15));
    this.player1Y.push(read(1));
    this.player1X.push(read(2));
    this.player2Y.push(read(4));
    this.player2X.push(read(5));
    this.version += 1;
  }

  private nearestPlayer(frame: number): Te4LivePlayer {
    const p1Distance = Math.hypot(this.player1X[frame] - this.ballX[frame], this.player1Y[frame] - this.ballY[frame]);
    const p2Distance = Math.hypot(this.player2X[frame] - this.ballX[frame], this.player2Y[frame] - this.ballY[frame]);
    return p1Distance <= p2Distance ? 1 : 2;
  }

  private serverForServe(frame: number): Te4LivePlayer {
    const p1Distance = Math.abs(Math.abs(this.player1X[frame]) - 1189);
    const p2Distance = Math.abs(Math.abs(this.player2X[frame]) - 1189);
    return p1Distance <= p2Distance ? 1 : 2;
  }

  private gap(frame: number): number {
    return frame + 1 < this.offsets.length
      ? this.offsets[frame + 1] - this.offsets[frame]
      : this.length - this.offsets[frame];
  }

  private nextServeFlag(end: number): number | null {
    const frame = end - 1;
    if (frame < 0 || frame + 1 >= this.offsets.length) return null;
    const offset = this.offsets[frame];
    const gap = this.offsets[frame + 1] - offset;
    const count = Math.floor((gap - 128) / 145);
    return count >= 1 ? this.buffer[offset + 128 + 145 * (count - 1) + 128] : null;
  }

  private serveRecord(frame: number): { speed: number | null } {
    const offset = this.offsets[frame] + 128;
    if (offset + 192 > this.length) return { speed: null };
    const read = (relative: number) => this.readFloat(offset + relative);
    const speed = Math.hypot(read(127), read(135), read(143)) * 0.036;
    return { speed: speed > 50 ? speed : null };
  }

  private rawServeSpeedKmh(frame: number): number | null {
    if (frame + 6 >= this.frameCount) return null;
    const distance = Math.hypot(
      this.ballX[frame + 6] - this.ballX[frame + 2],
      this.ballY[frame + 6] - this.ballY[frame + 2],
      this.ballZ[frame + 6] - this.ballZ[frame + 2],
    ) / 4;
    return distance * 0.6 * 3.6 / 0.928;
  }

  private isValidHit(frame: number): boolean {
    const player = this.nearestPlayer(frame);
    const playerX = player === 1 ? this.player1X : this.player2X;
    const playerY = player === 1 ? this.player1Y : this.player2Y;
    return Math.hypot(playerX[frame] - this.ballX[frame], playerY[frame] - this.ballY[frame]) < 350
      && this.ballZ[frame] < 350;
  }

  private truePoints(frameLimit = this.frameCount): {
    points: LivePoint[];
    lastEnd: number;
    openServe: number | null;
    openHits: number[];
  } {
    const ends: number[] = [];
    const serves: number[] = [];
    const hits: number[] = [];
    const visibleFrameCount = Math.min(this.frameCount, Math.max(0, Math.floor(frameLimit)));
    for (let frame = 0; frame < visibleFrameCount; frame += 1) {
      if (this.type110[frame] === 5) ends.push(frame);
      else if (this.type110[frame] === 2) serves.push(frame);
      if (
        this.type110[frame] === 0
        && [4, 5, 6, 8].includes(this.type111[frame])
        && this.isValidHit(frame)
      ) hits.push(frame);
    }

    const segments: Array<{
      start: number;
      end: number;
      serveLast: number;
      hits: number[];
      flag: number | null;
      block: number | null;
      server: Te4LivePlayer;
    }> = [];
    let start = 0;
    let serveIndex = 0;
    let hitIndex = 0;
    for (const end of ends) {
      while (serveIndex < serves.length && serves[serveIndex] <= start) serveIndex += 1;
      while (hitIndex < hits.length && hits[hitIndex] <= start) hitIndex += 1;
      const pointServes: number[] = [];
      const pointHits: number[] = [];
      for (let index = serveIndex; index < serves.length && serves[index] <= end; index += 1) pointServes.push(serves[index]);
      for (let index = hitIndex; index < hits.length && hits[index] <= end; index += 1) pointHits.push(hits[index]);
      if (pointServes.length) {
        let block: number | null = null;
        for (let index = start; index < end; index += 1) {
          if (this.type110[index] === 0 && this.gap(index) === 398) block = index;
        }
        const serveLast = pointServes[pointServes.length - 1];
        segments.push({
          start,
          end,
          serveLast,
          hits: pointHits,
          flag: this.nextServeFlag(end),
          block,
          server: this.serverForServe(serveLast),
        });
      }
      start = end + 1;
    }

    const groups: typeof segments[] = [];
    let current: typeof segments = [];
    for (const segment of segments) {
      current.push(segment);
      if (!(segment.flag === 2 && segment.hits.length === 0)) {
        groups.push(current);
        current = [];
      }
    }
    const points = groups.map((group): LivePoint => {
      const last = group[group.length - 1];
      const winnerCode = last.block === null ? 0 : this.buffer[this.offsets[last.block] + 108];
      const winner = winnerCode === 142 ? 1 : winnerCode === 150 ? 2 : null;
      return {
        server: last.server,
        winner,
        hits: last.hits,
        faults: group.length - 1,
        start: group[0].start,
        end: last.end,
        serveFrame: last.serveLast,
        let: winner === null,
      };
    });
    const lastEnd = ends.length ? ends[ends.length - 1] : -1;
    const openServes = serves.filter((frame) => frame > lastEnd);
    return {
      points: points.filter((point) => !point.let && point.winner !== null),
      lastEnd,
      openServe: openServes.length ? openServes[openServes.length - 1] : null,
      openHits: hits.filter((frame) => frame > lastEnd),
    };
  }

  snapshot(
    filename: string,
    bestOf: Te4LiveBestOf,
    frameLimit = this.frameCount,
    courtWindowFrames = replayCourtWindowFrames(1),
    courtSampleLimit = 25,
    includeSoundEvents = false,
  ): Te4LiveSnapshot | null {
    const visibleFrameCount = Math.min(this.frameCount, Math.max(0, Math.floor(frameLimit)));
    if (!this.header || this.header.bad || visibleFrameCount < 10) return null;
    const parsed = this.truePoints(visibleFrameCount);
    const points = parsed.points;
    const players: [string, string] = [
      this.header.p1?.trim().slice(0, 80) || 'Player 1',
      this.header.p2?.trim().slice(0, 80) || 'Player 2',
    ];
    const initialServer = points[0]?.server ?? (parsed.openServe === null ? 1 : this.serverForServe(parsed.openServe));
    const score = scorePoints(points, initialServer);
    const currentServer = parsed.openServe === null
      ? (points[points.length - 1]?.server ?? null)
      : this.serverForServe(parsed.openServe);
    const rates = serviceWinRates(points);
    const model = createMatchModel(rates, bestOf === 1 ? 1 : bestOf === 3 ? 2 : 3);
    const history = score.rows.map((row) => model.point(
      countSets(row.sets, 1),
      countSets(row.sets, 2),
      row.games[0],
      row.games[1],
      row.points[0],
      row.points[1],
      row.server,
      row.tiebreak,
      row.firstTiebreakServer,
    ));
    const chance = currentServer === null
      ? history[history.length - 1] ?? 0.5
      : model.point(
        countSets(score.current.sets, 1),
        countSets(score.current.sets, 2),
        score.current.games[0],
        score.current.games[1],
        score.current.points[0],
        score.current.points[1],
        currentServer,
        score.current.tiebreak,
        score.current.firstTiebreakServer,
      );
    history.push(chance);

    const serviceCounts = [
      { servicePoints: 0, servicePointsWon: 0, pointsWon: 0, firstServeFaults: 0, acesOrUnreturned: 0 },
      { servicePoints: 0, servicePointsWon: 0, pointsWon: 0, firstServeFaults: 0, acesOrUnreturned: 0 },
    ];
    for (const point of points) {
      if (point.winner === null) continue;
      const serverStats = serviceCounts[point.server - 1];
      serverStats.servicePoints += 1;
      serverStats.servicePointsWon += Number(point.winner === point.server);
      serverStats.firstServeFaults += point.faults;
      serverStats.acesOrUnreturned += Number(point.hits.length === 0 && point.winner === point.server);
      serviceCounts[point.winner - 1].pointsWon += 1;
    }
    const stats = serviceCounts.map((item) => ({
      ...item,
      serviceWinRate: item.servicePoints ? item.servicePointsWon / item.servicePoints : null,
    }));

    const liveHits = parsed.openHits.filter((frame) => frame >= 0 && frame < this.frameCount);
    const liveServeSpeed = parsed.openServe === null
      ? null
      : this.serveRecord(parsed.openServe).speed
        ?? this.rawServeSpeedKmh(parsed.openServe);
    const lastFrame = visibleFrameCount - 1;
    const firstFrame = Math.max(0, visibleFrameCount - Math.max(1, Math.floor(courtWindowFrames)));
    const maxSamples = Math.max(2, Math.min(360, Math.floor(courtSampleLimit)));
    const stride = Math.max(1, Math.ceil((lastFrame - firstFrame) / (maxSamples - 1)));
    const court: number[][] = [];
    for (let frame = firstFrame; frame <= lastFrame; frame += stride) {
      const ballX = this.ballX[frame] > 3000 ? 0 : this.ballX[frame];
      const sample = [
        Math.round(ballX),
        Math.round(this.ballY[frame]),
        Math.round(Math.max(0, Math.min(600, this.ballZ[frame]))),
        Math.round(this.player1X[frame]),
        Math.round(this.player1Y[frame]),
        Math.round(this.player2X[frame]),
        Math.round(this.player2Y[frame]),
      ];
      // A few recordings contain false-positive frames with impossible court
      // coordinates. Keep valid score data and omit only the malformed sample.
      if (sample.some((value, index) => index !== 2 && (value < -5000 || value > 5000))) continue;
      court.push(sample);
    }

    const soundEvents: Te4LiveSoundEvent[] = [];
    if (includeSoundEvents) {
      const seenSoundEvents = new Set<string>();
      const addShotSounds = (frame: number, serve: boolean) => {
        if (!Number.isInteger(frame) || frame < 0 || frame >= visibleFrameCount) return;
        if (frame >= firstFrame && frame <= lastFrame) {
          const key = `${frame}:racket`;
          if (!seenSoundEvents.has(key)) {
            soundEvents.push({ frame, kind: 'racket' });
            seenSoundEvents.add(key);
          }
        }

        const bounceSearchFrom = frame + (serve ? 2 : 0);
        const bounceSearchEnd = Math.min(bounceSearchFrom + 300, visibleFrameCount - 2);
        for (let bounceFrame = bounceSearchFrom + 3; bounceFrame < bounceSearchEnd; bounceFrame += 1) {
          const z = this.ballZ[bounceFrame];
          if (
            z < 25
            && z <= this.ballZ[bounceFrame - 1]
            && z <= this.ballZ[bounceFrame + 1]
            && this.ballZ[bounceFrame - 1] > z - 1e-9
          ) {
            if (bounceFrame >= firstFrame && bounceFrame <= lastFrame) {
              const key = `${bounceFrame}:bounce`;
              if (!seenSoundEvents.has(key)) {
                soundEvents.push({ frame: bounceFrame, kind: 'bounce' });
                seenSoundEvents.add(key);
              }
            }
            break;
          }
        }
      };

      for (let pointIndex = points.length - 1; pointIndex >= 0; pointIndex -= 1) {
        const point = points[pointIndex];
        if (point.end < firstFrame - 300) break;
        addShotSounds(point.serveFrame, true);
        for (const hit of point.hits) addShotSounds(hit, false);
      }
      if (parsed.openServe !== null) addShotSounds(parsed.openServe, true);
      for (const hit of liveHits) addShotSounds(hit, false);
      soundEvents.sort((a, b) => a.frame - b.frame || a.kind.localeCompare(b.kind));
    }

    return {
      version: 1,
      filename: filename.replace(/[\\/]/g, '').slice(0, 120),
      stadium: this.header.stadium?.slice(0, 80) || null,
      players,
      frameCount: visibleFrameCount,
      courtFrameCount: visibleFrameCount - firstFrame,
      pointCount: points.length,
      bestOf,
      score: {
        sets: score.current.sets,
        games: score.current.games,
        points: score.current.points,
        pointText: [
          formatTennisPoint(score.current.points, 0, score.current.tiebreak),
          formatTennisPoint(score.current.points, 1, score.current.tiebreak),
        ],
        tiebreak: score.current.tiebreak,
        server: currentServer,
      },
      currentPoint: {
        number: points.length + 1,
        server: currentServer,
        rallyHits: liveHits.length,
        serveSpeedKmh: liveServeSpeed === null ? null : Math.round(liveServeSpeed),
        inProgress: parsed.openServe !== null || liveHits.length > 0,
      },
      winChance: [chance, 1 - chance],
      winHistory: downsample(history, 120),
      stats,
      recentPoints: points.slice(-12).map((point, index) => ({
        number: points.length - Math.min(points.length, 12) + index + 1,
        server: point.server,
        winner: point.winner as Te4LivePlayer,
        rallyHits: point.hits.length,
        faults: point.faults,
      })),
      court,
      ...(soundEvents.length ? { soundEvents } : {}),
    };
  }
}

function countSets(sets: [number, number][], player: Te4LivePlayer): number {
  return sets.filter((set) => set[player - 1] > set[player === 1 ? 1 : 0]).length;
}

function cloneScore(state: ScoreState, server: Te4LivePlayer): ScoreRow {
  return {
    sets: state.sets.map(([a, b]) => [a, b]),
    games: [...state.games],
    points: [...state.points],
    tiebreak: state.tiebreak,
    firstTiebreakServer: state.firstTiebreakServer,
    server,
  };
}

function scorePoints(points: LivePoint[], initialServer: Te4LivePlayer): {
  rows: ScoreRow[];
  current: ScoreState;
} {
  const state: ScoreState = {
    sets: [],
    games: [0, 0],
    points: [0, 0],
    tiebreak: false,
    firstTiebreakServer: initialServer,
  };
  const rows: ScoreRow[] = [];
  for (const point of points) {
    if (!state.tiebreak && state.games[0] === 6 && state.games[1] === 6) {
      state.tiebreak = true;
      state.firstTiebreakServer = point.server;
    }
    rows.push(cloneScore(state, point.server));
    state.points[point.winner! - 1] += 1;
    const [a, b] = state.points;
    const gameWon = state.tiebreak
      ? Math.max(a, b) >= 7 && Math.abs(a - b) >= 2
      : Math.max(a, b) >= 4 && Math.abs(a - b) >= 2;
    if (!gameWon) continue;
    state.points = [0, 0];
    state.games[point.winner! - 1] += 1;
    if (
      (Math.max(...state.games) >= 6 && Math.abs(state.games[0] - state.games[1]) >= 2)
      || Math.max(...state.games) === 7
    ) {
      state.sets.push([...state.games]);
      state.games = [0, 0];
      state.tiebreak = false;
      state.firstTiebreakServer = point.server === 1 ? 2 : 1;
    } else {
      state.tiebreak = state.games[0] === 6 && state.games[1] === 6;
      if (!state.tiebreak) state.firstTiebreakServer = point.server;
    }
  }
  return { rows, current: state };
}

function formatTennisPoint(points: [number, number], playerIndex: 0 | 1, tiebreak: boolean): string {
  if (tiebreak) return String(points[playerIndex]);
  const [a, b] = points;
  if (a >= 3 && b >= 3) {
    if (a === b) return '40';
    return points[playerIndex] > points[1 - playerIndex] ? 'AD' : '40';
  }
  return ['0', '15', '30', '40'][Math.min(points[playerIndex], 3)];
}

function serviceWinRates(points: LivePoint[]): { 1: number; 2: number } {
  const counts: Record<Te4LivePlayer, [number, number]> = {
    1: [0, 0],
    2: [0, 0],
  };
  for (const point of points) {
    counts[point.server][0] += 1;
    counts[point.server][1] += Number(point.winner === point.server);
  }
  return {
    1: (counts[1][1] + 100 * 0.65) / (counts[1][0] + 100),
    2: (counts[2][1] + 100 * 0.65) / (counts[2][0] + 100),
  };
}

function downsample(values: number[], maximum: number): number[] {
  if (values.length <= maximum) return values.map((value) => Number(value.toFixed(4)));
  const stride = (values.length - 1) / (maximum - 1);
  return Array.from({ length: maximum }, (_, index) => {
    const value = values[Math.round(index * stride)];
    return Number(value.toFixed(4));
  });
}

function createMatchModel(
  serveRates: { 1: number; 2: number },
  setsToWin: number,
): {
  point: (
    sets1: number,
    sets2: number,
    games1: number,
    games2: number,
    points1: number,
    points2: number,
    server: Te4LivePlayer,
    tiebreak: boolean,
    firstTiebreakServer: Te4LivePlayer,
  ) => number;
} {
  const gameCache = new Map<string, number>();
  const tiebreakCache = new Map<string, number>();
  const matchCache = new Map<string, number>();
  const pointCache = new Map<string, number>();
  const pointChance = (server: Te4LivePlayer) => server === 1 ? serveRates[1] : 1 - serveRates[2];

  function gameChance(points1: number, points2: number, server: Te4LivePlayer): number {
    const key = `${points1},${points2},${server}`;
    const cached = gameCache.get(key);
    if (cached !== undefined) return cached;
    const p = pointChance(server);
    let result: number;
    if (points1 >= 4 && points1 - points2 >= 2) result = 1;
    else if (points2 >= 4 && points2 - points1 >= 2) result = 0;
    else if (points1 >= 3 && points2 >= 3) {
      const deuce = p * p / (p * p + (1 - p) ** 2);
      const difference = points1 - points2;
      result = difference === 0 ? deuce : difference === 1 ? p + (1 - p) * deuce : p * deuce;
    } else {
      result = p * gameChance(points1 + 1, points2, server)
        + (1 - p) * gameChance(points1, points2 + 1, server);
    }
    gameCache.set(key, result);
    return result;
  }

  function tiebreakChance(points1: number, points2: number, firstServer: Te4LivePlayer): number {
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
      const server = serveNumber % 2 === 0 ? firstServer : (3 - firstServer) as Te4LivePlayer;
      const p = pointChance(server);
      result = p * tiebreakChance(points1 + 1, points2, firstServer)
        + (1 - p) * tiebreakChance(points1, points2 + 1, firstServer);
    }
    tiebreakCache.set(key, result);
    return result;
  }

  function match(
    sets1: number,
    sets2: number,
    games1: number,
    games2: number,
    server: Te4LivePlayer,
    tiebreak: boolean,
    firstTiebreakServer: Te4LivePlayer,
  ): number {
    if (sets1 >= setsToWin) return 1;
    if (sets2 >= setsToWin) return 0;
    const key = `${sets1},${sets2},${games1},${games2},${server},${Number(tiebreak)},${firstTiebreakServer}`;
    const cached = matchCache.get(key);
    if (cached !== undefined) return cached;
    const result = point(sets1, sets2, games1, games2, 0, 0, server, tiebreak, firstTiebreakServer);
    matchCache.set(key, result);
    return result;
  }

  function afterGame(
    sets1: number,
    sets2: number,
    games1: number,
    games2: number,
    winner: Te4LivePlayer,
    server: Te4LivePlayer,
    tiebreak: boolean,
    firstTiebreakServer: Te4LivePlayer,
  ): number {
    if (tiebreak) {
      return match(
        sets1 + Number(winner === 1),
        sets2 + Number(winner === 2),
        0,
        0,
        (3 - firstTiebreakServer) as Te4LivePlayer,
        false,
        1,
      );
    }
    const nextGames1 = games1 + Number(winner === 1);
    const nextGames2 = games2 + Number(winner === 2);
    if (
      (nextGames1 >= 6 && nextGames1 - nextGames2 >= 2)
      || nextGames1 === 7
    ) return match(sets1 + 1, sets2, 0, 0, (3 - server) as Te4LivePlayer, false, 1);
    if (
      (nextGames2 >= 6 && nextGames2 - nextGames1 >= 2)
      || nextGames2 === 7
    ) return match(sets1, sets2 + 1, 0, 0, (3 - server) as Te4LivePlayer, false, 1);
    if (nextGames1 === 6 && nextGames2 === 6) {
      const firstServer = (3 - server) as Te4LivePlayer;
      return match(sets1, sets2, nextGames1, nextGames2, firstServer, true, firstServer);
    }
    return match(sets1, sets2, nextGames1, nextGames2, (3 - server) as Te4LivePlayer, false, 1);
  }

  function point(
    sets1: number,
    sets2: number,
    games1: number,
    games2: number,
    points1: number,
    points2: number,
    server: Te4LivePlayer,
    tiebreak: boolean,
    firstTiebreakServer: Te4LivePlayer,
  ): number {
    const key = [
      sets1, sets2, games1, games2, points1, points2, server,
      Number(tiebreak), firstTiebreakServer,
    ].join(',');
    const cached = pointCache.get(key);
    if (cached !== undefined) return cached;
    const game = tiebreak
      ? tiebreakChance(points1, points2, firstTiebreakServer)
      : gameChance(points1, points2, server);
    const result = game * afterGame(
      sets1, sets2, games1, games2, 1, server, tiebreak, firstTiebreakServer,
    ) + (1 - game) * afterGame(
      sets1, sets2, games1, games2, 2, server, tiebreak, firstTiebreakServer,
    );
    pointCache.set(key, result);
    return result;
  }

  return { point };
}

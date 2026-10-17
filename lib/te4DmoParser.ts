const HEADER_SIG = Buffer.from('\x0fDemoTEM2-1.0g.0', 'binary');

export const MAX_DMO_BYTES = 64 * 1024 * 1024;

export function extractDmoTournamentName(bytes: Buffer): string | null {
  if (!bytes.subarray(0, HEADER_SIG.length).equals(HEADER_SIG)) return null;

  // DemoTEM2 stores the tournament label twice as adjacent length-prefixed strings.
  // Require both copies so unrelated printable bytes cannot be mistaken for an event.
  const limit = Math.min(bytes.length, 0x400);
  for (let offset = HEADER_SIG.length; offset < limit; offset += 1) {
    const length = bytes[offset];
    if (length < 4 || length > 96) continue;
    const valueStart = offset + 1;
    const repeatedLengthOffset = valueStart + length;
    const repeatedStart = repeatedLengthOffset + 1;
    if (repeatedStart + length > limit || bytes[repeatedLengthOffset] !== length) continue;

    const value = bytes.subarray(valueStart, repeatedLengthOffset);
    if (!value.equals(bytes.subarray(repeatedStart, repeatedStart + length))) continue;
    if (!value.every((character) => character >= 0x20 && character <= 0x7e)) continue;

    const tournament = value.toString('ascii').trim();
    return /[a-z]/i.test(tournament) ? tournament : null;
  }
  return null;
}

export class Te4DmoAnalysisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Te4DmoAnalysisError';
  }
}

export type Te4RawPoint = {
  start: number;
  end: number;
  server: 1 | 2;
  winner: 1 | 2 | null;
  faults: number;
  let: boolean;
  serveFrame: number;
  hitFrames: number[];
  rallyHits: number;
};

export type Te4CompletedPoint = Te4RawPoint & { winner: 1 | 2 };

export type Te4ScoreRow = {
  sets: Array<[number, number]>;
  games: [number, number];
  points: string;
  tiebreak: boolean;
};

export type Te4ScoreState = {
  rows: Te4ScoreRow[];
  sets: Array<[number, number]>;
  games: [number, number];
  points: [number, number];
};

function readQ(buffer: Buffer, offset: number): number {
  if (offset < 0 || offset + 8 > buffer.length) {
    throw new Te4DmoAnalysisError('The DMO file ends inside a frame record.');
  }
  const low = buffer.readUInt32LE(offset);
  const high = buffer.readInt32LE(offset + 4);
  return high + low / 0x100000000;
}

function pair<T>(values: T[]): [T, T] {
  return [values[0], values[1]];
}

export class Te4Replay {
  readonly bytes: Buffer;
  readonly tournamentName: string | null;
  readonly offsets: number[];
  readonly t110: Uint8Array;
  readonly t111: Uint8Array;
  readonly ballX: Float64Array;
  readonly ballY: Float64Array;
  readonly ballZ: Float64Array;
  readonly p1X: Float64Array;
  readonly p1Y: Float64Array;
  readonly p2X: Float64Array;
  readonly p2Y: Float64Array;
  readonly p1Energy: Float64Array;
  readonly p1Breath: Float64Array;
  readonly p2Energy: Float64Array;
  readonly p2Breath: Float64Array;

  constructor(bytes: Buffer) {
    if (bytes.length > MAX_DMO_BYTES) {
      throw new Te4DmoAnalysisError('The DMO file is larger than the 64 MiB analysis limit.');
    }
    if (bytes.length < 0x1200 || !bytes.subarray(0, HEADER_SIG.length).equals(HEADER_SIG)) {
      throw new Te4DmoAnalysisError('This file is not a supported TE4 DemoTEM2 recording.');
    }
    this.bytes = bytes;
    this.tournamentName = extractDmoTournamentName(bytes);
    const firstFrame = this.findFirstFrame();
    this.offsets = this.walkFrames(firstFrame);
    if (this.offsets.length < 8) {
      throw new Te4DmoAnalysisError('The recording does not contain enough valid TE4 frame data.');
    }

    const count = this.offsets.length;
    this.t110 = new Uint8Array(count);
    this.t111 = new Uint8Array(count);
    this.ballZ = new Float64Array(count);
    this.ballY = new Float64Array(count);
    this.ballX = new Float64Array(count);
    this.p1Y = new Float64Array(count);
    this.p1X = new Float64Array(count);
    this.p2Y = new Float64Array(count);
    this.p2X = new Float64Array(count);
    this.p1Energy = new Float64Array(count);
    this.p1Breath = new Float64Array(count);
    this.p2Energy = new Float64Array(count);
    this.p2Breath = new Float64Array(count);

    for (let i = 0; i < count; i += 1) {
      const offset = this.offsets[i];
      this.t110[i] = bytes[offset + 110];
      this.t111[i] = bytes[offset + 111];
      this.ballZ[i] = readQ(bytes, offset);
      this.p1Y[i] = readQ(bytes, offset + 8);
      this.p1X[i] = readQ(bytes, offset + 16);
      this.p2Y[i] = readQ(bytes, offset + 32);
      this.p2X[i] = readQ(bytes, offset + 40);
      this.p1Energy[i] = readQ(bytes, offset + 56);
      this.p1Breath[i] = readQ(bytes, offset + 64);
      this.p2Energy[i] = readQ(bytes, offset + 80);
      this.p2Breath[i] = readQ(bytes, offset + 88);
      this.ballY[i] = readQ(bytes, offset + 112);
      this.ballX[i] = readQ(bytes, offset + 120);
    }
  }

  get frameCount() {
    return this.offsets.length;
  }

  private frameIsPlausible(offset: number): boolean {
    const b = this.bytes;
    if (offset < 0 || offset + 128 > b.length) return false;
    const y1 = readQ(b, offset + 8);
    const x1 = readQ(b, offset + 16);
    const y2 = readQ(b, offset + 32);
    const x2 = readQ(b, offset + 40);
    const e1 = readQ(b, offset + 72);
    const e2 = readQ(b, offset + 96);
    if (!(Math.abs(y1) < 1500 && Math.abs(x1) < 2500 && Math.abs(y2) < 1500 && Math.abs(x2) < 2500)) {
      return false;
    }
    if (!(e1 >= 0 && e1 <= 100 && e2 >= 0 && e2 <= 100)) return false;
    for (const relative of [56, 64, 80, 88]) {
      const value = readQ(b, offset + relative);
      if (value < -0.1 || value > 1.5) return false;
    }
    return true;
  }

  private findFirstFrame(): number {
    const end = Math.min(this.bytes.length - 400, 0x80000);
    for (let offset = 0x1000; offset < end; offset += 1) {
      if (
        this.frameIsPlausible(offset)
        && this.frameIsPlausible(offset + 128)
        && this.frameIsPlausible(offset + 256)
        && this.frameIsPlausible(offset + 384)
      ) {
        return offset;
      }
    }
    throw new Te4DmoAnalysisError('No supported TE4 frame stream was found in this file.');
  }

  private walkFrames(firstFrame: number): number[] {
    const offsets: number[] = [];
    let offset = firstFrame;
    let searchProbes = 0;

    while (offset < this.bytes.length - 1000 && this.frameIsPlausible(offset)) {
      offsets.push(offset);
      if (offsets.length > 1_000_000) {
        throw new Te4DmoAnalysisError('The recording contains too many frames to analyze safely.');
      }
      const normalFrame = this.bytes[offset + 110] === 0 && this.bytes[offset + 111] === 0;
      if (normalFrame && this.frameIsPlausible(offset + 128)) {
        offset += 128;
        continue;
      }

      let nextOffset: number | null = null;
      for (let distance = 128; distance < 200_000; distance += 1) {
        searchProbes += 1;
        if (searchProbes > 80_000_000) {
          throw new Te4DmoAnalysisError('The replay frame stream is too fragmented to analyze safely.');
        }
        if (this.frameIsPlausible(offset + distance) && this.frameIsPlausible(offset + distance + 128)) {
          nextOffset = offset + distance;
          break;
        }
      }
      if (nextOffset === null) break;
      offset = nextOffset;
    }
    return offsets;
  }

  pointEnds(): number[] {
    const result: number[] = [];
    for (let i = 0; i < this.t110.length; i += 1) {
      if (this.t110[i] === 5) result.push(i);
    }
    return result;
  }

  serves(): number[] {
    const result: number[] = [];
    for (let i = 0; i < this.t110.length; i += 1) {
      if (this.t110[i] === 2) result.push(i);
    }
    return result;
  }

  hits(): number[] {
    const result: number[] = [];
    for (let i = 0; i < this.t110.length; i += 1) {
      const type = this.t111[i];
      if (this.t110[i] === 0 && (type === 4 || type === 5 || type === 6 || type === 8)) {
        result.push(i);
      }
    }
    return result;
  }

  nearestPlayer(index: number): 1 | 2 {
    const d1 = Math.hypot(this.p1X[index] - this.ballX[index], this.p1Y[index] - this.ballY[index]);
    const d2 = Math.hypot(this.p2X[index] - this.ballX[index], this.p2Y[index] - this.ballY[index]);
    return d1 <= d2 ? 1 : 2;
  }

  firstBounceAfter(index: number, horizon = 240): number | null {
    for (let j = index + 3; j < Math.min(index + horizon, this.frameCount - 2); j += 1) {
      const z = this.ballZ[j];
      if (
        z < 25
        && z <= this.ballZ[j - 1]
        && z <= this.ballZ[j + 1]
        && this.ballZ[j - 1] > z - 1e-9
      ) {
        return j;
      }
    }
    return null;
  }

  private frameGap(index: number): number {
    if (index < 0 || index >= this.offsets.length) return 0;
    return index + 1 < this.offsets.length
      ? this.offsets[index + 1] - this.offsets[index]
      : this.bytes.length - this.offsets[index];
  }

  private nextServeFlag(end: number): number | null {
    const frame = end - 1;
    if (frame < 0 || frame + 1 >= this.offsets.length) return null;
    const offset = this.offsets[frame];
    const gap = this.offsets[frame + 1] - offset;
    const idleRecords = Math.floor((gap - 128) / 145);
    return idleRecords >= 1
      ? this.bytes[offset + 128 + 145 * (idleRecords - 1) + 128]
      : null;
  }

  private serverAt(serveFrame: number): 1 | 2 {
    const d1 = Math.abs(Math.abs(this.p1X[serveFrame]) - 1189);
    const d2 = Math.abs(Math.abs(this.p2X[serveFrame]) - 1189);
    return d1 <= d2 ? 1 : 2;
  }

  serveRecord(serveFrame: number) {
    const offset = this.offsets[serveFrame] + 128;
    const value = (relative: number) => readQ(this.bytes, offset + relative);
    const vector = [value(127), value(135), value(143)];
    const speed = Math.hypot(...vector) * 0.036;
    return {
      contactCm: value(31),
      vector,
      speedKmh: speed > 50 ? speed : null,
    };
  }

  points() {
    const ends = this.pointEnds();
    const serves = this.serves();
    const hits = this.hits();
    let start = 0;
    const result: Array<{
      index: number;
      start: number;
      end: number;
      serve: number | null;
      serveLast: number | null;
      hits: number[];
    }> = [];

    for (const [index, end] of ends.entries()) {
      const pointServes = serves.filter((serve) => serve > start && serve <= end);
      const pointHits = hits.filter((hit) => hit > start && hit <= end);
      result.push({
        index,
        start,
        end,
        serve: pointServes[0] ?? null,
        serveLast: pointServes.at(-1) ?? null,
        hits: pointHits,
      });
      start = end + 1;
    }
    return result;
  }

  truePoints(): Te4RawPoint[] {
    const gaps = this.offsets.map((_, index) => this.frameGap(index));
    const segments = this.points()
      .filter((point) => point.serve !== null && point.serveLast !== null)
      .map((point) => {
        const pointHits = point.hits.filter((hit) => {
          const player = this.nearestPlayer(hit);
          const px = player === 1 ? this.p1X[hit] : this.p2X[hit];
          const py = player === 1 ? this.p1Y[hit] : this.p2Y[hit];
          return Math.hypot(px - this.ballX[hit], py - this.ballY[hit]) < 350
            && this.ballZ[hit] < 350;
        });
        let block: number | null = null;
        for (let i = point.start; i < point.end; i += 1) {
          if (this.t110[i] === 0 && gaps[i] === 398) block = i;
        }
        return {
          point,
          hits: pointHits,
          flag: this.nextServeFlag(point.end),
          block,
          server: this.serverAt(point.serveLast!),
        };
      });

    const groups: typeof segments[] = [];
    let current: typeof segments = [];
    for (const segment of segments) {
      current.push(segment);
      if (!(segment.flag === 2 && segment.hits.length === 0)) {
        groups.push(current);
        current = [];
      }
    }

    return groups.map((group) => {
      const last = group[group.length - 1];
      let winner: 1 | 2 | null = null;
      if (last.block !== null) {
        const code = this.bytes[this.offsets[last.block] + 108];
        if (code === 142) winner = 1;
        if (code === 150) winner = 2;
      }
      return {
        start: group[0].point.start,
        end: last.point.end,
        server: last.server,
        winner,
        faults: group.length - 1,
        let: winner === null,
        serveFrame: last.point.serveLast!,
        hitFrames: last.hits,
        rallyHits: last.hits.length,
      };
    });
  }

  finalPointFromPendingScore(points: Te4RawPoint[]): Te4CompletedPoint {
    const lastPointEnd = this.pointEnds().at(-1);
    if (lastPointEnd === undefined) {
      throw new Te4DmoAnalysisError('No completed point markers were found in the recording.');
    }
    const servesAfter = this.serves().filter((serve) => serve > lastPointEnd);
    const serveFrame = servesAfter.at(-1);
    if (serveFrame === undefined) {
      throw new Te4DmoAnalysisError('The recording ends before a final point can be inferred.');
    }
    const scored = points.filter((point) => !point.let && point.winner !== null);
    const score = playScore(scored.map((point) => [point.winner!, point.server]));
    const winner: 1 | 2 = score.points[0] > score.points[1] ? 1 : 2;
    return {
      start: lastPointEnd + 1,
      end: this.frameCount - 1,
      server: this.serverAt(serveFrame),
      winner,
      faults: 0,
      let: false,
      serveFrame,
      hitFrames: this.hits().filter((hit) => hit > lastPointEnd),
      rallyHits: 0,
    };
  }
}

export function playScore(winnersAndServers: Array<[1 | 2, 1 | 2]>): Te4ScoreState {
  const sets: Array<[number, number]> = [];
  const games = [0, 0];
  const points = [0, 0];
  const rows: Te4ScoreRow[] = [];
  const scoreLabels = ['0', '15', '30', '40'];
  let tiebreak = false;

  for (const [winner] of winnersAndServers) {
    let pointText: string;
    if (tiebreak) {
      pointText = `${points[0]}-${points[1]}`;
    } else {
      const [p1, p2] = points;
      if (p1 >= 3 && p2 >= 3) {
        pointText = p1 === p2 ? 'deuce' : p1 > p2 ? 'ad 1' : 'ad 2';
      } else {
        pointText = `${scoreLabels[Math.min(p1, 3)]}-${scoreLabels[Math.min(p2, 3)]}`;
      }
    }
    rows.push({
      sets: sets.map(([a, b]) => [a, b]),
      games: pair(games),
      points: pointText,
      tiebreak,
    });

    points[winner - 1] += 1;
    const [p1, p2] = points;
    const gameWon = tiebreak
      ? Math.max(p1, p2) >= 7 && Math.abs(p1 - p2) >= 2
      : Math.max(p1, p2) >= 4 && Math.abs(p1 - p2) >= 2;
    if (!gameWon) continue;

    points[0] = 0;
    points[1] = 0;
    games[winner - 1] += 1;
    if (
      (Math.max(games[0], games[1]) >= 6 && Math.abs(games[0] - games[1]) >= 2)
      || Math.max(games[0], games[1]) === 7
    ) {
      sets.push(pair(games));
      games[0] = 0;
      games[1] = 0;
      tiebreak = false;
    } else {
      tiebreak = games[0] === 6 && games[1] === 6;
    }
  }
  return { rows, sets, games: pair(games), points: pair(points) };
}

import type { Te4LiveSnapshot, Te4LiveSoundEvent } from './te4DmoLive';
import type { Te4ViewerData, Te4ViewerPoint } from './te4DmoTypes';

const MAX_MATCH_BYTES = 64 * 1024 * 1024;
const COURT_SAMPLE_STEP = 2;

function zeroStats(): Te4LiveSnapshot['stats'][number] {
  return {
    servicePoints: 0,
    servicePointsWon: 0,
    serviceWinRate: null,
    pointsWon: 0,
    firstServeFaults: 0,
    acesOrUnreturned: 0,
  };
}

function gameScore(point: Te4ViewerPoint | undefined): [number, number] {
  if (!point) return [0, 0];
  const values = point.g.match(/\d+/g)?.map(Number);
  return values?.length === 2 && values.every(Number.isInteger)
    ? [values[0], values[1]]
    : [0, 0];
}

function replayPoint(point: Te4ViewerPoint): Te4LiveSnapshot['recentPoints'][number] {
  return {
    number: point.k,
    scoreLabel: point.pt,
    server: point.s,
    winner: point.w,
    rallyHits: point.sh.length,
    faults: point.f,
  };
}

export function te4ViewerToLiveSnapshot(
  viewer: Te4ViewerData,
  handedness: ['left' | 'right', 'left' | 'right'] = ['right', 'right'],
): Te4LiveSnapshot {
  const frameCount = viewer.match?.n;
  const frameRate = viewer.match?.fps;
  const encodedFrames = viewer.match?.d;
  if (
    !Number.isInteger(frameCount)
    || frameCount < 2
    || !Number.isFinite(frameRate)
    || frameRate <= 0
    || typeof encodedFrames !== 'string'
    || frameCount * 14 > MAX_MATCH_BYTES
  ) {
    throw new Error('The full replay court data is incomplete.');
  }

  const expectedByteLength = frameCount * 14;
  if (encodedFrames.length > Math.ceil(expectedByteLength / 3) * 4 + 4) {
    throw new Error('The full replay court data is incomplete.');
  }
  const bytesString = atob(encodedFrames);
  if (bytesString.length !== expectedByteLength) {
    throw new Error('The full replay court data is incomplete.');
  }
  const bytes = new Uint8Array(bytesString.length);
  for (let index = 0; index < bytesString.length; index += 1) {
    bytes[index] = bytesString.charCodeAt(index);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const court: number[][] = [];
  const courtFrameIndices: number[] = [];
  for (let frame = 0; frame < frameCount; frame += COURT_SAMPLE_STEP) {
    const offset = frame * 14;
    const values = Array.from({ length: 7 }, (_, index) =>
      view.getInt16(offset + index * 2, true),
    );
    if (
      values.slice(0, 2).some((value) => Math.abs(value) > 5000)
      || values[2] < 0
      || values[2] > 1000
      || values.slice(3).some((value) => Math.abs(value) > 5000)
    ) continue;
    court.push(values);
    courtFrameIndices.push(frame);
  }
  if (court.length < 2) throw new Error('The full replay has too few valid court frames.');

  const trajectoryEvents: NonNullable<Te4LiveSnapshot['trajectoryEvents']> = [];
  const soundEvents: Te4LiveSoundEvent[] = [];
  const seenSounds = new Set<string>();
  const addSound = (frame: number, kind: Te4LiveSoundEvent['kind']) => {
    if (!Number.isInteger(frame) || frame < 0 || frame >= frameCount) return;
    const key = `${frame}:${kind}`;
    if (seenSounds.has(key)) return;
    seenSounds.add(key);
    soundEvents.push({ frame, kind });
  };

  for (const point of viewer.pts) {
    for (const shot of point.sh) {
      const frame = point.mf + shot.t;
      if (Number.isInteger(frame) && frame >= 0 && frame < frameCount) {
        trajectoryEvents.push({
          frame,
          kind: 'shot',
          player: shot.p,
          shotType: shot.k === 's' ? 'serve' : 'rally',
          ...(shot.v > 0 ? { speedKmh: shot.v } : {}),
        });
        addSound(frame, 'racket');
      }
      if (shot.bt !== null) addSound(point.mf + shot.bt, 'bounce');
    }
    if (point.fc > 0) {
      const endFrame = Math.min(frameCount - 1, point.mf + point.fc - 1);
      if (endFrame >= 0) trajectoryEvents.push({ frame: endFrame, kind: 'point-end' });
    }
  }
  trajectoryEvents.sort((first, second) =>
    first.frame - second.frame
    || (first.kind === second.kind ? 0 : first.kind === 'shot' ? -1 : 1),
  );
  soundEvents.sort((first, second) => first.frame - second.frame || first.kind.localeCompare(second.kind));

  const lastPoint = viewer.pts.at(-1);
  const sets = viewer.final.ss.map(([first, second]) => [first, second] as [number, number]);
  const games = gameScore(lastPoint);
  const playerOneChance = Math.max(0, Math.min(1, Number(viewer.final.wp)));
  const recentPoints = viewer.pts.slice(-12).map(replayPoint);
  const points = [
    Number(lastPoint?.pt.match(/\d+/)?.[0] ?? 0),
    Number(lastPoint?.pt.match(/\d+$/)?.[0] ?? 0),
  ] as [number, number];

  return {
    version: 1,
    filename: `Full replay: ${viewer.names[0]} vs ${viewer.names[1]}`.slice(0, 120),
    stadium: viewer.tournament?.slice(0, 80) ?? null,
    players: viewer.names,
    frameCount,
    frameRate,
    courtFrameCount: frameCount,
    pointCount: viewer.pts.length,
    bestOf: sets.length >= 5 ? 5 : 3,
    score: {
      sets,
      games,
      points,
      pointText: lastPoint?.pt.includes('-')
        ? lastPoint.pt.split('-').slice(0, 2).map((value) => value.slice(0, 4)) as [string, string]
        : ['—', '—'],
      tiebreak: lastPoint?.tb === 1,
      server: lastPoint?.s ?? null,
    },
    currentPoint: {
      number: (lastPoint?.k ?? 0) + 1,
      server: lastPoint?.s ?? null,
      rallyHits: lastPoint?.sh.length ?? 0,
      serveSpeedKmh: lastPoint?.sh.find((shot) => shot.k === 's')?.v ?? null,
      inProgress: false,
    },
    winChance: [playerOneChance, 1 - playerOneChance],
    winHistory: [],
    stats: [zeroStats(), zeroStats()],
    recentPoints,
    court,
    courtFrameIndices,
    trajectoryEvents,
    soundEvents,
    handedness,
  };
}

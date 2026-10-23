'use client';

import { memo, useEffect, useRef, useState } from 'react';
import { Minus, Plus, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import { TE4_DMO_FRAMES_PER_SECOND } from '@/lib/te4DmoLive';
import type { Te4DmoReplaySpeed, Te4LiveSnapshot } from '@/lib/te4DmoLive';
import type { Te4CourtSurface } from '@/lib/te4DmoTypes';
import {
  createCourtProjector,
  DEFAULT_LIVE_COURT_CAMERA,
  findCourtRacketContact,
  playerRightVector,
  type LiveCourtCamera,
  type LiveCourtProjectedPoint,
  type LiveCourtWorldPoint,
} from '@/lib/liveCourtProjection';
import {
  advanceLiveCourtPlayhead,
  interpolateLiveCourtFrame,
  latestLiveCourtMotionEvent,
  mergeLiveCourtEvents,
  mergeLiveCourtSamples,
  type LiveCourtCoordinates,
  type LiveCourtMotionEvent,
  type LiveCourtSample,
} from '@/lib/liveCourtMotion';
import styles from './DmoLiveCourt.module.css';

type WorldPoint = LiveCourtWorldPoint;
type ProjectedPoint = LiveCourtProjectedPoint;
type Props = {
  snapshot: Te4LiveSnapshot;
  surface: Te4CourtSurface;
  playbackSpeed: Te4DmoReplaySpeed;
};

const surfacePalette: Record<Te4CourtSurface, { court: string; apron: string }> = {
  hard: { court: '#50b9ae', apron: '#f6a77b' },
  clay: { court: '#e98d68', apron: '#f6c27d' },
  grass: { court: '#62b66f', apron: '#f6a77b' },
  unknown: { court: '#78aab0', apron: '#f1c58f' },
};

function drawScene(
  context: CanvasRenderingContext2D,
  samples: LiveCourtSample[],
  trajectoryEvents: LiveCourtMotionEvent[],
  players: [string, string],
  surface: Te4CourtSurface,
  camera: LiveCourtCamera,
  zoom: number,
  cursor: number,
  playbackSpeed: Te4DmoReplaySpeed,
) {
  const width = 900;
  const height = 520;
  const palette = surfacePalette[surface];
  const cameraAzimuth = camera.azimuth * Math.PI / 180;
  const cameraFacingX = Math.cos(cameraAzimuth);
  const cameraFacingY = Math.sin(cameraAzimuth);
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#f3dfae';
  context.fillRect(0, 0, width, height);

  const rawProject = createCourtProjector(camera, zoom);
  const project = (x: number, y: number, z: number): ProjectedPoint => rawProject([x, y, z]);
  const polygon = (
    points: WorldPoint[],
    fill: string | null,
    stroke: string | null,
  ) => {
    context.beginPath();
    points.forEach(([x, y, z], index) => {
      const [screenX, screenY] = project(x, y, z);
      if (index === 0) context.moveTo(screenX, screenY);
      else context.lineTo(screenX, screenY);
    });
    if (fill) {
      context.fillStyle = fill;
      context.fill();
    }
    if (stroke) {
      context.strokeStyle = stroke;
      context.stroke();
    }
  };

  const line = (points: WorldPoint[], color: string, widthValue: number) => {
    if (points.length < 2) return;
    context.beginPath();
    points.forEach(([x, y, z], index) => {
      const [screenX, screenY] = project(x, y, z);
      if (index === 0) context.moveTo(screenX, screenY);
      else context.lineTo(screenX, screenY);
    });
    context.strokeStyle = color;
    context.lineWidth = widthValue;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.stroke();
  };

  polygon([[-1450, -700, 0], [1450, -700, 0], [1450, 700, 0], [-1450, 700, 0]], palette.apron, null);
  polygon([[-1275, -590, 0], [1275, -590, 0], [1275, 590, 0], [-1275, 590, 0]], palette.court, null);
  if (surface === 'grass') {
    for (let y = -520; y < 560; y += 180) {
      polygon([[-1270, y, 0], [1270, y, 0], [1270, y + 78, 0], [-1270, y + 78, 0]], 'rgba(255,255,255,.055)', null);
    }
  }

  context.lineWidth = 2;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  const lineColor = 'rgba(250,252,255,.94)';
  [
    [-1189, -549, 1189, -549],
    [-1189, 549, 1189, 549],
    [-1189, -411, 1189, -411],
    [-1189, 411, 1189, 411],
    [-1189, -549, -1189, 549],
    [1189, -549, 1189, 549],
    [-640, -411, -640, 411],
    [640, -411, 640, 411],
    [-640, 0, 640, 0],
  ].forEach(([x1, y1, x2, y2]) => {
    polygon([[x1, y1, 0], [x2, y2, 0]], null, lineColor);
  });
  polygon([[0, -549, 0], [0, 549, 0], [0, 549, 107], [0, -549, 107]], 'rgba(255,255,255,.18)', lineColor);
  for (let y = -540; y <= 540; y += 54) {
    line([[0, y, 8], [0, y, 100]], 'rgba(241,246,250,.34)', 0.8);
  }
  for (let z = 16; z <= 96; z += 16) {
    line([[0, -549, z], [0, 549, z]], 'rgba(241,246,250,.3)', 0.8);
  }
  line([[0, -560, 0], [0, -560, 120]], '#edf3f7', 3);
  line([[0, 560, 0], [0, 560, 120]], '#edf3f7', 3);

  if (!samples.length) {
    context.fillStyle = 'rgba(8,19,40,.72)';
    context.fillRect(0, 0, width, height);
    context.fillStyle = '#f1f5fb';
    context.font = '700 18px system-ui, sans-serif';
    context.textAlign = 'center';
    context.fillText('Waiting for court positions', width / 2, height / 2);
    return;
  }

  const current = interpolateLiveCourtFrame(
    samples,
    cursor,
    TE4_DMO_FRAMES_PER_SECOND * playbackSpeed / 2,
  );
  if (!current) return;
  const value = (index: number) => current[index];
  const ball = { x: value(0), y: value(1), z: Math.max(0, value(2)) };
  const activeTrajectory = latestLiveCourtMotionEvent(trajectoryEvents, cursor);
  if (activeTrajectory?.kind === 'shot') {
    const trailStart = Math.max(
      activeTrajectory.frame,
      cursor - TE4_DMO_FRAMES_PER_SECOND * 0.25 * playbackSpeed,
    );
    const trail = samples
      .filter((sample) => sample.frame >= trailStart && sample.frame <= cursor)
      .map((sample) => project(sample.values[0], sample.values[1], sample.values[2]));
    const lastSample = samples[samples.length - 1];
    if (cursor > lastSample.frame) trail.push(project(ball.x, ball.y, ball.z));
    for (let index = 1; index < trail.length; index += 1) {
      const opacity = 0.1 + 0.48 * index / Math.max(1, trail.length - 1);
      context.beginPath();
      context.moveTo(trail[index - 1][0], trail[index - 1][1]);
      context.lineTo(trail[index][0], trail[index][1]);
      context.strokeStyle = `rgba(250,204,21,${opacity.toFixed(3)})`;
      context.lineWidth = 1.4 + opacity;
      context.shadowColor = 'rgba(250,204,21,.2)';
      context.shadowBlur = 2;
      context.stroke();
    }
    context.shadowBlur = 0;
  }

  const [ballShadowX, ballShadowY, ballScale] = project(ball.x, ball.y, 0);
  const [ballX, ballY] = project(ball.x, ball.y, ball.z);
  context.fillStyle = 'rgba(0,0,0,.3)';
  context.beginPath();
  context.ellipse(ballShadowX, ballShadowY, 5 * ballScale, 3 * ballScale, 0, 0, Math.PI * 2);
  context.fill();

  const playerActors = [
    { x: value(3), y: value(4), color: '#eaa134', name: players[0], id: 1 as const },
    { x: value(5), y: value(6), color: '#e05d64', name: players[1], id: 2 as const },
  ];
  const contactPlayer = findCourtRacketContact(ball, playerActors, activeTrajectory, cursor);

  const drawPlayer = (player: typeof playerActors[number]) => {
    const { x, y, color, name, id } = player;
    const distance = Math.hypot(ball.x - x, ball.y - y);
    const facing: WorldPoint = distance > 1
      ? [(ball.x - x) / distance, (ball.y - y) / distance, 0]
      : [id === 1 ? 1 : -1, 0, 0];
    const facingCamera = facing[0] * cameraFacingX + facing[1] * cameraFacingY > 0;
    const [groundX, groundY, groundScale] = project(x, y, 0);
    const playerRight = playerRightVector(facing);
    const projectedRight = project(
      x + playerRight[0] * 100,
      y + playerRight[1] * 100,
      0,
    );
    const rightSide = projectedRight[0] >= groundX ? 1 : -1;
    const figureScale = Math.max(0.9, Math.min(1.12, groundScale * 3.6));
    context.fillStyle = 'rgba(32,52,66,.22)';
    context.beginPath();
    context.ellipse(groundX, groundY, 26 * groundScale, 12 * groundScale, 0, 0, Math.PI * 2);
    context.fill();
    context.save();
    context.translate(groundX, groundY);
    context.scale(figureScale, figureScale);
    const outline = '#203442';
    const skin = id === 1 ? '#df9c70' : '#f0b88b';
    const shorts = id === 1 ? '#31546a' : '#873e53';
    const limb = (points: [number, number][], limbColor: string, thickness: number) => {
      context.beginPath();
      points.forEach(([pointX, pointY], index) => {
        if (index === 0) context.moveTo(pointX, pointY);
        else context.lineTo(pointX, pointY);
      });
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.strokeStyle = outline;
      context.lineWidth = thickness + 4;
      context.stroke();
      context.strokeStyle = limbColor;
      context.lineWidth = thickness;
      context.stroke();
    };
    const shape = (points: [number, number][], fill: string) => {
      context.beginPath();
      points.forEach(([pointX, pointY], index) => {
        if (index === 0) context.moveTo(pointX, pointY);
        else context.lineTo(pointX, pointY);
      });
      context.closePath();
      context.fillStyle = fill;
      context.fill();
      context.strokeStyle = outline;
      context.lineWidth = 3;
      context.lineJoin = 'round';
      context.stroke();
    };
    const dot = (dotX: number, dotY: number, radius: number, fill: string) => {
      context.beginPath();
      context.arc(dotX, dotY, radius, 0, Math.PI * 2);
      context.fillStyle = fill;
      context.fill();
    };
    const leftHip: [number, number] = [-8, -25];
    const rightHip: [number, number] = [8, -25];
    const leftKnee: [number, number] = [-12, -14];
    const rightKnee: [number, number] = [12, -14];
    const leftFoot: [number, number] = [-15, -3];
    const rightFoot: [number, number] = [15, -3];
    limb([leftHip, leftKnee, leftFoot], skin, 8);
    limb([rightHip, rightKnee, rightFoot], skin, 8);
    limb([leftFoot, [-22, -2]], '#fff9e8', 8);
    limb([rightFoot, [22, -2]], '#fff9e8', 8);
    shape([leftHip, rightHip, [11, -16], [8, -27], [-8, -27], [-11, -16]], shorts);
    shape([[-11, -53], [11, -53], [16, -47], [14, -31], [9, -26], [-9, -26], [-14, -31], [-16, -47]], color);
    limb([[-rightSide * 14, -48], [-rightSide * 21, -41], [-rightSide * 21, -33]], skin, 7);
    limb([[rightSide * 14, -48], [rightSide * 20, -41], [rightSide * 20, -34]], skin, 7);
    limb([[rightSide * 20, -34], [rightSide * 25, -30]], skin, 6);
    limb([[-rightSide * 21, -33], [-rightSide * 17, -30]], skin, 6);
    limb([[-8, -49], [0, -45], [8, -49]], '#fff1d0', 2.5);
    limb([[-9, -30], [9, -30]], 'rgba(255,255,255,.7)', 2);

    context.beginPath();
    context.arc(0, -65, 12, 0, Math.PI * 2);
    context.fillStyle = skin;
    context.fill();
    context.strokeStyle = outline;
    context.lineWidth = 3;
    context.stroke();
    context.beginPath();
    context.ellipse(0, -68, 11, 7, 0, Math.PI, Math.PI * 2);
    context.fillStyle = id === 1 ? '#253c49' : '#4e3435';
    context.fill();
    if (facingCamera) {
      context.beginPath();
      context.arc(-4, -66, 1.5, 0, Math.PI * 2);
      context.arc(4, -66, 1.5, 0, Math.PI * 2);
      context.fillStyle = outline;
      context.fill();
      context.beginPath();
      context.arc(0, -61, 3, 0.18 * Math.PI, 0.82 * Math.PI);
      context.strokeStyle = outline;
      context.lineWidth = 1.7;
      context.stroke();
    } else {
      context.beginPath();
      context.arc(0, -65, 11, 0, Math.PI * 2);
      context.fillStyle = id === 1 ? '#253c49' : '#4e3435';
      context.fill();
      context.beginPath();
      context.ellipse(0, -55, 6, 2.5, 0, 0, Math.PI * 2);
      context.fillStyle = skin;
      context.fill();
    }

    const isHitting = contactPlayer === id;
    const projectedBall = project(ball.x, ball.y, ball.z);
    const screenX = projectedBall[0] - groundX;
    const screenY = projectedBall[1] - groundY;
    const localBallX = screenX / figureScale;
    const localBallY = screenY / figureScale;
    const racketHand: [number, number] = [rightSide * 20, -34];
    const racketCenter: [number, number] = isHitting
      ? [Math.max(-52, Math.min(52, localBallX)), Math.max(-70, Math.min(-12, localBallY))]
      : [rightSide * 34, -49];
    limb([[rightSide * 14, -48], [rightSide * 19, -42], racketHand], skin, 6);
    limb([[racketHand[0], racketHand[1]], racketCenter], '#fff1d0', 2.5);
    const racketAngle = Math.atan2(racketCenter[1] - racketHand[1], racketCenter[0] - racketHand[0]) + Math.PI / 2;
    context.save();
    context.translate(racketCenter[0], racketCenter[1]);
    context.rotate(racketAngle);
    context.beginPath();
    context.ellipse(0, 0, 7, 12, 0, 0, Math.PI * 2);
    context.fillStyle = 'rgba(255,249,232,.35)';
    context.fill();
    context.strokeStyle = outline;
    context.lineWidth = 2.5;
    context.stroke();
    context.beginPath();
    context.moveTo(-5, -5);
    context.lineTo(5, 5);
    context.moveTo(5, -5);
    context.lineTo(-5, 5);
    context.strokeStyle = 'rgba(32,52,66,.55)';
    context.lineWidth = 1;
    context.stroke();
    context.restore();

    context.font = '700 20px system-ui, sans-serif';
    context.textAlign = 'center';
    context.lineWidth = 4;
    context.strokeStyle = '#203442';
    context.strokeText(name, 0, -86);
    context.fillStyle = '#fff9e8';
    context.fillText(name, 0, -86);
    context.restore();
    if (isHitting) {
      context.beginPath();
      context.arc(projectedBall[0], projectedBall[1], Math.max(6, 14 * ballScale), 0, Math.PI * 2);
      context.strokeStyle = 'rgba(224,122,67,.72)';
      context.lineWidth = 2;
      context.stroke();
    }
  };

  playerActors
    .sort((a, b) => project(b.x, b.y, 0)[3] - project(a.x, a.y, 0)[3])
    .forEach(drawPlayer);
  const ballRadius = Math.max(1.8, 3.4 * ballScale);
  context.fillStyle = '#e8f84a';
  context.strokeStyle = '#f6ff9c';
  context.lineWidth = 1;
  context.shadowColor = 'rgba(232,248,74,.65)';
  context.shadowBlur = contactPlayer ? 8 : 3;
  context.beginPath();
  context.arc(ballX, ballY, ballRadius, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.shadowBlur = 0;
}

function playSynthesizedCue(context: AudioContext, kind: 'racket' | 'bounce') {
  const now = context.currentTime;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const racket = kind === 'racket';
  oscillator.type = racket ? 'triangle' : 'sine';
  oscillator.frequency.setValueAtTime(racket ? 720 : 390, now);
  oscillator.frequency.exponentialRampToValueAtTime(racket ? 260 : 150, now + (racket ? 0.055 : 0.09));
  gain.gain.setValueAtTime(racket ? 0.035 : 0.028, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + (racket ? 0.06 : 0.1));
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + (racket ? 0.06 : 0.1));
}

function DmoLiveCourt({ snapshot, surface, playbackSpeed }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cameraDragRef = useRef<{ x: number; y: number } | null>(null);
  const sampleBufferRef = useRef<LiveCourtSample[]>([]);
  const trajectoryEventsRef = useRef<LiveCourtMotionEvent[]>([]);
  const playheadRef = useRef<number | null>(null);
  const previousSnapshotRef = useRef({
    filename: snapshot.filename,
    players: snapshot.players,
    frameCount: snapshot.frameCount,
  });
  const audioContextRef = useRef<AudioContext | null>(null);
  const lastSoundFrameRef = useRef(Math.max(0, snapshot.frameCount - 3));
  const playedSoundEventsRef = useRef(new Set<string>());
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [soundError, setSoundError] = useState('');
  const sceneRef = useRef({
    samples: sampleBufferRef.current,
    trajectoryEvents: trajectoryEventsRef.current,
    players: snapshot.players,
    surface,
    playbackSpeed,
    camera: DEFAULT_LIVE_COURT_CAMERA,
    zoom: 1,
  });
  const [cameraAzimuth, setCameraAzimuth] = useState(DEFAULT_LIVE_COURT_CAMERA.azimuth);
  const [cameraElevation, setCameraElevation] = useState(DEFAULT_LIVE_COURT_CAMERA.elevation);
  const [zoom, setZoom] = useState(1);
  sceneRef.current = {
    samples: sampleBufferRef.current,
    trajectoryEvents: trajectoryEventsRef.current,
    players: snapshot.players,
    surface,
    playbackSpeed,
    camera: { azimuth: cameraAzimuth, elevation: cameraElevation },
    zoom,
  };

  useEffect(() => {
    const previousSnapshot = previousSnapshotRef.current;
    const identityChanged = snapshot.filename !== previousSnapshot.filename
      || snapshot.players[0] !== previousSnapshot.players[0]
      || snapshot.players[1] !== previousSnapshot.players[1]
      || snapshot.frameCount < previousSnapshot.frameCount;
    if (identityChanged) {
      sampleBufferRef.current = [];
      trajectoryEventsRef.current = [];
      playheadRef.current = null;
    }
    previousSnapshotRef.current = {
      filename: snapshot.filename,
      players: snapshot.players,
      frameCount: snapshot.frameCount,
    };

    const courtFrameCount = Math.max(
      1,
      Math.floor(snapshot.courtFrameCount ?? snapshot.court.length),
    );
    const firstFrame = Math.max(0, snapshot.frameCount - courtFrameCount);
    const incomingSamples: LiveCourtSample[] = snapshot.court.flatMap((frame, index) => {
      if (frame.length < 7 || !frame.slice(0, 7).every(Number.isFinite)) return [];
      const frameIndex = snapshot.courtFrameIndices?.[index]
        ?? firstFrame + Math.round(
          index * Math.max(0, courtFrameCount - 1) / Math.max(1, snapshot.court.length - 1),
        );
      const values = frame.slice(0, 7) as LiveCourtCoordinates;
      return [{ frame: frameIndex, values }];
    });
    const maxFrameSpan = TE4_DMO_FRAMES_PER_SECOND * 10 * playbackSpeed;
    sampleBufferRef.current = mergeLiveCourtSamples(
      sampleBufferRef.current,
      incomingSamples,
      maxFrameSpan,
    );
    const earliestFrame = sampleBufferRef.current[0]?.frame ?? firstFrame;
    trajectoryEventsRef.current = mergeLiveCourtEvents(
      trajectoryEventsRef.current,
      snapshot.trajectoryEvents ?? [],
      earliestFrame,
    );
    if (playheadRef.current === null && sampleBufferRef.current.length) {
      playheadRef.current = sampleBufferRef.current[0].frame;
    } else if (playheadRef.current !== null && playheadRef.current < earliestFrame) {
      playheadRef.current = earliestFrame;
    }
    sceneRef.current = {
      ...sceneRef.current,
      samples: sampleBufferRef.current,
      trajectoryEvents: trajectoryEventsRef.current,
    };
  }, [snapshot, playbackSpeed]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    let animation = 0;
    let lastTime = performance.now();
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const tick = (now: number) => {
      const elapsed = Math.min(80, Math.max(0, now - lastTime));
      lastTime = now;
      const current = sceneRef.current;
      const samples = current.samples;
      if (!motionPreference.matches && samples.length > 1) {
        playheadRef.current = advanceLiveCourtPlayhead(
          playheadRef.current,
          elapsed,
          current.playbackSpeed,
          samples,
          TE4_DMO_FRAMES_PER_SECOND,
        );
      }
      const cursor = motionPreference.matches
        ? samples[samples.length - 1]?.frame ?? 0
        : playheadRef.current ?? samples[0]?.frame ?? 0;
      drawScene(
        context,
        samples,
        current.trajectoryEvents,
        current.players,
        current.surface,
        current.camera,
        current.zoom,
        cursor,
        current.playbackSpeed,
      );
      animation = window.requestAnimationFrame(tick);
    };
    animation = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(animation);
  }, []);

  useEffect(() => {
    if (!soundEnabled) return;
    const context = audioContextRef.current;
    if (!context || context.state !== 'running') return;
    if (snapshot.frameCount < lastSoundFrameRef.current) {
      playedSoundEventsRef.current.clear();
      lastSoundFrameRef.current = Math.max(0, snapshot.frameCount - 3);
    }

    for (const event of snapshot.soundEvents ?? []) {
      const key = `${event.frame}:${event.kind}`;
      if (event.frame < lastSoundFrameRef.current || playedSoundEventsRef.current.has(key)) continue;
      playSynthesizedCue(context, event.kind);
      playedSoundEventsRef.current.add(key);
    }
    lastSoundFrameRef.current = Math.max(lastSoundFrameRef.current, snapshot.frameCount - 3);

    const oldestRetainedFrame = snapshot.frameCount - 600;
    for (const key of playedSoundEventsRef.current) {
      if (Number(key.slice(0, key.indexOf(':'))) < oldestRetainedFrame) {
        playedSoundEventsRef.current.delete(key);
      }
    }
  }, [snapshot.frameCount, snapshot.soundEvents, soundEnabled]);

  useEffect(() => () => {
    void audioContextRef.current?.close();
    audioContextRef.current = null;
  }, []);

  const toggleSound = async () => {
    if (soundEnabled) {
      setSoundEnabled(false);
      return;
    }
    try {
      if (!audioContextRef.current) audioContextRef.current = new AudioContext();
      await audioContextRef.current.resume();
      lastSoundFrameRef.current = Math.max(0, snapshot.frameCount - 3);
      setSoundError('');
      setSoundEnabled(true);
    } catch {
      setSoundError('Sound could not be enabled in this browser.');
    }
  };

  return (
    <section className={styles.scene} aria-label="Live court view">
      <div className={styles.sceneToolbar}>
        <div className={styles.sceneTitle}>
          <strong>LIVE COURT</strong>
        </div>
        <div className={styles.sceneControls}>
          <label className={styles.cameraControl}>
            <span>ORBIT</span>
            <input
              aria-label="Camera orbit angle"
              type="range"
              min="0"
              max="359"
              step="1"
              value={cameraAzimuth}
              onChange={(event) => setCameraAzimuth(Number(event.currentTarget.value))}
            />
            <output>{Math.round(cameraAzimuth)}°</output>
          </label>
          <label className={styles.cameraControl}>
            <span>ELEVATION</span>
            <input
              aria-label="Camera elevation"
              type="range"
              min="5"
              max="90"
              step="1"
              value={cameraElevation}
              onChange={(event) => setCameraElevation(Number(event.currentTarget.value))}
            />
            <output>{cameraElevation}°</output>
          </label>
          <button
            type="button"
            aria-label="Reset court camera"
            title="Reset court camera"
            onClick={() => {
              setCameraAzimuth(DEFAULT_LIVE_COURT_CAMERA.azimuth);
              setCameraElevation(DEFAULT_LIVE_COURT_CAMERA.elevation);
              setZoom(1);
            }}
          >
            <RotateCcw size={14} />
          </button>
          <button type="button" aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(0.7, Math.round((value - 0.1) * 10) / 10))}>
            <Minus size={15} />
          </button>
          <input
            className={styles.zoomRange}
            aria-label="Court zoom"
            type="range"
            min="0.7"
            max="1.8"
            step="0.1"
            value={zoom}
            onChange={(event) => setZoom(Number(event.currentTarget.value))}
          />
          <button type="button" aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(1.8, Math.round((value + 0.1) * 10) / 10))}>
            <Plus size={15} />
          </button>
          <output>{Math.round(zoom * 100)}%</output>
          <button
            type="button"
            aria-label={soundEnabled ? 'Mute synthesized court sounds' : 'Enable synthesized court sounds'}
            aria-pressed={soundEnabled}
            title={soundEnabled ? 'Mute synthesized court sounds' : 'Enable synthesized court sounds'}
            onClick={() => void toggleSound()}
          >
            {soundEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
          </button>
        </div>
      </div>
      <div className={styles.viewport}>
        <canvas
          ref={canvasRef}
          width={900}
          height={520}
          role="img"
          aria-label={`Interactive tennis court with ${snapshot.players[0]} and ${snapshot.players[1]}; drag to orbit the camera`}
          title="Drag to rotate the camera"
          onPointerDown={(event) => {
            cameraDragRef.current = { x: event.clientX, y: event.clientY };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const previous = cameraDragRef.current;
            if (!previous) return;
            const deltaX = event.clientX - previous.x;
            const deltaY = event.clientY - previous.y;
            setCameraAzimuth((value) => {
              const next = (value + deltaX * 0.55) % 360;
              return Math.round((next + 360) % 360);
            });
            setCameraElevation((value) => Math.max(5, Math.min(90, Math.round(value - deltaY * 0.35))));
            cameraDragRef.current = { x: event.clientX, y: event.clientY };
          }}
          onPointerUp={() => { cameraDragRef.current = null; }}
          onPointerCancel={() => { cameraDragRef.current = null; }}
        />
      </div>
      <div className={styles.legend}>
        <span><i className={styles.playerOne} />{snapshot.players[0]}</span>
        <span><i className={styles.playerTwo} />{snapshot.players[1]}</span>
        <span><i className={styles.ball} />Ball</span>
        <span className={styles.sceneNote}>Drag to orbit · adjust angle and elevation</span>
      </div>
      {soundError && <p role="status">{soundError}</p>}
    </section>
  );
}

export default memo(DmoLiveCourt);

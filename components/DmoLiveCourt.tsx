'use client';

import { useEffect, useRef, useState } from 'react';
import { Minus, Plus, Volume2, VolumeX } from 'lucide-react';
import { TE4_DMO_FRAMES_PER_SECOND } from '@/lib/te4DmoLive';
import type { Te4DmoReplaySpeed, Te4LiveSnapshot } from '@/lib/te4DmoLive';
import type { Te4CourtSurface } from '@/lib/te4DmoTypes';
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

type CameraView = 't' | 'p' | 's' | 'q';
type ProjectedPoint = [number, number, number];
type Props = {
  snapshot: Te4LiveSnapshot;
  surface: Te4CourtSurface;
  playbackSpeed: Te4DmoReplaySpeed;
};

const surfacePalette: Record<Te4CourtSurface, { court: string; apron: string }> = {
  hard: { court: '#28779b', apron: '#c8d7e0' },
  clay: { court: '#b55f3d', apron: '#d3a27f' },
  grass: { court: '#367b45', apron: '#294c32' },
  unknown: { court: '#526b79', apron: '#aebbc2' },
};

function drawScene(
  context: CanvasRenderingContext2D,
  samples: LiveCourtSample[],
  trajectoryEvents: LiveCourtMotionEvent[],
  players: [string, string],
  surface: Te4CourtSurface,
  camera: CameraView,
  zoom: number,
  cursor: number,
  playbackSpeed: Te4DmoReplaySpeed,
) {
  const width = 900;
  const height = 520;
  const palette = surfacePalette[surface];
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#101923';
  context.fillRect(0, 0, width, height);

  const rawProject = (x: number, y: number, z: number): ProjectedPoint => {
    if (camera === 't') return [450 + x * 0.3, 260 + y * 0.3 - z * 0.08, 1.3];
    if (camera === 'p') {
      const depth = x + 2900;
      const scale = 700 / depth;
      return [450 + y * scale, 70 + 640000 / depth - z * scale, scale * 2.2];
    }
    if (camera === 's') {
      const depth = y + 1850;
      const scale = 430 / depth;
      return [450 + x * scale, 50 + 580000 / depth - z * scale, scale * 2.2];
    }
    const depth = x + y * 0.45 + 3200;
    const scale = 650 / depth;
    return [450 + (y - x * 0.3) * scale, 40 + 610000 / depth - z * scale, scale * 2.2];
  };
  const project = (x: number, y: number, z: number): ProjectedPoint => {
    const [screenX, screenY, scale] = rawProject(x, y, z);
    return [
      450 + (screenX - 450) * zoom,
      260 + (screenY - 260) * zoom,
      scale * zoom,
    ];
  };
  const polygon = (
    points: Array<[number, number, number]>,
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
    { x: value(3), y: value(4), color: '#f59e0b', name: players[0], id: 1 as const },
    { x: value(5), y: value(6), color: '#ef4444', name: players[1], id: 2 as const },
  ].sort((a, b) => b.x - a.x);

  const drawPlayer = (x: number, y: number, color: string, name: string, id: 1 | 2) => {
    const [screenX, screenY, rawScale] = project(x, y, 0);
    const scale = Math.max(0.68, rawScale);
    const skin = '#f0c7a6';
    const outline = '#17212b';
    const shorts = id === 1 ? '#15566d' : '#742f42';
    const top = screenY - 38 * scale;
    const hip = screenY - 16 * scale;
    const headY = screenY - 49 * scale;
    context.fillStyle = 'rgba(0,0,0,.32)';
    context.beginPath();
    context.ellipse(screenX, screenY, 12 * scale, 4.5 * scale, 0, 0, Math.PI * 2);
    context.fill();

    const limb = (x1: number, y1: number, x2: number, y2: number, thickness: number, colorValue: string) => {
      context.lineCap = 'round';
      context.strokeStyle = outline;
      context.lineWidth = thickness + 2 * scale;
      context.beginPath();
      context.moveTo(x1, y1);
      context.lineTo(x2, y2);
      context.stroke();
      context.strokeStyle = colorValue;
      context.lineWidth = thickness;
      context.beginPath();
      context.moveTo(x1, y1);
      context.lineTo(x2, y2);
      context.stroke();
    };

    limb(screenX - 4 * scale, hip, screenX - 6 * scale, screenY - 4 * scale, 4 * scale, skin);
    limb(screenX + 4 * scale, hip, screenX + 6 * scale, screenY - 4 * scale, 4 * scale, skin);
    limb(screenX - 8 * scale, top + 7 * scale, screenX - 14 * scale, top + 16 * scale, 3.5 * scale, skin);
    limb(screenX - 14 * scale, top + 16 * scale, screenX - 12 * scale, top + 23 * scale, 3.5 * scale, skin);
    const handX = screenX + 17 * scale;
    const handY = top + 17 * scale;
    limb(screenX + 8 * scale, top + 7 * scale, screenX + 13 * scale, top + 12 * scale, 4 * scale, skin);
    limb(screenX + 13 * scale, top + 12 * scale, handX, handY, 3.5 * scale, skin);

    context.beginPath();
    context.moveTo(screenX - 8 * scale, top + 3 * scale);
    context.lineTo(screenX + 8 * scale, top + 3 * scale);
    context.lineTo(screenX + 11 * scale, top + 11 * scale);
    context.lineTo(screenX + 7 * scale, hip);
    context.lineTo(screenX - 7 * scale, hip);
    context.lineTo(screenX - 11 * scale, top + 11 * scale);
    context.closePath();
    context.fillStyle = color;
    context.strokeStyle = outline;
    context.lineWidth = 1.4 * scale;
    context.fill();
    context.stroke();
    context.strokeStyle = 'rgba(255,255,255,.55)';
    context.lineWidth = 1.5 * scale;
    context.beginPath();
    context.moveTo(screenX - 5 * scale, top + 7 * scale);
    context.lineTo(screenX + 5 * scale, top + 7 * scale);
    context.stroke();

    context.beginPath();
    context.moveTo(screenX - 7 * scale, hip);
    context.lineTo(screenX + 7 * scale, hip);
    context.lineTo(screenX + 9 * scale, screenY - 7 * scale);
    context.lineTo(screenX + scale, screenY - 7 * scale);
    context.lineTo(screenX, screenY - 11 * scale);
    context.lineTo(screenX - scale, screenY - 7 * scale);
    context.lineTo(screenX - 9 * scale, screenY - 7 * scale);
    context.closePath();
    context.fillStyle = shorts;
    context.strokeStyle = outline;
    context.lineWidth = 1.2 * scale;
    context.fill();
    context.stroke();

    context.fillStyle = '#f5f7fa';
    context.strokeStyle = outline;
    context.lineWidth = scale;
    [[screenX - 7 * scale, screenY - 3 * scale], [screenX + 7 * scale, screenY - 3 * scale]].forEach(([shoeX, shoeY]) => {
      context.beginPath();
      context.ellipse(shoeX, shoeY, 5 * scale, 2.6 * scale, 0, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    });
    context.fillStyle = skin;
    context.beginPath();
    context.arc(screenX, headY, 7 * scale, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = outline;
    context.lineWidth = 1.2 * scale;
    context.stroke();
    context.fillStyle = '#26323f';
    context.beginPath();
    context.arc(screenX, headY - 1.8 * scale, 7.1 * scale, Math.PI, Math.PI * 2);
    context.lineTo(screenX + 7.1 * scale, headY + 0.5 * scale);
    context.quadraticCurveTo(screenX, headY - 2 * scale, screenX - 7.1 * scale, headY + 0.5 * scale);
    context.closePath();
    context.fill();
    context.strokeStyle = '#f7f8fb';
    context.lineWidth = 1.4 * scale;
    context.beginPath();
    context.moveTo(screenX - 7 * scale, headY + scale);
    context.lineTo(screenX + 7 * scale, headY + scale);
    context.stroke();

    const aim = Math.atan2(ballY - handY, ballX - handX) + Math.PI / 2;
    context.save();
    context.translate(handX, handY);
    context.rotate(aim);
    context.lineCap = 'round';
    context.strokeStyle = '#f2f5f8';
    context.lineWidth = Math.max(1.2, 1.8 * scale);
    context.shadowColor = color;
    context.shadowBlur = 3 * scale;
    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(0, -10 * scale);
    context.stroke();
    context.beginPath();
    context.ellipse(0, -20 * scale, 6.5 * scale, 9 * scale, 0, 0, Math.PI * 2);
    context.stroke();
    context.shadowBlur = 0;
    context.strokeStyle = 'rgba(20,30,38,.55)';
    context.lineWidth = Math.max(0.7, 0.8 * scale);
    for (let y = -26 * scale; y <= -14 * scale; y += 4 * scale) {
      const dy = (y + 20 * scale) / (9 * scale);
      if (Math.abs(dy) >= 1) continue;
      const span = 6.5 * scale * Math.sqrt(1 - dy * dy);
      context.beginPath();
      context.moveTo(-span, y);
      context.lineTo(span, y);
      context.stroke();
    }
    for (let x = -4 * scale; x <= 4 * scale; x += 4 * scale) {
      context.beginPath();
      context.moveTo(x, -28 * scale);
      context.lineTo(x, -12 * scale);
      context.stroke();
    }
    context.restore();

    context.font = `700 ${Math.max(10, 9 * scale)}px system-ui, sans-serif`;
    context.textAlign = 'center';
    context.lineWidth = 3 * scale;
    context.strokeStyle = 'rgba(12,20,29,.82)';
    context.strokeText(name, screenX, headY - 11 * scale);
    context.fillStyle = '#ffffff';
    context.fillText(name, screenX, headY - 11 * scale);
  };

  playerActors.forEach((player) => drawPlayer(player.x, player.y, player.color, player.name, player.id));
  context.fillStyle = '#e8f84a';
  context.strokeStyle = '#222';
  context.lineWidth = 1;
  context.beginPath();
  context.arc(ballX, ballY, Math.max(3, 4 * ballScale), 0, Math.PI * 2);
  context.fill();
  context.stroke();
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

export default function DmoLiveCourt({ snapshot, surface, playbackSpeed }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
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
  });
  const [camera, setCamera] = useState<CameraView>('t');
  const [zoom, setZoom] = useState(1);
  sceneRef.current = {
    samples: sampleBufferRef.current,
    trajectoryEvents: trajectoryEventsRef.current,
    players: snapshot.players,
    surface,
    playbackSpeed,
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
        camera,
        zoom,
        cursor,
        current.playbackSpeed,
      );
      animation = window.requestAnimationFrame(tick);
    };
    animation = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(animation);
  }, [camera, zoom, playbackSpeed]);

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
    <section className={styles.scene} aria-label="Reconstructed live court">
      <div className={styles.sceneToolbar}>
        <div className={styles.sceneTitle}>
          <strong>LIVE COURT</strong>
          <span>RECENT DMO MOTION</span>
        </div>
        <div className={styles.sceneControls}>
          <label>
            <span className={styles.visuallyHidden}>Camera angle</span>
            <select value={camera} onChange={(event) => setCamera(event.currentTarget.value as CameraView)}>
              <option value="t">Overhead</option>
              <option value="p">Baseline</option>
              <option value="s">Sideline</option>
              <option value="q">Three-quarter</option>
            </select>
          </label>
          <button type="button" aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(0.7, Math.round((value - 0.1) * 10) / 10))}>
            <Minus size={15} />
          </button>
          <input
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
          aria-label={`Reconstructed tennis court with ${snapshot.players[0]} and ${snapshot.players[1]} moving to the ball`}
        />
        <span className={styles.reconstructionTag}>POSITION DATA · NOT GAME VIDEO</span>
      </div>
      <div className={styles.legend}>
        <span><i className={styles.playerOne} />{snapshot.players[0]}</span>
        <span><i className={styles.playerTwo} />{snapshot.players[1]}</span>
        <span><i className={styles.ball} />Ball</span>
        <span className={styles.sceneNote}>Reconstructed from recent DMO frames</span>
      </div>
      {soundError && <p role="status">{soundError}</p>}
    </section>
  );
}

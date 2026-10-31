'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Minus, Pause, Play, Plus, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  TE4_DMO_FRAMES_PER_SECOND,
  type Te4DmoReplaySpeed,
  type Te4LiveSnapshot,
} from '@/lib/te4DmoLive';
import type { Te4CourtSurface } from '@/lib/te4DmoTypes';
import {
  advanceLiveCourtPlayhead,
  clampPlayerCameraLateralPan,
  deriveLiveCourtFootworkEvents,
  findLiveCourtShotInRange,
  findPlayerShotEvent,
  interpolateLiveCourtFrame,
  latestLiveCourtShotEvent,
  liveCourtEventsBetween,
  liveCourtTrajectoryCue,
  liveCourtFacingAngle,
  mergeLiveCourtEvents,
  mergeLiveCourtSamples,
  type LiveCourtCoordinates,
  type LiveCourtMotionEvent,
  type LiveCourtSample,
} from '@/lib/liveCourtMotion';
import { crossedFrame, dominantHandX, racketContact, serveLift, trailAllowed, type PlayerHandedness } from '@/lib/liveCourtPerformance';
import { liveGruntAudioUrl } from '@/lib/liveGruntAudio';
import DmoLiveCourt, { type GruntControlProps } from './DmoLiveCourt';
import DmoLiveBufferingOverlay from './DmoLiveBufferingOverlay';
import {
  BALL_RADIUS,
  PALETTE,
  SCALE,
  buildCourt,
  buildCourtFixtures,
  buildCrowd,
  makePlayer,
  poseLimb,
  type PlayerRig,
} from './DmoLiveCourt3DScene';
import styles from './DmoLiveCourt3D.module.css';

type Props = {
  snapshot: Te4LiveSnapshot;
  surface: Te4CourtSurface;
  playbackSpeed: Te4DmoReplaySpeed;
  stadiumAtmosphere?: boolean;
  isWta?: boolean;
  buffering?: boolean;
  fullReplay?: boolean;
};

type CameraView =
  | 'court'
  | 'aerial'
  | 'tv'
  | 'player-one-first'
  | 'player-one-third'
  | 'player-two-first'
  | 'player-two-third'
  | 'custom';

// Low diagonal courtside framing brings the rally closer while preserving
// player and court scale.
const DEFAULT_CAMERA = new THREE.Vector3(-18, 8, 19);

async function loadGruntSample(context: AudioContext, isWta: boolean) {
  const response = await fetch(liveGruntAudioUrl(isWta));
  if (!response.ok) throw new Error('Grunt sample unavailable');
  return context.decodeAudioData(await response.arrayBuffer());
}

function firstEventAfterFrame<T extends { frame: number }>(events: T[], frame: number) {
  let low = 0;
  let high = events.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (events[middle].frame <= frame) low = middle + 1;
    else high = middle;
  }
  return low;
}

const noiseBuffers = new WeakMap<AudioContext, AudioBuffer>();

function courtNoiseBuffer(context: AudioContext) {
  const existing = noiseBuffers.get(context);
  if (existing) return existing;
  const buffer = context.createBuffer(1, Math.floor(context.sampleRate * 0.18), context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let index = 0; index < samples.length; index += 1) {
    const fade = 1 - index / samples.length;
    samples[index] = (Math.random() * 2 - 1) * fade;
  }
  noiseBuffers.set(context, buffer);
  return buffer;
}

function playCue(
  context: AudioContext,
  kind: 'racket' | 'bounce' | 'footstep' | 'slide',
  surface: Te4CourtSurface,
) {
  const now = context.currentTime;
  if (kind === 'footstep' || kind === 'slide') {
    const duration = kind === 'footstep' ? 0.11 : 0.2;
    const noise = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    noise.buffer = courtNoiseBuffer(context);
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(kind === 'slide'
      ? surface === 'clay' ? 650 : surface === 'grass' ? 430 : 1_250
      : surface === 'clay' ? 420 : surface === 'grass' ? 320 : 850, now);
    filter.Q.value = kind === 'slide' ? 0.55 : 0.8;
    gain.gain.setValueAtTime(kind === 'footstep' ? 0.095 : 0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    noise.connect(filter).connect(gain).connect(context.destination);
    noise.start(now);
    noise.stop(now + duration);

    const tone = context.createOscillator();
    const toneGain = context.createGain();
    tone.type = 'sine';
    if (kind === 'footstep') {
      tone.frequency.setValueAtTime(105, now);
      tone.frequency.exponentialRampToValueAtTime(58, now + 0.09);
      toneGain.gain.setValueAtTime(0.035, now);
      toneGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
      tone.connect(toneGain).connect(context.destination);
      tone.start(now);
      tone.stop(now + 0.1);
    } else if (surface === 'hard') {
      tone.frequency.setValueAtTime(1_950, now);
      tone.frequency.exponentialRampToValueAtTime(1_250, now + 0.12);
      toneGain.gain.setValueAtTime(0.009, now);
      toneGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
      tone.connect(toneGain).connect(context.destination);
      tone.start(now);
      tone.stop(now + 0.13);
    }
    return;
  }

  const gain = context.createGain();
  const oscillator = context.createOscillator();
  const duration = kind === 'racket' ? 0.075 : 0.12;
  oscillator.type = kind === 'racket' ? 'triangle' : 'sine';
  oscillator.frequency.setValueAtTime(kind === 'racket' ? 720 : 390, now);
  oscillator.frequency.exponentialRampToValueAtTime(kind === 'racket' ? 260 : 150, now + duration);
  gain.gain.setValueAtTime(kind === 'racket' ? 0.085 : 0.072, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + duration);
}

function formatReplayClock(frame: number, frameRate: number) {
  const seconds = Math.max(0, Math.floor(frame / Math.max(1, frameRate)));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function playSample(
  context: AudioContext,
  buffer: AudioBuffer,
  volume: number,
  active?: Set<AudioBufferSourceNode>,
  playbackRate = 1,
) {
  const voice = context.createBufferSource();
  const gain = context.createGain();
  voice.buffer = buffer;
  voice.playbackRate.value = playbackRate;
  gain.gain.value = volume;
  voice.connect(gain).connect(context.destination);
  active?.add(voice);
  voice.onended = () => { active?.delete(voice); voice.disconnect(); gain.disconnect(); };
  voice.start();
}

function ThreeCourt({
  snapshot,
  surface,
  playbackSpeed,
  fullReplay = false,
  stadiumAtmosphere = true,
  isWta = false,
  buffering = false,
  gruntsEnabled,
  onGruntsEnabledChange,
  onUnsupported,
}: Props & GruntControlProps & { onUnsupported: () => void }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const crowdAudioRef = useRef<HTMLAudioElement | null>(null);
  const gruntAudioRef = useRef<{ isWta: boolean; buffer: AudioBuffer } | null>(null);
  const applauseAudioRef = useRef<AudioBuffer | null>(null);
  const activeGruntsRef = useRef(new Set<AudioBufferSourceNode>());
  const activeApplauseRef = useRef(new Set<AudioBufferSourceNode>());
  const gruntsEnabledRef = useRef(gruntsEnabled);
  gruntsEnabledRef.current = gruntsEnabled;
  const soundEventsRef = useRef<Array<{ frame: number; kind: 'racket' | 'bounce' | 'footstep' | 'slide' }>>([]);
  const transitionRef = useRef<HTMLDivElement>(null);
  const sampleBufferRef = useRef<LiveCourtSample[]>([]);
  const trajectoryEventsRef = useRef<LiveCourtMotionEvent[]>([]);
  const playheadRef = useRef<number | null>(null);
  const lastSoundFrameRef = useRef(Math.max(0, snapshot.frameCount - 3));
  const lastCalloutFrameRef = useRef<number | null>(null);
  const shotCalloutTimerRef = useRef<number | null>(null);
  const previousSnapshotRef = useRef({
    filename: snapshot.filename,
    players: snapshot.players,
    frameCount: snapshot.frameCount,
  });
  const [replayPlaying, setReplayPlaying] = useState(true);
  const [replayFrame, setReplayFrame] = useState(snapshot.courtFrameIndices?.[0] ?? 0);
  const [replaySpeed, setReplaySpeed] = useState(playbackSpeed);
  const replayPlayingRef = useRef(replayPlaying);
  const replayFrameRef = useRef<number | null>(null);
  const replaySpeedRef = useRef(replaySpeed);
  const replayUiUpdateAt = useRef(0);
  replayPlayingRef.current = replayPlaying;
  replaySpeedRef.current = replaySpeed;
  const sceneDataRef = useRef({ snapshot, surface, playbackSpeed, stadiumAtmosphere });
  sceneDataRef.current = {
    snapshot,
    surface,
    playbackSpeed: fullReplay ? replaySpeed : playbackSpeed,
    stadiumAtmosphere,
  };
  const soundOnRef = useRef(false);
  const cameraViewRef = useRef<CameraView>('court');
  const playerCameraPanRef = useRef(0);
  const [cameraView, setCameraView] = useState<CameraView>('court');
  const [playerCameraPan, setPlayerCameraPan] = useState(0);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [soundError, setSoundError] = useState('');
  const [crowdVolume, setCrowdVolume] = useState(0.38);
  const [hasCourtData, setHasCourtData] = useState(snapshot.court.length > 0);
  const [shotCallout, setShotCallout] = useState<{
    player: string;
    shotType: 'serve' | 'rally';
    speedKmh: number;
    frame: number;
  } | null>(null);

  useEffect(() => {
    const previous = previousSnapshotRef.current;
    const identityChanged = snapshot.filename !== previous.filename
      || snapshot.players[0] !== previous.players[0]
      || snapshot.players[1] !== previous.players[1]
      || snapshot.frameCount < previous.frameCount;
    if (identityChanged) {
      sampleBufferRef.current = [];
      trajectoryEventsRef.current = [];
      soundEventsRef.current = [];
      playheadRef.current = null;
      lastCalloutFrameRef.current = null;
      setShotCallout(null);
      if (shotCalloutTimerRef.current !== null) {
        window.clearTimeout(shotCalloutTimerRef.current);
        shotCalloutTimerRef.current = null;
      }
      lastSoundFrameRef.current = Math.max(0, snapshot.frameCount - 3);
      setHasCourtData(false);
    }
    previousSnapshotRef.current = {
      filename: snapshot.filename,
      players: snapshot.players,
      frameCount: snapshot.frameCount,
    };

    const courtFrameCount = Math.max(1, Math.floor(snapshot.courtFrameCount ?? snapshot.court.length));
    const firstFrame = Math.max(0, snapshot.frameCount - courtFrameCount);
    const incomingSamples: LiveCourtSample[] = snapshot.court.flatMap((frame, index) => {
      if (frame.length < 7 || !frame.slice(0, 7).every(Number.isFinite)) return [];
      const frameIndex = snapshot.courtFrameIndices?.[index]
        ?? firstFrame + Math.round(
          index * Math.max(0, courtFrameCount - 1) / Math.max(1, snapshot.court.length - 1),
        );
      return [{ frame: frameIndex, values: frame.slice(0, 7) as LiveCourtCoordinates }];
    });
    sampleBufferRef.current = mergeLiveCourtSamples(
      sampleBufferRef.current,
      incomingSamples,
      fullReplay
        ? Number.POSITIVE_INFINITY
        : (snapshot.frameRate ?? TE4_DMO_FRAMES_PER_SECOND) * 10 * playbackSpeed,
    );
    const earliestFrame = sampleBufferRef.current[0]?.frame ?? firstFrame;
    trajectoryEventsRef.current = mergeLiveCourtEvents(
      trajectoryEventsRef.current,
      snapshot.trajectoryEvents ?? [],
      earliestFrame,
    );
    const footworkEvents = deriveLiveCourtFootworkEvents(
      sampleBufferRef.current,
      snapshot.frameRate ?? TE4_DMO_FRAMES_PER_SECOND,
    );
    const soundMap = new Map(
      [...soundEventsRef.current, ...(snapshot.soundEvents ?? []), ...footworkEvents]
        .filter(e => e.frame >= earliestFrame)
        .map(e => [`${e.frame}:${e.kind}`, e]),
    );
    soundEventsRef.current = [...soundMap.values()].sort((first, second) =>
      first.frame - second.frame || first.kind.localeCompare(second.kind),
    );
    if (playheadRef.current === null && sampleBufferRef.current.length) {
      playheadRef.current = sampleBufferRef.current[0].frame;
      lastCalloutFrameRef.current = sampleBufferRef.current[0].frame;
      if (fullReplay) {
        replayFrameRef.current = sampleBufferRef.current[0].frame;
        setReplayFrame(sampleBufferRef.current[0].frame);
        setReplayPlaying(true);
        replayPlayingRef.current = true;
      }
    } else if (playheadRef.current !== null && playheadRef.current < earliestFrame) {
      playheadRef.current = earliestFrame;
      lastCalloutFrameRef.current = earliestFrame;
      if (fullReplay) {
        replayFrameRef.current = earliestFrame;
        setReplayFrame(earliestFrame);
      }
    }
    setHasCourtData(sampleBufferRef.current.length > 0);
  }, [snapshot, playbackSpeed, fullReplay, replaySpeed]);

  // Cues are consumed by the animation playhead, never snapshot arrival.

  useEffect(() => () => {
    const crowdAudio = crowdAudioRef.current;
    crowdAudio?.pause();
    crowdAudio?.removeAttribute('src');
    crowdAudio?.load();
    crowdAudioRef.current = null;
    gruntAudioRef.current = null;
    for (const voice of activeGruntsRef.current) voice.stop();
    activeGruntsRef.current.clear();
    for (const voice of activeApplauseRef.current) voice.stop();
    activeApplauseRef.current.clear();
    applauseAudioRef.current = null;
    soundOnRef.current = false;
    if (shotCalloutTimerRef.current !== null) {
      window.clearTimeout(shotCalloutTimerRef.current);
    }
    void audioContextRef.current?.close();
    audioContextRef.current = null;
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    const host = canvasHostRef.current;
    if (!viewport || !host) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    } catch {
      onUnsupported();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.className = styles.canvas;
    renderer.domElement.setAttribute('role', 'img');
    const initialPlayers = sceneDataRef.current.snapshot.players;
    renderer.domElement.setAttribute(
      'aria-label',
      `Three-dimensional tennis court for ${initialPlayers[0]} versus ${initialPlayers[1]}. Drag to orbit and scroll to zoom.`,
    );
    renderer.domElement.tabIndex = 0;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x4c5665);
    scene.fog = new THREE.Fog(0x4c5665, 42, 95);
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 260);
    camera.position.copy(DEFAULT_CAMERA);
    camera.lookAt(0, 0.3, 0);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.5, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.enablePan = true;
    controls.screenSpacePanning = true;
    controls.panSpeed = 0.9;
    controls.zoomSpeed = 0.9;
    controls.minDistance = 14;
    controls.maxDistance = 100;
    controls.minPolarAngle = 0.04;
    controls.maxPolarAngle = THREE.MathUtils.degToRad(84);
    controls.update();
    controls.addEventListener('start', () => {
      cameraViewRef.current = 'custom';
      setCameraView('custom');
    });

    scene.add(new THREE.HemisphereLight(0xe2e8f2, 0x303b4b, 1.9));
    const keyLight = new THREE.DirectionalLight(0xfff2d5, 3.2);
    keyLight.position.set(-8, 22, 9);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.left = -24;
    keyLight.shadow.camera.right = 24;
    keyLight.shadow.camera.top = 25;
    keyLight.shadow.camera.bottom = -25;
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xb3c4df, 1.2);
    fillLight.position.set(17, 9, -14);
    scene.add(fillLight);

    buildCourt(scene, sceneDataRef.current.surface);
    buildCourtFixtures(scene);
    buildCrowd(scene);
    const players = [
      makePlayer(PALETTE.shirtOne, 0x335d58, isWta),
      makePlayer(PALETTE.shirtTwo, 0x514b61, isWta),
    ];
    players.forEach(({ root }) => scene.add(root));
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_RADIUS, 18, 14),
      new THREE.MeshStandardMaterial({
        color: PALETTE.yellow,
        emissive: 0x887c32,
        emissiveIntensity: 0.32,
        roughness: 0.35,
      }),
    );
    ball.castShadow = true;
    scene.add(ball);
    const ballShadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.16, 20),
      new THREE.MeshBasicMaterial({ color: 0x061a18, transparent: true, opacity: 0.42 }),
    );
    ballShadow.rotation.x = -Math.PI / 2;
    ballShadow.position.y = 0.025;
    scene.add(ballShadow);

    const trailGeometry = new THREE.BufferGeometry();
    const trailPositions = new Float32Array(30);
    trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
    const trail = new THREE.Line(
      trailGeometry,
      new THREE.LineBasicMaterial({ color: PALETTE.yellow, transparent: true, opacity: 0.52 }),
    );
    trail.frustumCulled = false;
    scene.add(trail);

    const resize = () => {
      const bounds = viewport.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      renderer.setSize(bounds.width, bounds.height, false);
      camera.aspect = bounds.width / bounds.height;
      const compactFrame = bounds.width <= 720;
      camera.fov = compactFrame ? 38 : 34;
      camera.updateProjectionMatrix();
      const responsiveScale = compactFrame ? 0.82 : 1;
      const activeView = cameraViewRef.current;
      if (activeView === 'court') {
        camera.position.copy(DEFAULT_CAMERA).multiplyScalar(responsiveScale);
        controls.target.set(0, 0.5, 0);
        controls.update();
      } else if (activeView === 'tv') {
        camera.position.set(0, 24 * responsiveScale, 46 * responsiveScale);
        controls.target.set(0, 0.5, 0);
        controls.update();
      } else if (activeView === 'aerial') {
        camera.position.set(0, compactFrame ? 46 : 60, 0.1);
        controls.target.set(0, 0.5, 0);
        controls.update();
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(viewport);
    resize();

    let animation = 0;
    let lastTime = performance.now();
    let currentFrame = sampleBufferRef.current[0]?.frame ?? 0;
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let graphicsFailed = false;
    let changeoverUntil = 0;
    const updatePlayer = (
      rig: PlayerRig,
      x: number,
      z: number,
      index: number,
      values: LiveCourtCoordinates,
      frame: number,
      samples: LiveCourtSample[],
      lastFrame: number,
      firstFrame: number,
      events: LiveCourtMotionEvent[],
      striking: boolean,
      elapsedMs: number,
      handedness: PlayerHandedness,
    ) => {
      const position = new THREE.Vector3(x * SCALE, 0, z * SCALE);
      const oldSide = rig.root.userData.courtSide;
      const changedEnds = (oldSide === 1 || oldSide === -1)
        && Math.abs(position.x) > 1 && Math.sign(position.x) !== oldSide;
      if (changedEnds) {
        // A recorded changeover is a scene cut, not a straight walk through the net.
        changeoverUntil = performance.now() + 650;
        rig.root.position.copy(position);
        if (transitionRef.current) {
          transitionRef.current.style.transition = 'none';
          transitionRef.current.style.opacity = '1';
        }
      }
      if (!rig.root.userData.positionInitialized) {
        rig.root.position.copy(position);
        rig.root.userData.positionInitialized = true;
      } else {
        const movement = position.clone().sub(rig.root.position);
        const distance = movement.length();
        // Limit location changes to a plausible court movement speed to avoid
        // teleport flashes when the recording shifts between sampled positions.
        const maximumStep = Math.max(0.04, elapsedMs / 1000 * 7);
        if (distance <= maximumStep) rig.root.position.copy(position);
        else if (distance > 0) rig.root.position.addScaledVector(movement, maximumStep / distance);
      }
      const frameRate = sceneDataRef.current.snapshot.frameRate ?? TE4_DMO_FRAMES_PER_SECOND;
      const maxGapFrames = frameRate * sceneDataRef.current.playbackSpeed / 2;
      const prior = interpolateLiveCourtFrame(samples, Math.max(firstFrame, frame - 2), maxGapFrames) ?? values;
      const later = interpolateLiveCourtFrame(samples, Math.min(lastFrame, frame + 2), maxGapFrames) ?? values;
      const xIndex = index === 0 ? 3 : 5;
      const zIndex = index === 0 ? 4 : 6;
      const velocityX = (later[xIndex] - prior[xIndex]) * SCALE;
      const velocityZ = (later[zIndex] - prior[zIndex]) * SCALE;
      const speed = Math.min(1, Math.hypot(velocityX, velocityZ) / 0.35);
      const ballX = values[0] * SCALE;
      const ballZ = values[1] * SCALE;
      const ballY = Math.max(0, values[2] * SCALE) + BALL_RADIUS;
      const storedSide = rig.root.userData.courtSide;
      const courtSide = (storedSide === -1 || storedSide === 1) && Math.abs(position.x) <= 0.8
        ? storedSide
        : position.x < 0 ? -1 : 1;
      rig.root.userData.courtSide = courtSide;
      const targetFacing = liveCourtFacingAngle(courtSide);
      const facingDelta = Math.atan2(
        Math.sin(targetFacing - rig.root.rotation.y),
        Math.cos(targetFacing - rig.root.rotation.y),
      );
      const facing = rig.root.userData.facingInitialized
        ? rig.root.rotation.y + facingDelta * (1 - Math.exp(-12 * elapsedMs / 1000))
        : targetFacing;
      rig.root.userData.facingInitialized = true;
      const eventPlayer = index === 0 ? 1 : 2;
      const event = findPlayerShotEvent(events, eventPlayer, frame);
      const serving = event?.shotType === 'serve';
      const jump = serving ? serveLift(frame - event.frame) : 0;
      const strikeWeight = event
        ? THREE.MathUtils.clamp(1 - Math.abs(event.frame - frame) / 6, 0, 1)
        : 0;
      // Convert world X/Z into rig-local X/Z. With its face along +Z,
      // this local +X basis is anatomical LEFT, not the racket arm.
      const localXAxis = [Math.cos(facing), -Math.sin(facing)];
      const localX = (
        (ballX - rig.root.position.x) * localXAxis[0]
        + (ballZ - rig.root.position.z) * localXAxis[1]
      ) / rig.root.scale.x;
      const localZ = (
        (ballX - rig.root.position.x) * Math.sin(facing)
        + (ballZ - rig.root.position.z) * Math.cos(facing)
      ) / rig.root.scale.x;
      const phase = frame * 0.22 + index * Math.PI;
      const gaitSpeed = speed > 0.12 ? speed : 0;
      const leftCycle = Math.sin(phase);
      const rightCycle = Math.sin(phase + Math.PI);
      const stride = gaitSpeed * 0.19;
      const leftLift = Math.max(0, leftCycle) * gaitSpeed * 0.13 + jump;
      const rightLift = Math.max(0, rightCycle) * gaitSpeed * 0.13 + jump;
      const bodyBounce = gaitSpeed * Math.abs(Math.sin(phase * 2)) * 0.035 + jump;
      const crouch = strikeWeight * THREE.MathUtils.clamp((1.05 - ballY) / 0.95, 0, 1) * 0.18;
      rig.root.rotation.y = facing;
      rig.body.position.set(Math.sin(phase * 0.5) * gaitSpeed * 0.02, 1.22 + bodyBounce - crouch * 0.45, 0);
      rig.body.rotation.z = THREE.MathUtils.clamp(-velocityX * 0.18, -0.22, 0.22);
      rig.body.rotation.x = crouch * 0.5;
      rig.hip.position.y = 0.79 + bodyBounce - crouch * 0.75;
      rig.head.position.set(0, 1.78 + bodyBounce * 0.8 - crouch * 0.3, 0);
      const leftHip = new THREE.Vector3(-0.15, 0.79 + bodyBounce - crouch * 0.75, 0);
      const rightHip = new THREE.Vector3(0.15, 0.79 + bodyBounce - crouch * 0.75, 0);
      const leftFoot = new THREE.Vector3(
        -0.15 + leftCycle * stride,
        0.1 + leftLift,
        Math.max(0, leftCycle) * 0.05,
      );
      const rightFoot = new THREE.Vector3(
        0.15 + rightCycle * stride,
        0.1 + rightLift,
        Math.max(0, rightCycle) * 0.05,
      );
      poseLimb(rig.leftLeg, leftHip, leftFoot);
      poseLimb(rig.rightLeg, rightHip, rightFoot);
      rig.leftShoe.position.set(leftFoot.x, 0.032 + leftLift, leftFoot.z + 0.05);
      rig.rightShoe.position.set(rightFoot.x, 0.032 + rightLift, rightFoot.z + 0.05);
      rig.leftShoe.rotation.y = leftCycle * gaitSpeed * 0.12;
      rig.rightShoe.rotation.y = rightCycle * gaitSpeed * 0.12;
      const swing = strikeWeight > 0 ? 0.72 * strikeWeight : Math.sin(phase * 0.55) * gaitSpeed * 0.2;
      const dominantX = dominantHandX(handedness);
      const dominantHand = new THREE.Vector3(dominantX, 1.1 + bodyBounce + swing, 0.04);
      const nonDominantHand = new THREE.Vector3(-dominantX, 1.08 + bodyBounce + swing * 0.2, 0.05);
      if (serving) {
        const preparation = Math.max(0, 1 - Math.abs(frame - event.frame) / 24);
        // Toss arm lowers as the striking arm extends through contact.
        const toss = Math.max(0, Math.min(1, -(frame - event.frame) / 8));
        nonDominantHand.y += preparation * toss * 0.9;
        dominantHand.y += preparation * 0.65;
        dominantHand.z -= preparation * 0.2;
      }
      const contact = racketContact(
        [localX, ballY / rig.root.scale.y, localZ],
        [dominantHand.x, dominantHand.y, dominantHand.z],
      );
      const contactHand = new THREE.Vector3(...contact.grip);
      dominantHand.lerp(contactHand, strikeWeight);
      const dominantArm = handedness === 'right' ? rig.rightArm : rig.leftArm;
      const nonDominantArm = handedness === 'right' ? rig.leftArm : rig.rightArm;
      const dominantMesh = handedness === 'right' ? rig.rightHand : rig.leftHand;
      const nonDominantMesh = handedness === 'right' ? rig.leftHand : rig.rightHand;
      poseLimb(nonDominantArm, new THREE.Vector3(-dominantX * 0.59, 1.42 + bodyBounce, 0), nonDominantHand);
      poseLimb(dominantArm, new THREE.Vector3(dominantX * 0.59, 1.4 + bodyBounce, 0), dominantHand);
      dominantMesh.position.copy(dominantHand);
      nonDominantMesh.position.copy(nonDominantHand);
      rig.racket.position.copy(dominantHand);
      const restingRacketAngle = -0.12 + Math.sin(phase * 0.55) * speed * 0.14;
      const resting = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -restingRacketAngle));
      const contactRotation = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0), new THREE.Vector3(...contact.axis),
      );
      rig.racket.quaternion.slerpQuaternions(resting, contactRotation, strikeWeight);
    };

    const animate = (now: number) => {
      if (graphicsFailed) return;
      animation = window.requestAnimationFrame(animate);
      const elapsed = Math.min(80, Math.max(0, now - lastTime));
      lastTime = now;
      const samples = sampleBufferRef.current;
      if (samples.length) {
        const firstFrame = samples[0].frame;
        const lastFrame = samples[samples.length - 1].frame;
        const frameRate = sceneDataRef.current.snapshot.frameRate ?? TE4_DMO_FRAMES_PER_SECOND;
        if (fullReplay) {
          const replayStart = firstFrame;
          const replayEnd = lastFrame;
          if (replayPlayingRef.current) {
            currentFrame = advanceLiveCourtPlayhead(
              replayFrameRef.current,
              elapsed,
              replaySpeedRef.current,
              samples,
              frameRate,
            ) ?? replayStart;
            if (currentFrame >= replayEnd) {
              currentFrame = replayEnd;
              replayPlayingRef.current = false;
              setReplayPlaying(false);
            }
          } else {
            currentFrame = replayFrameRef.current ?? replayStart;
          }
          currentFrame = THREE.MathUtils.clamp(currentFrame, replayStart, replayEnd);
          replayFrameRef.current = currentFrame;
          if (now - replayUiUpdateAt.current >= 100 || currentFrame === replayEnd) {
            replayUiUpdateAt.current = now;
            setReplayFrame(currentFrame);
          }
        } else if (motionPreference.matches) {
          currentFrame = lastFrame;
        } else {
          currentFrame = advanceLiveCourtPlayhead(
            playheadRef.current,
            elapsed,
            sceneDataRef.current.playbackSpeed,
            samples,
            frameRate,
          ) ?? firstFrame;
        }
        playheadRef.current = currentFrame;
        const context = audioContextRef.current;
        if (soundOnRef.current && context?.state === 'running') {
          const previous = lastSoundFrameRef.current;
          if (currentFrame >= previous && currentFrame - previous < 120) {
            const soundCues = soundEventsRef.current;
            for (let index = firstEventAfterFrame(soundCues, previous);
              index < soundCues.length && soundCues[index].frame <= currentFrame;
              index += 1) {
              const cue = soundCues[index];
              if (crossedFrame(cue.frame, previous, currentFrame)) {
                playCue(context, cue.kind, sceneDataRef.current.surface);
              }
            }
            for (const cue of liveCourtEventsBetween(trajectoryEventsRef.current, previous, currentFrame)) {
              if (cue.kind === 'point-end' || cue.shotType === 'serve') {
                for (const voice of activeGruntsRef.current) voice.stop();
                activeGruntsRef.current.clear();
                for (const voice of activeApplauseRef.current) voice.stop();
                activeApplauseRef.current.clear();
              }
              const audioCue = liveCourtTrajectoryCue(cue, gruntsEnabledRef.current);
              if (audioCue === 'grunt' && gruntAudioRef.current?.isWta === isWta) {
                playSample(context, gruntAudioRef.current.buffer, 0.72, activeGruntsRef.current, 0.92 + Math.random() * 0.12);
              } else if (audioCue === 'cheer' && cue.frame % 3 === 0 && applauseAudioRef.current) {
                playSample(context, applauseAudioRef.current, crowdAudioRef.current?.volume ?? 0.38, activeApplauseRef.current);
              }
            }
          }
        }
        lastSoundFrameRef.current = currentFrame;
        const previousCalloutFrame = lastCalloutFrameRef.current;
        if (previousCalloutFrame === null || currentFrame < previousCalloutFrame) {
          lastCalloutFrameRef.current = currentFrame;
        } else {
          const eligibleCallouts = liveCourtEventsBetween(
            trajectoryEventsRef.current,
            previousCalloutFrame,
            currentFrame,
          )
            .filter((event) => (
              event.kind === 'shot'
              && event.player !== undefined
              && event.speedKmh !== undefined
              && event.speedKmh >= (event.shotType === 'serve' ? 160 : 135)
            ));
          const calloutEvent = eligibleCallouts[eligibleCallouts.length - 1];
          if (calloutEvent?.player && calloutEvent.shotType && calloutEvent.speedKmh) {
            if (shotCalloutTimerRef.current !== null) {
              window.clearTimeout(shotCalloutTimerRef.current);
            }
            setShotCallout({
              player: sceneDataRef.current.snapshot.players[calloutEvent.player - 1],
              shotType: calloutEvent.shotType,
              speedKmh: calloutEvent.speedKmh,
              frame: calloutEvent.frame,
            });
            shotCalloutTimerRef.current = window.setTimeout(() => setShotCallout(null), 2_200);
          }
          lastCalloutFrameRef.current = currentFrame;
        }
        const maxGapFrames = frameRate * sceneDataRef.current.playbackSpeed / 2;
        const values = interpolateLiveCourtFrame(samples, currentFrame, maxGapFrames) ?? samples[samples.length - 1].values;
        const ballPosition = new THREE.Vector3(values[0] * SCALE, Math.max(0, values[2]) * SCALE, values[1] * SCALE);
        ball.position.copy(ballPosition);
        ball.position.y += BALL_RADIUS;
        ballShadow.position.set(ballPosition.x, 0.025, ballPosition.z);
        const height = Math.max(0, values[2] * SCALE);
        (ballShadow.material as THREE.MeshBasicMaterial).opacity = THREE.MathUtils.clamp(0.43 - height * 0.08, 0.08, 0.43);
        const activeShot = findLiveCourtShotInRange(
          trajectoryEventsRef.current,
          currentFrame - 6,
          currentFrame + 6,
        );
        const firstPlayerDistance = Math.hypot((values[0] - values[3]) * SCALE, (values[1] - values[4]) * SCALE);
        const secondPlayerDistance = Math.hypot((values[0] - values[5]) * SCALE, (values[1] - values[6]) * SCALE);
        const strikingPlayer = activeShot?.player
          ? activeShot.player - 1
          : activeShot
            ? firstPlayerDistance <= secondPlayerDistance ? 0 : 1
            : -1;
        updatePlayer(players[0], values[3], values[4], 0, values, currentFrame, samples, lastFrame, firstFrame, trajectoryEventsRef.current, strikingPlayer === 0, elapsed, sceneDataRef.current.snapshot.handedness?.[0] ?? 'right');
        updatePlayer(players[1], values[5], values[6], 1, values, currentFrame, samples, lastFrame, firstFrame, trajectoryEventsRef.current, strikingPlayer === 1, elapsed, sceneDataRef.current.snapshot.handedness?.[1] ?? 'right');
        const activeView = cameraViewRef.current;
        if (activeView.startsWith('player-')) {
          const playerIndex = activeView.startsWith('player-two') ? 1 : 0;
          const player = players[playerIndex];
          const heading = player.root.rotation.y;
          const forward = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
          const side = new THREE.Vector3(forward.z, 0, -forward.x);
          const lateralPan = clampPlayerCameraLateralPan(playerCameraPanRef.current);
          const servingView = Boolean(findPlayerShotEvent(
            trajectoryEventsRef.current,
            (playerIndex + 1) as 1 | 2,
            currentFrame,
            24,
            'serve',
          ));
          const playerPosition = player.root.position;
          if (activeView.endsWith('-first')) {
            const eye = playerPosition.clone()
              .add(new THREE.Vector3(0, 1.55, 0))
              .addScaledVector(forward, 0.18);
            const aim = eye.clone()
              .addScaledVector(forward, 16)
              .addScaledVector(side, lateralPan)
              .add(new THREE.Vector3(0, 0.25, 0));
            camera.position.lerp(eye, 0.32);
            controls.target.lerp(aim, 0.32);
          } else {
            const follow = playerPosition.clone()
              .add(new THREE.Vector3(0, 3.0, 0))
              .addScaledVector(forward, -6.2)
              .addScaledVector(side, 1.25);
            const aim = playerPosition.clone()
              .add(new THREE.Vector3(0, servingView ? 1.8 : 1.0, 0))
              .addScaledVector(forward, 1.5)
              .addScaledVector(side, lateralPan);
            camera.position.lerp(follow, 0.22);
            controls.target.lerp(aim, 0.22);
          }
        }

        const latestHit = latestLiveCourtShotEvent(trajectoryEventsRef.current, currentFrame);
        const trailStartFrame = Math.max(firstFrame, latestHit?.frame ?? firstFrame, currentFrame - Math.min(10, (lastFrame - firstFrame) * 0.35));
        for (let index = 0; index < 10; index += 1) {
          const t = index / 9;
          const trailValues = interpolateLiveCourtFrame(
            samples,
            THREE.MathUtils.lerp(trailStartFrame, currentFrame, t),
            maxGapFrames,
          ) ?? values;
          trailPositions[index * 3] = trailValues[0] * SCALE;
          trailPositions[index * 3 + 1] = Math.max(0, trailValues[2]) * SCALE + BALL_RADIUS;
          trailPositions[index * 3 + 2] = trailValues[1] * SCALE;
        }
        const showTrail = trailAllowed(trajectoryEventsRef.current, currentFrame)
          && performance.now() >= changeoverUntil;
        trailGeometry.setDrawRange(0, showTrail ? 10 : 0);
        const tossing = Boolean(findLiveCourtShotInRange(
          trajectoryEventsRef.current,
          currentFrame + 1,
          currentFrame + 24,
          'serve',
        ));
        const knownPhase = Boolean(trajectoryEventsRef.current[0]
          && trajectoryEventsRef.current[0].frame <= currentFrame);
        ball.visible = (showTrail || tossing || !knownPhase) && performance.now() >= changeoverUntil;
        ballShadow.visible = ball.visible;
        (trailGeometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      }
      try {
        if (transitionRef.current && performance.now() >= changeoverUntil) {
          transitionRef.current.style.transition = 'opacity 250ms ease-out';
          transitionRef.current.style.opacity = '0';
        }
        controls.update();
        renderer.render(scene, camera);
      } catch {
        graphicsFailed = true;
        onUnsupported();
      }
    };
    animation = window.requestAnimationFrame(animate);

    const preset = (view: Exclude<CameraView, 'custom'>) => {
      cameraViewRef.current = view;
      if (view.startsWith('player-')) {
        playerCameraPanRef.current = 0;
        setPlayerCameraPan(0);
      }
      controls.target.set(0, 0.5, 0);
      const compactFrame = viewportRef.current?.getBoundingClientRect().width ?? window.innerWidth;
      const compactViewport = compactFrame <= 720;
      const narrowScale = compactViewport ? 0.82 : 1;
      if (view === 'aerial') camera.position.set(0, compactViewport ? 46 : 60, 0.1);
      else if (view === 'tv') camera.position.set(0, 24 * narrowScale, 46 * narrowScale);
      else if (view === 'court') camera.position.copy(DEFAULT_CAMERA).multiplyScalar(narrowScale);
      else {
        const playerIndex = view.startsWith('player-two') ? 1 : 0;
        const player = players[playerIndex];
        const forward = new THREE.Vector3(
          Math.sin(player.root.rotation.y),
          0,
          Math.cos(player.root.rotation.y),
        );
        if (view.endsWith('-first')) {
          camera.position.copy(player.root.position).add(new THREE.Vector3(0, 1.55, 0));
          controls.target.copy(camera.position).addScaledVector(forward, 16);
          controls.minDistance = 0.5;
        } else {
          camera.position.copy(player.root.position)
            .add(new THREE.Vector3(0, 2.4, 0))
            .addScaledVector(forward, -3.6);
          controls.target.copy(player.root.position).add(new THREE.Vector3(0, 1.0, 0));
          controls.minDistance = 2;
        }
      }
      if (view === 'court' || view === 'aerial' || view === 'tv') controls.minDistance = 14;
      controls.update();
      setCameraView(view);
    };
    const zoom = (factor: number) => {
      const direction = new THREE.Vector3().subVectors(camera.position, controls.target).multiplyScalar(factor);
      camera.position.copy(controls.target).add(direction);
      controls.update();
    };
    const reset = () => preset('court');
    const onZoom = (event: Event) => zoom((event as CustomEvent<number>).detail);
    const onPreset = (event: Event) =>
      preset((event as CustomEvent<Exclude<CameraView, 'custom'>>).detail);
    const onPlayerPan = (event: Event) => {
      const pan = clampPlayerCameraLateralPan((event as CustomEvent<number>).detail);
      playerCameraPanRef.current = pan;
      setPlayerCameraPan(pan);
    };
    viewport.addEventListener('courtzoom', onZoom);
    viewport.addEventListener('courtreset', reset);
    viewport.addEventListener('courtpreset', onPreset);
    viewport.addEventListener('courtplayerpan', onPlayerPan);

    return () => {
      window.cancelAnimationFrame(animation);
      observer.disconnect();
      controls.dispose();
      viewport.removeEventListener('courtzoom', onZoom);
      viewport.removeEventListener('courtreset', reset);
      viewport.removeEventListener('courtpreset', onPreset);
      viewport.removeEventListener('courtplayerpan', onPlayerPan);
      renderer.dispose();
      renderer.domElement.remove();
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      const textures = new Set<THREE.Texture>();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
          geometries.add(object.geometry);
          const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
          objectMaterials.forEach((item) => materials.add(item));
        }
        if (object instanceof THREE.Sprite) {
          materials.add(object.material);
          if (object.material.map) textures.add(object.material.map);
        }
      });
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((item) => item.dispose());
      textures.forEach((texture) => texture.dispose());
    };
  }, [fullReplay, isWta, onUnsupported, snapshot.filename]);

  const requestZoom = (factor: number) => {
    viewportRef.current?.dispatchEvent(new CustomEvent<number>('courtzoom', { detail: factor }));
  };
  const setPreset = (view: Exclude<CameraView, 'custom'>) => {
    viewportRef.current?.dispatchEvent(new CustomEvent('courtpreset', { detail: view }));
  };
  const resetCamera = () => viewportRef.current?.dispatchEvent(new Event('courtreset'));
  const changePlayerCameraPan = (pan: number) => {
    viewportRef.current?.dispatchEvent(new CustomEvent<number>('courtplayerpan', { detail: pan }));
  };

  const toggleSound = async () => {
    if (soundEnabled) {
      crowdAudioRef.current?.pause();
      for (const voice of activeGruntsRef.current) voice.stop();
      activeGruntsRef.current.clear();
      for (const voice of activeApplauseRef.current) voice.stop();
      activeApplauseRef.current.clear();
      soundOnRef.current = false;
      setSoundEnabled(false);
      return;
    }
    try {
      if (!audioContextRef.current) audioContextRef.current = new AudioContext();
      const context = audioContextRef.current;
      await context.resume();
      if (stadiumAtmosphere) {
        if (!crowdAudioRef.current) {
          const crowdAudio = new Audio('/audio/te4-crowd-ambience.mp3');
          crowdAudio.loop = true;
          crowdAudio.preload = 'auto';
          crowdAudioRef.current = crowdAudio;
        }
        crowdAudioRef.current.volume = crowdVolume;
        await crowdAudioRef.current.play();
      }
      if (gruntAudioRef.current?.isWta !== isWta) {
        gruntAudioRef.current = { isWta, buffer: await loadGruntSample(context, isWta) };
      }
      if (!applauseAudioRef.current) {
        const response = await fetch('/audio/te4-point-applause.mp3');
        if (!response.ok) throw new Error('Applause sample unavailable');
        applauseAudioRef.current = await context.decodeAudioData(await response.arrayBuffer());
      }
      lastSoundFrameRef.current = playheadRef.current ?? snapshot.frameCount;
      soundOnRef.current = true;
      setSoundError('');
      setSoundEnabled(true);
    } catch {
      crowdAudioRef.current?.pause();
      setSoundError('Sound could not be enabled in this browser.');
    }
  };

  useEffect(() => {
    const context = audioContextRef.current;
    if (!soundEnabled || !gruntsEnabled || !context || gruntAudioRef.current?.isWta === isWta) return;
    let cancelled = false;
    void loadGruntSample(context, isWta)
      .then((buffer) => {
        if (!cancelled) gruntAudioRef.current = { isWta, buffer };
      })
      .catch(() => {
        if (!cancelled) setSoundError('Player grunt audio could not be loaded.');
      });
    return () => { cancelled = true; };
  }, [isWta, soundEnabled, gruntsEnabled]);
  const changeCrowdVolume = (volume: number) => {
    setCrowdVolume(volume);
    if (soundOnRef.current && stadiumAtmosphere && crowdAudioRef.current) {
      crowdAudioRef.current.volume = volume;
    }
  };
  const changeGruntsEnabled = (enabled: boolean) => {
    onGruntsEnabledChange(enabled);
    if (!enabled) {
      for (const voice of activeGruntsRef.current) voice.stop();
      activeGruntsRef.current.clear();
    }
  };
  const replayFrameRate = snapshot.frameRate ?? TE4_DMO_FRAMES_PER_SECOND;
  const replayStartFrame = sampleBufferRef.current[0]?.frame ?? snapshot.courtFrameIndices?.[0] ?? 0;
  const replayEndFrame = sampleBufferRef.current.at(-1)?.frame
    ?? snapshot.courtFrameIndices?.at(-1)
    ?? Math.max(0, snapshot.frameCount - 1);
  const seekReplay = (requestedFrame: number) => {
    const frame = THREE.MathUtils.clamp(requestedFrame, replayStartFrame, replayEndFrame);
    replayFrameRef.current = frame;
    playheadRef.current = frame;
    lastSoundFrameRef.current = frame;
    lastCalloutFrameRef.current = frame;
    replayUiUpdateAt.current = 0;
    setReplayFrame(frame);
  };
  const toggleReplay = () => {
    if (replayPlayingRef.current) {
      replayPlayingRef.current = false;
      setReplayPlaying(false);
      return;
    }
    if (replayFrameRef.current === null || replayFrameRef.current >= replayEndFrame) {
      seekReplay(replayStartFrame);
    }
    replayPlayingRef.current = true;
    setReplayPlaying(true);
  };

  return (
    <section className={styles.scene} aria-label={fullReplay ? 'Three-dimensional full match replay' : 'Three-dimensional live court'}>
      <div className={styles.toolbar}>
        <div className={styles.title}>
          <span className={styles.liveDot} aria-hidden="true" />
          <strong>{fullReplay ? 'FULL MATCH REPLAY' : 'LIVE COURT'}</strong>
        </div>
        <div className={styles.controls} aria-label="Court view controls">
          <div className={styles.presets} role="group" aria-label="Camera angle">
            <button type="button" aria-pressed={cameraView === 'court'} onClick={() => setPreset('court')}>Court</button>
            <button type="button" aria-pressed={cameraView === 'aerial'} onClick={() => setPreset('aerial')}>Aerial</button>
            <button type="button" aria-pressed={cameraView === 'tv'} onClick={() => setPreset('tv')}>TV view</button>
          </div>
          <label className={styles.playerCameraControl}>
            <span>Player view</span>
            <select
              aria-label="Player perspective camera"
              value={cameraView.startsWith('player-') ? cameraView : ''}
              onChange={(event) => {
                if (event.currentTarget.value) {
                  setPreset(event.currentTarget.value as Exclude<CameraView, 'custom'>);
                }
              }}
            >
              <option value="">Choose player view</option>
              <option value="player-one-first">{snapshot.players[0]} · First person</option>
              <option value="player-one-third">{snapshot.players[0]} · Third person</option>
              <option value="player-two-first">{snapshot.players[1]} · First person</option>
              <option value="player-two-third">{snapshot.players[1]} · Third person</option>
            </select>
          </label>
          <div className={styles.iconControls} role="group" aria-label="Zoom and reset">
            <button type="button" aria-label="Zoom out" onClick={() => requestZoom(1.15)}><Minus size={15} /></button>
            <button type="button" aria-label="Zoom in" onClick={() => requestZoom(0.87)}><Plus size={15} /></button>
            <button type="button" aria-label="Reset court camera" onClick={resetCamera}><RotateCcw size={15} /></button>
          </div>
          {cameraView.startsWith('player-') && (
            <label className={styles.panControl}>
              <span>Look across court</span>
              <button
                type="button"
                aria-label="Pan player camera left"
                onClick={() => changePlayerCameraPan(playerCameraPan - 0.75)}
              >
                <ChevronLeft size={14} />
              </button>
              <input
                type="range"
                min="-5.485"
                max="5.485"
                step="0.1"
                value={playerCameraPan}
                aria-label="Player camera lateral pan"
                onChange={(event) => changePlayerCameraPan(Number(event.currentTarget.value))}
              />
              <button
                type="button"
                aria-label="Pan player camera right"
                onClick={() => changePlayerCameraPan(playerCameraPan + 0.75)}
              >
                <ChevronRight size={14} />
              </button>
            </label>
          )}
          <button
            className={styles.soundButton}
            type="button"
            aria-pressed={soundEnabled}
            onClick={() => void toggleSound()}
          >
            {soundEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
            <span>{soundEnabled ? 'Sound on' : 'Sound off'}</span>
          </button>
          <button
            className={styles.soundButton}
            type="button"
            aria-label={gruntsEnabled ? 'Turn player grunts off' : 'Turn player grunts on'}
            aria-pressed={gruntsEnabled}
            title={gruntsEnabled ? 'Turn player grunts off' : 'Turn player grunts on'}
            onClick={() => changeGruntsEnabled(!gruntsEnabled)}
          >
            <span>Grunts {gruntsEnabled ? 'on' : 'off'}</span>
          </button>
          {soundEnabled && stadiumAtmosphere && (
            <label className={styles.volumeControl}>
              <span>Crowd</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={crowdVolume}
                aria-label="Crowd volume"
                onChange={(event) => changeCrowdVolume(Number(event.currentTarget.value))}
              />
            </label>
          )}
        </div>
      </div>
      <div className={styles.viewport} ref={viewportRef}>
        <div className={styles.canvasHost} ref={canvasHostRef} />
        <div ref={transitionRef} className={styles.changeover} aria-hidden="true">Change of ends</div>
        {shotCallout && (
          <div className={styles.shotCallout} role="status" aria-live="polite" key={shotCallout.frame}>
            <span className={styles.shotCalloutLabel}>
              {shotCallout.shotType === 'serve' ? 'FAST SERVE' : 'POWER SHOT'}
            </span>
            <strong>{shotCallout.player}</strong>
            <b>{shotCallout.speedKmh}<small>km/h</small></b>
          </div>
        )}
        {!hasCourtData && (
          <p className={styles.waiting} role="status">Court positions will appear as the match feed updates.</p>
        )}
        <DmoLiveBufferingOverlay buffering={buffering} />
      </div>
      <div className={styles.legend}>
        <span><i className={styles.playerOne} />{snapshot.players[0]}</span>
        <span><i className={styles.playerTwo} />{snapshot.players[1]}</span>
        <span><i className={styles.ball} />Ball</span>
        <span className={styles.hint}>
          {cameraView.startsWith('player-') ? 'Use Look across court to pan laterally · scroll to zoom' : 'Drag to orbit · scroll to zoom'}
        </span>
      </div>
      {fullReplay && hasCourtData && (
        <div className={styles.replayControls} role="group" aria-label="Full match replay controls">
          <button
            type="button"
            className={styles.replayToggle}
            aria-label={replayPlaying ? 'Pause full match replay' : 'Play full match replay'}
            onClick={toggleReplay}
          >
            {replayPlaying ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
            <span>{replayPlaying ? 'Pause' : 'Play'}</span>
          </button>
          <label className={styles.replaySeek}>
            <span className={styles.visuallyHidden}>Replay position</span>
            <input
              type="range"
              min={replayStartFrame}
              max={replayEndFrame}
              step={1}
              value={Math.round(Math.min(replayEndFrame, Math.max(replayStartFrame, replayFrame)))}
              aria-label="Full match replay position"
              onChange={(event) => seekReplay(Number(event.currentTarget.value))}
            />
          </label>
          <output className={styles.replayClock} aria-live="off">
            {formatReplayClock(replayFrame - replayStartFrame, replayFrameRate)}
            {' / '}
            {formatReplayClock(replayEndFrame - replayStartFrame, replayFrameRate)}
          </output>
          <label className={styles.replaySpeedControl}>
            <span>Speed</span>
            <select
              aria-label="Full match replay speed"
              value={replaySpeed}
              onChange={(event) => setReplaySpeed(Number(event.currentTarget.value) as Te4DmoReplaySpeed)}
            >
              <option value={1}>1×</option>
              <option value={2}>2×</option>
              <option value={4}>4×</option>
            </select>
          </label>
        </div>
      )}
      {soundError && <p className={styles.soundError} role="status">{soundError}</p>}
    </section>
  );
}

export default function DmoLiveCourt3D(props: Props) {
  const [use2dFallback, setUse2dFallback] = useState(false);
  const [gruntsEnabled, setGruntsEnabled] = useState(true);
  const useFallback = useCallback(() => setUse2dFallback(true), []);
  const gruntControls = { gruntsEnabled, onGruntsEnabledChange: setGruntsEnabled };
  const { fullReplay: _fullReplay, ...courtProps } = props;
  if (use2dFallback) return <DmoLiveCourt {...courtProps} {...gruntControls} />;
  return <ThreeCourt {...props} {...gruntControls} onUnsupported={useFallback} />;
}

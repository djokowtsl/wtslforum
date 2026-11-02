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
import { courtSurfaceDisplayName, isIndoorDmoVenue } from '@/lib/te4DmoSurface';
import { deriveLiveCourtSoundEvents, playLiveCourtEffect as playCue } from '@/lib/liveCourtAudio';
import {
  advanceLiveCourtPlayhead,
  clampPlayerCameraLateralPan,
  deriveLiveCourtFootworkEvents,
  deriveLiveCourtSkidMarks,
  findLiveCourtShotInRange,
  findPlayerShotEvent,
  inferLiveCourtContactCue,
  interpolateLiveCourtFrame,
  latestLiveCourtShotEvent,
  liveCourtSlideWeight,
  liveCourtEventsBetween,
  liveCourtTrajectoryCue,
  liveCourtFacingAngle,
  mergeLiveCourtEvents,
  mergeLiveCourtSamples,
  type LiveCourtCoordinates,
  type LiveCourtFootworkEvent,
  type LiveCourtMotionEvent,
  type LiveCourtSample,
  type LiveCourtSkidMark,
} from '@/lib/liveCourtMotion';
import {
  clampPointToReach,
  crossedFrame,
  dominantHandX,
  groundstrokeForBallSide,
  racketContactWithinReach,
  secondHandGripPosition,
  serveLift,
  trailAllowed,
  type PlayerHandedness,
} from '@/lib/liveCourtPerformance';
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
  buildStadiumEnvironment,
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
  const skidMarksRef = useRef<LiveCourtSkidMark[]>([]);
  const effectsVolumeRef = useRef(0.9);
  const footworkEventsRef = useRef<LiveCourtFootworkEvent[]>([]);
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
  const [crowdVolume, setCrowdVolume] = useState(0.24);
  const [effectsVolume, setEffectsVolume] = useState(0.9);
  const [hasCourtData, setHasCourtData] = useState(snapshot.court.length > 0);
  const surfaceLabel = courtSurfaceDisplayName(surface);
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
      skidMarksRef.current = [];
      footworkEventsRef.current = [];
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
    footworkEventsRef.current = footworkEvents;
    soundEventsRef.current = deriveLiveCourtSoundEvents(
      [...soundEventsRef.current, ...(snapshot.soundEvents ?? [])].filter(e => e.frame >= earliestFrame),
      trajectoryEventsRef.current,
      footworkEvents,
      sampleBufferRef.current,
      snapshot.frameRate ?? TE4_DMO_FRAMES_PER_SECOND,
    );
    const skidHistory = new Map(skidMarksRef.current.map(mark => [`${mark.frame}:${mark.player}`, mark]));
    for (const mark of deriveLiveCourtSkidMarks(
      sampleBufferRef.current, footworkEvents, snapshot.frameRate ?? TE4_DMO_FRAMES_PER_SECOND,
    )) skidHistory.set(`${mark.frame}:${mark.player}`, mark);
    const nextSkids = [...skidHistory.values()].sort((a, b) => a.frame - b.frame || a.player - b.player).slice(-2048);
    if (nextSkids.length !== skidMarksRef.current.length
      || nextSkids.at(-1)?.frame !== skidMarksRef.current.at(-1)?.frame) {
      skidMarksRef.current = nextSkids;
    }
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
    renderer.shadowMap.type = THREE.PCFShadowMap;
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
    buildStadiumEnvironment(scene, isIndoorDmoVenue(sceneDataRef.current.snapshot.stadium));
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

    const courtEffects = buildCourt(scene, sceneDataRef.current.surface);
    const fixtureRig = buildCourtFixtures(scene);
    const crowdRig = buildCrowd(scene);
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
    let lastCrowdEventFrame: number | null = null;
    let crowdApplauseUntil = 0;
    let skidTimeline = skidMarksRef.current;
    let nextSkidMark = 0;
    let lastSkidFrame: number | null = null;
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
      const event = findPlayerShotEvent(events, eventPlayer, frame, 16);
      const serving = event?.shotType === 'serve';
      const contactCue = event
        ? inferLiveCourtContactCue(
          event,
          samples,
          sceneDataRef.current.snapshot.frameRate ?? TE4_DMO_FRAMES_PER_SECOND,
        )
        : 'standard';
      const jump = serving ? serveLift(frame - event.frame) : 0;
      const strokeDelta = event ? frame - event.frame : Number.POSITIVE_INFINITY;
      const strikeWeight = event
        ? THREE.MathUtils.smoothstep(strokeDelta, -5, 0)
          * (1 - THREE.MathUtils.smoothstep(strokeDelta, 0, 5))
        : 0;
      const backswing = event && !serving
        ? THREE.MathUtils.smoothstep(strokeDelta, -13, -5)
          * (1 - THREE.MathUtils.smoothstep(strokeDelta, -4, 0))
        : 0;
      const backswingShape = contactCue === 'close-net' ? 0.58
        : contactCue === 'low-contact' ? 0.82
          : contactCue === 'soft-touch' ? 0.5 : 1;
      const followThroughShape = contactCue === 'close-net' ? 0.72
        : contactCue === 'low-contact' ? 0.66
          : contactCue === 'soft-touch' ? 0.35 : 1;
      const shapedBackswing = backswing * backswingShape;
      const followThrough = event && !serving
        ? THREE.MathUtils.smoothstep(strokeDelta, 0, 4)
          * (1 - THREE.MathUtils.smoothstep(strokeDelta, 12, 21))
        : 0;
      const shapedFollowThrough = followThrough * followThroughShape;
      const serveFollowThrough = serving
        ? THREE.MathUtils.smoothstep(strokeDelta, 0, 4)
          * (1 - THREE.MathUtils.smoothstep(strokeDelta, 11, 19))
        : 0;
      const servePreparation = serving
        ? THREE.MathUtils.smoothstep(strokeDelta, -24, -12)
          * (1 - THREE.MathUtils.smoothstep(strokeDelta, -3, 0))
        : 0;
      const serveToss = serving
        ? THREE.MathUtils.smoothstep(strokeDelta, -18, -7)
          * (1 - THREE.MathUtils.smoothstep(strokeDelta, -3, 0))
        : 0;
      const impactWeight = Math.max(strikeWeight, striking ? 0.72 : 0);
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
      const slideWeight = liveCourtSlideWeight(footworkEventsRef.current, eventPlayer, frame, frameRate);
      const lateralVelocity = velocityX * localXAxis[0] + velocityZ * localXAxis[1];
      const slideDirection = Math.sign(lateralVelocity);
      const phase = frame * 0.22 + index * Math.PI;
      const gaitSpeed = speed > 0.12 ? speed : 0;
      const leftCycle = Math.sin(phase);
      const rightCycle = Math.sin(phase + Math.PI);
      const stride = gaitSpeed * 0.19 * (1 - slideWeight * 0.45);
      const slideSpread = slideDirection * slideWeight * 0.15;
      const leftLift = (Math.max(0, leftCycle) * gaitSpeed * 0.13 + jump) * (1 - slideWeight * 0.8);
      const rightLift = (Math.max(0, rightCycle) * gaitSpeed * 0.13 + jump) * (1 - slideWeight * 0.8);
      const bodyBounce = gaitSpeed * Math.abs(Math.sin(phase * 2)) * 0.035 + jump;
      const crouch = impactWeight * THREE.MathUtils.clamp((1.05 - ballY) / 0.95, 0, 1) * 0.18
        + slideWeight * 0.13;
      rig.root.rotation.y = facing;
      const bodyY = 1.22 + bodyBounce - crouch * 0.45;
      const strokeSide = Math.sign(localX || dominantHandX(handedness));
      const trunkTurn = (shapedBackswing * 0.36 - shapedFollowThrough * 0.28
        + servePreparation * 0.22 - serveFollowThrough * 0.16) * strokeSide;
      rig.body.position.set(Math.sin(phase * 0.5) * gaitSpeed * 0.02, bodyY, 0);
      rig.body.rotation.z = THREE.MathUtils.clamp(
        -lateralVelocity * 1.8 - slideDirection * slideWeight * 0.09,
        -0.3,
        0.3,
      );
      rig.body.rotation.x = crouch * 0.5 + shapedFollowThrough * 0.08 - serveFollowThrough * 0.05;
      rig.body.rotation.y = trunkTurn;
      rig.hip.position.y = 0.90 + bodyBounce - crouch * 0.75;
      rig.hip.rotation.y = trunkTurn * 0.42;
      rig.head.position.set(0, 1.73 + bodyBounce * 0.8 - crouch * 0.3, 0);
      rig.head.rotation.y = THREE.MathUtils.clamp(localX * 0.72, -0.28, 0.28);
      rig.head.rotation.x = THREE.MathUtils.clamp(-(ballY - 1.45) * 0.08, -0.18, 0.18);
      const effort = THREE.MathUtils.clamp(
        impactWeight * 0.35 + shapedBackswing * 0.18 + shapedFollowThrough * 0.48 + gaitSpeed * 0.16 + jump * 0.32,
        0,
        1,
      );
      rig.face.leftEye.scale.y = 0.82 - effort * 0.16;
      rig.face.rightEye.scale.y = 0.82 - effort * 0.16;
      rig.face.mouth.scale.y = 0.16 + effort * 0.84;
      rig.face.leftBrow.rotation.z = Math.PI / 2 + 0.12 + effort * 0.1;
      rig.face.rightBrow.rotation.z = Math.PI / 2 - 0.12 - effort * 0.1;
      const leftHip = new THREE.Vector3(-0.13, 0.90 + bodyBounce - crouch * 0.75, 0);
      const rightHip = new THREE.Vector3(0.13, 0.90 + bodyBounce - crouch * 0.75, 0);
      const leftFoot = new THREE.Vector3(
        -0.15 + leftCycle * stride - slideSpread * 0.35,
        0.1 + leftLift,
        Math.max(0, leftCycle) * 0.05,
      );
      const rightFoot = new THREE.Vector3(
        0.15 + rightCycle * stride + slideSpread * 0.35,
        0.1 + rightLift,
        Math.max(0, rightCycle) * 0.05,
      );
      const leftKnee = new THREE.Vector3(
        leftHip.x + (leftFoot.x - leftHip.x) * 0.38,
        0.46 + bodyBounce - crouch * 0.35 + leftLift * 0.28,
        leftFoot.z * 0.42 + 0.035,
      );
      const rightKnee = new THREE.Vector3(
        rightHip.x + (rightFoot.x - rightHip.x) * 0.38,
        0.46 + bodyBounce - crouch * 0.35 + rightLift * 0.28,
        rightFoot.z * 0.42 + 0.035,
      );
      poseLimb(rig.leftLeg, leftHip, leftKnee);
      poseLimb(rig.rightLeg, rightHip, rightKnee);
      poseLimb(rig.leftCalf, leftKnee, leftFoot);
      poseLimb(rig.rightCalf, rightKnee, rightFoot);
      rig.leftKnee.position.copy(leftKnee);
      rig.rightKnee.position.copy(rightKnee);
      rig.leftShoe.position.set(leftFoot.x, 0.052 + leftLift, leftFoot.z + 0.05);
      rig.rightShoe.position.set(rightFoot.x, 0.052 + rightLift, rightFoot.z + 0.05);
      rig.leftShoe.rotation.y = leftCycle * gaitSpeed * 0.12;
      rig.rightShoe.rotation.y = rightCycle * gaitSpeed * 0.12;
      rig.leftShoe.rotation.z = -slideDirection * slideWeight * 0.08;
      rig.rightShoe.rotation.z = slideDirection * slideWeight * 0.08;
      const dominantX = dominantHandX(handedness);
      const playerStrokeStyle = sceneDataRef.current.snapshot.strokeStyles?.[index];
      const stroke = groundstrokeForBallSide(localX, handedness);
      const twoHandedStroke = !serving
        && (playerStrokeStyle?.[stroke] ?? (stroke === 'backhand' ? 'two' : 'one')) === 'two';
      const armPump = Math.sin(phase * 0.55) * gaitSpeed * 0.12;
      const dominantHand = new THREE.Vector3(dominantX, 0.98 + bodyBounce + armPump, 0.06);
      const nonDominantHand = new THREE.Vector3(-dominantX * 0.72, 0.96 + bodyBounce - armPump, 0.1);
      dominantHand.x += dominantX * shapedBackswing * 0.48
        - strokeSide * shapedFollowThrough * 0.42
        - strokeSide * serveFollowThrough * 0.2;
      dominantHand.y += shapedBackswing * 0.12 + shapedFollowThrough * 0.24
        + serveFollowThrough * 0.2;
      dominantHand.z += -shapedBackswing * 0.22 + shapedFollowThrough * 0.12
        + serveFollowThrough * 0.17;
      if (contactCue === 'low-contact') {
        dominantHand.y -= (shapedBackswing + shapedFollowThrough) * 0.07 * (1 - impactWeight);
      }
      if (contactCue === 'close-net') {
        dominantHand.z += shapedBackswing * 0.16 + shapedFollowThrough * 0.08;
      }
      if (contactCue === 'soft-touch') {
        dominantHand.z += shapedBackswing * 0.08;
        dominantHand.y += shapedBackswing * 0.04;
      }
      if (serving) {
        // The toss hand reaches above the head while the racket arm loads behind
        // the shoulder; both return through contact and follow-through.
        nonDominantHand.y += serveToss * 0.82;
        nonDominantHand.z += serveToss * 0.08;
        dominantHand.y += servePreparation * 0.42;
        dominantHand.z -= servePreparation * 0.24;
      }
      const bodyPivot = new THREE.Vector3(0, bodyY, 0);
      const shoulderAxis = new THREE.Vector3(0, 1, 0);
      const rotateShoulder = (x: number) => new THREE.Vector3(x, bodyY + 0.22, 0)
        .sub(bodyPivot)
        .applyAxisAngle(shoulderAxis, trunkTurn)
        .add(bodyPivot);
      const dominantShoulder = rotateShoulder(dominantX * 0.59);
      const nonDominantShoulder = rotateShoulder(-dominantX * 0.59);
      const contact = racketContactWithinReach(
        [localX, ballY / rig.root.scale.y, localZ],
        [dominantHand.x, dominantHand.y, dominantHand.z],
        [dominantShoulder.x, dominantShoulder.y, dominantShoulder.z],
      );
      const contactHand = new THREE.Vector3(...contact.grip);
      dominantHand.lerp(contactHand, impactWeight);
      if (twoHandedStroke && (impactWeight > 0 || shapedBackswing > 0 || shapedFollowThrough > 0)) {
        const secondGrip = secondHandGripPosition(contact.grip, contact.axis);
        const reachableSecondGrip = clampPointToReach(
          secondGrip,
          [nonDominantShoulder.x, nonDominantShoulder.y, nonDominantShoulder.z],
        );
        nonDominantHand.lerp(
          new THREE.Vector3(...reachableSecondGrip),
          Math.max(impactWeight, shapedBackswing * 0.88, shapedFollowThrough * 0.8),
        );
      }
      const dominantUpperArm = handedness === 'right' ? rig.rightArm : rig.leftArm;
      const nonDominantUpperArm = handedness === 'right' ? rig.leftArm : rig.rightArm;
      const dominantForearm = handedness === 'right' ? rig.rightForearm : rig.leftForearm;
      const nonDominantForearm = handedness === 'right' ? rig.leftForearm : rig.rightForearm;
      const dominantElbowMesh = handedness === 'right' ? rig.rightElbow : rig.leftElbow;
      const nonDominantElbowMesh = handedness === 'right' ? rig.leftElbow : rig.rightElbow;
      const dominantMesh = handedness === 'right' ? rig.rightHand : rig.leftHand;
      const nonDominantMesh = handedness === 'right' ? rig.leftHand : rig.rightHand;
      const elbowPosition = (shoulder: THREE.Vector3, hand: THREE.Vector3) => {
        const elbow = shoulder.clone().lerp(hand, 0.48);
        elbow.x += Math.sign(shoulder.x) * (0.045 + shapedBackswing * 0.025);
        elbow.y += 0.015;
        elbow.z += 0.07 + impactWeight * 0.018;
        return elbow;
      };
      const dominantElbow = elbowPosition(dominantShoulder, dominantHand);
      const nonDominantElbow = elbowPosition(nonDominantShoulder, nonDominantHand);
      poseLimb(nonDominantUpperArm, nonDominantShoulder, nonDominantElbow);
      poseLimb(nonDominantForearm, nonDominantElbow, nonDominantHand);
      poseLimb(dominantUpperArm, dominantShoulder, dominantElbow);
      poseLimb(dominantForearm, dominantElbow, dominantHand);
      dominantElbowMesh.position.copy(dominantElbow);
      nonDominantElbowMesh.position.copy(nonDominantElbow);
      dominantMesh.position.copy(dominantHand);
      dominantMesh.quaternion.copy(dominantForearm.quaternion);
      nonDominantMesh.position.copy(nonDominantHand);
      nonDominantMesh.quaternion.copy(nonDominantForearm.quaternion);
      rig.racket.position.copy(dominantHand);
      const restingRacketAngle = -0.12 + Math.sin(phase * 0.55) * speed * 0.14;
      // Present the shaft forward of the forearm, not apparently through it.
      const resting = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.42, 0, -restingRacketAngle));
      const backswingRotation = resting.clone().multiply(
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -strokeSide * 0.9)),
      );
      const serveLoadRotation = resting.clone().multiply(
        new THREE.Quaternion().setFromEuler(new THREE.Euler(-strokeSide * 0.72, 0, -strokeSide * 0.78)),
      );
      const contactRotation = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0), new THREE.Vector3(...contact.axis),
      );
      const followRotation = contactRotation.clone().multiply(
        new THREE.Quaternion().setFromEuler(new THREE.Euler(
          0,
          0,
          -strokeSide * (contactCue === 'low-contact' ? 0.36 : contactCue === 'soft-touch' ? 0.08 : 0.16),
        )),
      );
      const serveFollowRotation = contactRotation.clone().multiply(
        new THREE.Quaternion().setFromEuler(new THREE.Euler(strokeSide * 0.28, 0, -strokeSide * 0.88)),
      );
      rig.racket.quaternion.copy(resting);
      if (serving && servePreparation > 0) rig.racket.quaternion.slerp(serveLoadRotation, servePreparation);
      if (shapedBackswing > 0) rig.racket.quaternion.slerp(backswingRotation, shapedBackswing);
      if (impactWeight > 0) rig.racket.quaternion.slerp(contactRotation, impactWeight);
      if (shapedFollowThrough > 0) rig.racket.quaternion.slerp(followRotation, shapedFollowThrough);
      if (serveFollowThrough > 0) rig.racket.quaternion.slerp(serveFollowRotation, serveFollowThrough);
      // Keep the dominant palm and curled fingers aligned with the grip as
      // the racket turns through serves and groundstrokes.
      dominantMesh.quaternion.copy(rig.racket.quaternion);
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
        // Court wear survives point/game breaks. Reconstruct it only on a
        // recording reset/seek or when newly received source marks arrive.
        if (skidTimeline !== skidMarksRef.current || (lastSkidFrame !== null && currentFrame < lastSkidFrame)) {
          courtEffects.clearSkidMarks();
          skidTimeline = skidMarksRef.current;
          nextSkidMark = 0;
        }
        while (nextSkidMark < skidTimeline.length && skidTimeline[nextSkidMark].frame <= currentFrame) {
          const mark = skidTimeline[nextSkidMark++];
          courtEffects.addSkidMark(mark.x, mark.z, mark.heading, mark.intensity);
        }
        lastSkidFrame = currentFrame;
        if (lastCrowdEventFrame === null) {
          lastCrowdEventFrame = currentFrame;
        } else if (currentFrame < lastCrowdEventFrame) {
          crowdApplauseUntil = 0;
          lastCrowdEventFrame = currentFrame;
        } else {
          const skippedFrames = currentFrame - lastCrowdEventFrame;
          if (skippedFrames <= frameRate * 3) {
            for (const cue of liveCourtEventsBetween(
              trajectoryEventsRef.current,
              lastCrowdEventFrame,
              currentFrame,
            )) {
              if (liveCourtTrajectoryCue(cue, false) === 'cheer') {
                crowdApplauseUntil = now + 1_800;
              }
            }
          }
          lastCrowdEventFrame = currentFrame;
        }
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
                playCue(context, cue.kind, sceneDataRef.current.surface, effectsVolumeRef.current);
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
        const gazeTarget = trailAllowed(trajectoryEventsRef.current, currentFrame) ? ball.position : undefined;
        crowdRig.update(now / 1000, now < crowdApplauseUntil, gazeTarget);
        fixtureRig.update(gazeTarget);
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
      if (context.state !== 'running') throw new Error('Audio context is not running');
      // Core court effects must not wait for, or fail with, optional MP3 layers.
      lastSoundFrameRef.current = playheadRef.current ?? snapshot.frameCount;
      soundOnRef.current = true;
      setSoundError('');
      setSoundEnabled(true);
      const layers: Array<Promise<unknown>> = [];
      if (stadiumAtmosphere) {
        if (!crowdAudioRef.current) {
          const crowdAudio = new Audio('/audio/te4-crowd-ambience.mp3');
          crowdAudio.loop = true;
          crowdAudio.preload = 'auto';
          crowdAudioRef.current = crowdAudio;
        }
        crowdAudioRef.current.volume = crowdVolume;
        layers.push(crowdAudioRef.current.play().catch(() => {
          if (soundOnRef.current) setSoundError('Court effects are on; crowd audio could not be loaded.');
        }));
      }
      if (gruntAudioRef.current?.isWta !== isWta) {
        layers.push(loadGruntSample(context, isWta).then(buffer => {
          gruntAudioRef.current = { isWta, buffer };
        }).catch(() => {
          if (soundOnRef.current) setSoundError('Court effects are on; player grunt audio could not be loaded.');
        }));
      }
      if (!applauseAudioRef.current) {
        layers.push((async () => {
          const response = await fetch('/audio/te4-point-applause.mp3');
          if (!response.ok) throw new Error('Applause sample unavailable');
          applauseAudioRef.current = await context.decodeAudioData(await response.arrayBuffer());
        })().catch(() => {
          if (soundOnRef.current) setSoundError('Court effects are on; applause audio could not be loaded.');
        }));
      }
      await Promise.all(layers);
    } catch {
      crowdAudioRef.current?.pause();
      soundOnRef.current = false;
      setSoundEnabled(false);
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
          <span className={styles.surfaceBadge} data-surface={surface} aria-label={`Court surface: ${surfaceLabel.toLowerCase()}`}>
            {surfaceLabel}
          </span>
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
          {soundEnabled && (
            <>
              <label className={styles.volumeControl}>
                <span>Court effects</span>
                <input type="range" min="0" max="1" step="0.01" value={effectsVolume}
                  aria-label="Court effects volume"
                  onChange={(event) => {
                    const volume = Number(event.currentTarget.value);
                    effectsVolumeRef.current = volume;
                    setEffectsVolume(volume);
                  }} />
              </label>
              <button type="button" className={styles.soundButton} onClick={() => {
                (['racket', 'bounce', 'footstep', 'slide'] as const).forEach((kind, index) => {
                  window.setTimeout(() => {
                    const context = audioContextRef.current;
                    if (soundOnRef.current && context?.state === 'running') {
                      playCue(context, kind, surface, effectsVolumeRef.current);
                    }
                  }, index * 400);
                });
              }}>Test court sounds</button>
            </>
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

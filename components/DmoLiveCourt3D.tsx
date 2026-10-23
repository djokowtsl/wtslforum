'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Minus, Plus, RotateCcw, Volume2, VolumeX } from 'lucide-react';
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
  interpolateLiveCourtFrame,
  mergeLiveCourtEvents,
  mergeLiveCourtSamples,
  type LiveCourtCoordinates,
  type LiveCourtMotionEvent,
  type LiveCourtSample,
} from '@/lib/liveCourtMotion';
import DmoLiveCourt from './DmoLiveCourt';
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

const DEFAULT_CAMERA = new THREE.Vector3(-25, 26, 30);

function playCue(context: AudioContext, kind: 'racket' | 'bounce' | 'grunt' | 'cheer') {
  const now = context.currentTime;
  const gain = context.createGain();
  if (kind === 'cheer') {
    const duration = 0.42;
    const buffer = context.createBuffer(1, Math.floor(context.sampleRate * duration), context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = (Math.random() * 2 - 1) * (1 - index / samples.length);
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 880;
    filter.Q.value = 0.8;
    gain.gain.setValueAtTime(0.028, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(context.destination);
    source.start(now);
    source.stop(now + duration);
    return;
  }

  const oscillator = context.createOscillator();
  const filter = kind === 'grunt' ? context.createBiquadFilter() : null;
  const duration = kind === 'racket' ? 0.075 : kind === 'grunt' ? 0.22 : 0.12;
  oscillator.type = kind === 'grunt' ? 'sawtooth' : kind === 'racket' ? 'triangle' : 'sine';
  oscillator.frequency.setValueAtTime(kind === 'grunt' ? 150 : kind === 'racket' ? 720 : 390, now);
  oscillator.frequency.exponentialRampToValueAtTime(kind === 'grunt' ? 82 : kind === 'racket' ? 260 : 150, now + duration);
  gain.gain.setValueAtTime(kind === 'grunt' ? 0.045 : kind === 'racket' ? 0.085 : 0.072, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  if (filter) {
    filter.type = 'bandpass';
    filter.frequency.value = 340;
    filter.Q.value = 0.85;
    oscillator.connect(filter);
    filter.connect(gain);
  } else {
    oscillator.connect(gain);
  }
  gain.connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + duration);
}

function createPlayerLabel(name: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = 'rgba(6, 13, 29, 0.86)';
    context.fillRect(6, 6, 500, 84);
    context.strokeStyle = 'rgba(203, 216, 237, 0.42)';
    context.lineWidth = 3;
    context.strokeRect(6, 6, 500, 84);
    context.fillStyle = '#f1f5fb';
    context.font = '600 34px system-ui, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(name, 256, 49, 470);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  }));
  sprite.scale.set(2.5, 0.47, 1);
  sprite.renderOrder = 1000;
  return sprite;
}

function ThreeCourt({
  snapshot,
  surface,
  playbackSpeed,
  stadiumAtmosphere = true,
  onUnsupported,
}: Props & { onUnsupported: () => void }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const crowdAudioRef = useRef<HTMLAudioElement | null>(null);
  const sampleBufferRef = useRef<LiveCourtSample[]>([]);
  const trajectoryEventsRef = useRef<LiveCourtMotionEvent[]>([]);
  const playheadRef = useRef<number | null>(null);
  const lastSoundFrameRef = useRef(Math.max(0, snapshot.frameCount - 3));
  const playedSoundEventsRef = useRef(new Set<string>());
  const previousSnapshotRef = useRef({
    filename: snapshot.filename,
    players: snapshot.players,
    frameCount: snapshot.frameCount,
  });
  const sceneDataRef = useRef({ snapshot, surface, playbackSpeed, stadiumAtmosphere });
  sceneDataRef.current = { snapshot, surface, playbackSpeed, stadiumAtmosphere };
  const soundOnRef = useRef(false);
  const cameraViewRef = useRef<CameraView>('court');
  const [cameraView, setCameraView] = useState<CameraView>('court');
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [soundError, setSoundError] = useState('');
  const [crowdVolume, setCrowdVolume] = useState(0.38);
  const [hasCourtData, setHasCourtData] = useState(snapshot.court.length > 0);

  useEffect(() => {
    const previous = previousSnapshotRef.current;
    const identityChanged = snapshot.filename !== previous.filename
      || snapshot.players[0] !== previous.players[0]
      || snapshot.players[1] !== previous.players[1]
      || snapshot.frameCount < previous.frameCount;
    if (identityChanged) {
      sampleBufferRef.current = [];
      trajectoryEventsRef.current = [];
      playheadRef.current = null;
      playedSoundEventsRef.current.clear();
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
      TE4_DMO_FRAMES_PER_SECOND * 10 * playbackSpeed,
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
    setHasCourtData(sampleBufferRef.current.length > 0);
  }, [snapshot, playbackSpeed]);

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
      playCue(context, event.kind);
      playedSoundEventsRef.current.add(key);
    }
    for (const event of snapshot.trajectoryEvents ?? []) {
      const cue = event.kind === 'point-end' ? 'cheer' : event.frame % 2 === 0 ? 'grunt' : null;
      const key = `${event.frame}:${event.kind}`;
      if (!cue || event.frame < lastSoundFrameRef.current || playedSoundEventsRef.current.has(key)) continue;
      playCue(context, cue);
      playedSoundEventsRef.current.add(key);
    }
    lastSoundFrameRef.current = Math.max(lastSoundFrameRef.current, snapshot.frameCount - 3);
    const oldestFrame = snapshot.frameCount - 600;
    for (const key of playedSoundEventsRef.current) {
      if (Number(key.slice(0, key.indexOf(':'))) < oldestFrame) playedSoundEventsRef.current.delete(key);
    }
  }, [snapshot.frameCount, snapshot.soundEvents, snapshot.trajectoryEvents, soundEnabled]);

  useEffect(() => () => {
    const crowdAudio = crowdAudioRef.current;
    crowdAudio?.pause();
    crowdAudio?.removeAttribute('src');
    crowdAudio?.load();
    crowdAudioRef.current = null;
    soundOnRef.current = false;
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
      makePlayer(PALETTE.shirtOne, 0x335d58),
      makePlayer(PALETTE.shirtTwo, 0x514b61),
    ];
    players.forEach(({ root }) => scene.add(root));
    const playerLabels = initialPlayers.map((name) => {
      const label = createPlayerLabel(name);
      scene.add(label);
      return label;
    });

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
      const compactFrame = bounds.width <= 600;
      camera.fov = compactFrame ? 42 : 34;
      camera.updateProjectionMatrix();
      const responsiveScale = compactFrame ? 1.2 : 1;
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
        camera.position.set(0, 60, 0.1);
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
    ) => {
      const position = new THREE.Vector3(x * SCALE, 0, z * SCALE);
      const maxGapFrames = TE4_DMO_FRAMES_PER_SECOND * sceneDataRef.current.playbackSpeed / 2;
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
      const facing = Math.atan2(ballX - position.x, ballZ - position.z);
      const event = striking
        ? events.find((item) => item.kind === 'shot' && Math.abs(item.frame - frame) <= 6)
        : undefined;
      const strikeWeight = event
        ? THREE.MathUtils.clamp(1 - Math.abs(event.frame - frame) / 6, 0, 1)
        : 0;
      const localX = ((ballX - position.x) * Math.cos(facing) - (ballZ - position.z) * Math.sin(facing)) / 0.92;
      const localZ = ((ballX - position.x) * Math.sin(facing) + (ballZ - position.z) * Math.cos(facing)) / 0.92;
      const phase = frame * 0.22 + index * Math.PI;
      const gaitSpeed = speed > 0.12 ? speed : 0;
      const leftCycle = Math.sin(phase);
      const rightCycle = Math.sin(phase + Math.PI);
      const stride = gaitSpeed * 0.19;
      const leftLift = Math.max(0, leftCycle) * gaitSpeed * 0.13;
      const rightLift = Math.max(0, rightCycle) * gaitSpeed * 0.13;
      const bodyBounce = gaitSpeed * Math.abs(Math.sin(phase * 2)) * 0.035;
      const crouch = strikeWeight * THREE.MathUtils.clamp((1.05 - ballY) / 0.95, 0, 1) * 0.18;
      rig.root.position.set(position.x, 0, position.z);
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
      const leftHand = new THREE.Vector3(-0.38, 1.08 + bodyBounce + swing * 0.2, 0.05);
      const rightHand = new THREE.Vector3(0.39, 1.1 + bodyBounce + swing, 0.04);
      const contactHand = new THREE.Vector3(
        THREE.MathUtils.clamp(localX, -1.05, 1.05),
        THREE.MathUtils.clamp(ballY / 0.86 - 0.42, 0.16, 1.62),
        THREE.MathUtils.clamp(localZ, -0.75, 1.15),
      );
      rightHand.lerp(contactHand, strikeWeight);
      poseLimb(rig.leftArm, new THREE.Vector3(-0.23, 1.42 + bodyBounce, 0), leftHand);
      poseLimb(rig.rightArm, new THREE.Vector3(0.23, 1.4 + bodyBounce, 0), rightHand);
      rig.leftHand.position.copy(leftHand);
      rig.rightHand.position.copy(rightHand);
      const restingRacket = new THREE.Vector3(rightHand.x, rightHand.y + 0.1, rightHand.z);
      const contactRacket = new THREE.Vector3(
        THREE.MathUtils.clamp(localX, -1.2, 1.2),
        THREE.MathUtils.clamp(ballY / 0.86, 0.22, 1.75),
        THREE.MathUtils.clamp(localZ, -0.85, 1.25),
      );
      rig.racket.position.copy(restingRacket.lerp(contactRacket, strikeWeight));
      rig.racket.rotation.z = strikeWeight > 0
        ? -0.8 + (1 - strikeWeight) * 0.5
        : -0.12 + Math.sin(phase * 0.55) * speed * 0.14;
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
        if (motionPreference.matches) {
          currentFrame = lastFrame;
        } else {
          currentFrame = advanceLiveCourtPlayhead(
            playheadRef.current,
            elapsed,
            sceneDataRef.current.playbackSpeed,
            samples,
            TE4_DMO_FRAMES_PER_SECOND,
          ) ?? firstFrame;
        }
        playheadRef.current = currentFrame;
        const maxGapFrames = TE4_DMO_FRAMES_PER_SECOND * sceneDataRef.current.playbackSpeed / 2;
        const values = interpolateLiveCourtFrame(samples, currentFrame, maxGapFrames) ?? samples[samples.length - 1].values;
        const ballPosition = new THREE.Vector3(values[0] * SCALE, Math.max(0, values[2]) * SCALE, values[1] * SCALE);
        ball.position.copy(ballPosition);
        ball.position.y += BALL_RADIUS;
        ballShadow.position.set(ballPosition.x, 0.025, ballPosition.z);
        const height = Math.max(0, values[2] * SCALE);
        (ballShadow.material as THREE.MeshBasicMaterial).opacity = THREE.MathUtils.clamp(0.43 - height * 0.08, 0.08, 0.43);
        const activeShot = trajectoryEventsRef.current.find(
          (event) => event.kind === 'shot' && Math.abs(event.frame - currentFrame) <= 6,
        );
        const firstPlayerDistance = Math.hypot((values[0] - values[3]) * SCALE, (values[1] - values[4]) * SCALE);
        const secondPlayerDistance = Math.hypot((values[0] - values[5]) * SCALE, (values[1] - values[6]) * SCALE);
        const strikingPlayer = activeShot
          ? firstPlayerDistance <= secondPlayerDistance ? 0 : 1
          : -1;
        updatePlayer(players[0], values[3], values[4], 0, values, currentFrame, samples, lastFrame, firstFrame, trajectoryEventsRef.current, strikingPlayer === 0);
        updatePlayer(players[1], values[5], values[6], 1, values, currentFrame, samples, lastFrame, firstFrame, trajectoryEventsRef.current, strikingPlayer === 1);
        playerLabels.forEach((label, index) => {
          label.position.set(players[index].root.position.x, 1.78, players[index].root.position.z);
        });

        const activeView = cameraViewRef.current;
        if (activeView.startsWith('player-')) {
          const playerIndex = activeView.startsWith('player-two') ? 1 : 0;
          const player = players[playerIndex];
          const heading = player.root.rotation.y;
          const forward = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
          const playerPosition = player.root.position;
          if (activeView.endsWith('-first')) {
            const eye = playerPosition.clone()
              .add(new THREE.Vector3(0, 1.55, 0))
              .addScaledVector(forward, 0.18);
            const aim = eye.clone().addScaledVector(forward, 16).add(new THREE.Vector3(0, 0.25, 0));
            camera.position.lerp(eye, 0.32);
            controls.target.lerp(aim, 0.32);
          } else {
            const side = new THREE.Vector3(forward.z, 0, -forward.x);
            const follow = playerPosition.clone()
              .add(new THREE.Vector3(0, 3.0, 0))
              .addScaledVector(forward, -6.2)
              .addScaledVector(side, 1.25);
            const aim = playerPosition.clone()
              .add(new THREE.Vector3(0, 1.0, 0))
              .addScaledVector(forward, 1.5);
            camera.position.lerp(follow, 0.22);
            controls.target.lerp(aim, 0.22);
          }
        }

        const trailStartFrame = Math.max(firstFrame, currentFrame - Math.min(10, (lastFrame - firstFrame) * 0.35));
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
        trailGeometry.setDrawRange(0, 10);
        (trailGeometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      }
      try {
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
      controls.target.set(0, 0.5, 0);
      const compactFrame = viewportRef.current?.getBoundingClientRect().width ?? window.innerWidth;
      const narrowScale = compactFrame <= 600 ? 1.2 : 1;
      if (view === 'aerial') camera.position.set(0, 60, 0.1);
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
            .add(new THREE.Vector3(0, 3.0, 0))
            .addScaledVector(forward, -6.2);
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
    viewport.addEventListener('courtzoom', onZoom);
    viewport.addEventListener('courtreset', reset);
    viewport.addEventListener('courtpreset', onPreset);

    return () => {
      window.cancelAnimationFrame(animation);
      observer.disconnect();
      controls.dispose();
      viewport.removeEventListener('courtzoom', onZoom);
      viewport.removeEventListener('courtreset', reset);
      viewport.removeEventListener('courtpreset', onPreset);
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
  }, [onUnsupported, snapshot.filename]);

  const requestZoom = (factor: number) => {
    viewportRef.current?.dispatchEvent(new CustomEvent<number>('courtzoom', { detail: factor }));
  };
  const setPreset = (view: Exclude<CameraView, 'custom'>) => {
    viewportRef.current?.dispatchEvent(new CustomEvent('courtpreset', { detail: view }));
  };
  const resetCamera = () => viewportRef.current?.dispatchEvent(new Event('courtreset'));

  const toggleSound = async () => {
    if (soundEnabled) {
      crowdAudioRef.current?.pause();
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
      lastSoundFrameRef.current = Math.max(0, snapshot.frameCount - 3);
      soundOnRef.current = true;
      setSoundError('');
      setSoundEnabled(true);
    } catch {
      crowdAudioRef.current?.pause();
      setSoundError('Sound could not be enabled in this browser.');
    }
  };
  const changeCrowdVolume = (volume: number) => {
    setCrowdVolume(volume);
    if (soundOnRef.current && stadiumAtmosphere && crowdAudioRef.current) {
      crowdAudioRef.current.volume = volume;
    }
  };

  return (
    <section className={styles.scene} aria-label="Three-dimensional live court">
      <div className={styles.toolbar}>
        <div className={styles.title}>
          <span className={styles.liveDot} aria-hidden="true" />
          <strong>LIVE COURT</strong>
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
              <option value="player-one-first">Player 1 · First person</option>
              <option value="player-one-third">Player 1 · Third person</option>
              <option value="player-two-first">Player 2 · First person</option>
              <option value="player-two-third">Player 2 · Third person</option>
            </select>
          </label>
          <div className={styles.iconControls} role="group" aria-label="Zoom and reset">
            <button type="button" aria-label="Zoom out" onClick={() => requestZoom(1.15)}><Minus size={15} /></button>
            <button type="button" aria-label="Zoom in" onClick={() => requestZoom(0.87)}><Plus size={15} /></button>
            <button type="button" aria-label="Reset court camera" onClick={resetCamera}><RotateCcw size={15} /></button>
          </div>
          <button
            className={styles.soundButton}
            type="button"
            aria-pressed={soundEnabled}
            onClick={() => void toggleSound()}
          >
            {soundEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
            <span>{soundEnabled ? 'Sound on' : 'Sound off'}</span>
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
        {!hasCourtData && (
          <p className={styles.waiting} role="status">Court positions will appear as the match feed updates.</p>
        )}
      </div>
      <div className={styles.legend}>
        <span><i className={styles.playerOne} />{snapshot.players[0]}</span>
        <span><i className={styles.playerTwo} />{snapshot.players[1]}</span>
        <span><i className={styles.ball} />Ball</span>
        <span className={styles.hint}>Drag to orbit · scroll to zoom</span>
      </div>
      {soundError && <p className={styles.soundError} role="status">{soundError}</p>}
    </section>
  );
}

export default function DmoLiveCourt3D(props: Props) {
  const [use2dFallback, setUse2dFallback] = useState(false);
  const useFallback = useCallback(() => setUse2dFallback(true), []);
  if (use2dFallback) return <DmoLiveCourt {...props} />;
  return <ThreeCourt {...props} onUnsupported={useFallback} />;
}

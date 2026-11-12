'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Minus, Pause, Play, Plus, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { fullscreenCameraView, observeDmoManualCamera } from '@/lib/dmoCameraInteraction';
import {
  LIVE_DMO_EVENT_SYNC_BUFFER_FRAMES,
  LIVE_DMO_UPDATE_INTERVAL_MS,
  TE4_DMO_FRAMES_PER_SECOND,
  type Te4DmoReplaySpeed,
  type Te4LiveSnapshot,
} from '@/lib/te4DmoLive';
import type { Te4CourtSurface } from '@/lib/te4DmoTypes';
import {
  constrainDmoOrbit,
  dmoOrbitSettings,
  dmoCameraMaxDistanceInsideBowl,
  dmoFullscreenCourtCamera,
  dmoTvBroadcastCamera,
  responsiveDmoCourtCameraScale,
} from '@/lib/dmoCameraConstraints';
import { isCapturedSmashShot } from '@/lib/dmoSmash';
import { isCapturedVolleyShot } from '@/lib/dmoVolley';
import {
  CAPTURE_RECOVERY_FRAMES,
  RECOVERY_FADE_START,
  GROUNDSTROKE_LEAD_FRAMES,
  SERVE_LEAD_FRAMES,
  VOLLEY_RECOVERY_FRAMES,
  groundstrokeCaptureWeight,
  groundstrokeLeadFrames,
  recordedStrokeForSide,
  isRecordedVolley,
  recordedStrokeUsesTwoHands,
  shouldCompressGroundstrokeTakeBack,
  volleyCaptureWeight,
  serveCaptureWeight,
  type GroundstrokeName,
} from './DmoCapturedGroundstroke';
import { isIndoorDmoVenue } from '@/lib/te4DmoSurface';
import {
  deriveLiveCourtSoundEvents,
  loadCourtEffectSamples,
  playLiveCourtEffect as playCue,
  updateLiveCourtFootstepContact,
  type CourtEffectSamples,
  type FootstepContactState,
} from '@/lib/liveCourtAudio';
import {
  advanceLiveCourtPlayhead,
  withReachAttempts,
  LIVE_CUSHION_SECONDS,
  clampLiveCourtPlayheadToTail,
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
  liveCourtShotSpin,
  liveCourtBallHeldSeconds,
  mergeLiveCourtEvents,
  mergeLiveCourtSamples,
  liveCourtReplayFrameScale,
  nextLiveCourtCarryMode,
  SERVE_BOUNCE_END_SECONDS,
  SERVE_BOUNCES,
  SERVE_BOUNCE_SECONDS,
  serveBounceHeight,
  lowReachDrop,
  ballPassedReceiverFrame,
  lungeWeight,
  LUNGE_FEET_APART,
  LUNGE_DROP,
  LOW_REACH_MAX_DROP,
  type LiveCourtCoordinates,
  type LiveCourtFootworkEvent,
  type LiveCourtMotionEvent,
  type LiveCourtSample,
  type LiveCourtSkidMark,
} from '@/lib/liveCourtMotion';
import {
  WALK_SPEED,
  advanceGait,
  gaitFeet,
  isBetweenPoints,
  isChangeoverCut,
  rallyOverWeight,
  lastShotFrame,
  newGaitState,
  nextShotEvent,
  planReposition,
  returnReadiness,
  splitStepLift,
  easeToward,
  filterCourtPosition,
  type GaitState,
  type PositionFilter,
} from '@/lib/liveCourtGait';
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
import { loadLiveCharacterGruntSamples } from '@/lib/liveGruntAudio';
import { getDmoCharacterAppearance } from '@/lib/dmoCharacterAppearance.mjs';
import { useDmoCommentary } from './useDmoCommentary';
import type { DmoCharacterGruntSetting } from '@/lib/dmoCharacterAppearance.mjs';
import DmoLiveCourt, { type GruntControlProps } from './DmoLiveCourt';
import {
  AUTO_RENDER_RESOLUTIONS,
  BROADCAST_RENDER_QUALITY_OPTIONS,
  createAdaptiveRenderState,
  getBroadcastRenderPixelRatio,
  getInitialBroadcastRenderSetting,
  observeAdaptiveRenderFrame,
  type AdaptiveRenderState,
  type BroadcastRenderResolution,
  type BroadcastRenderSetting,
} from './DmoRenderResolution';
import DmoLiveBufferingOverlay from './DmoLiveBufferingOverlay';
import {
  BALL_RADIUS,
  COURT_LENGTH,
  PALETTE,
  SCALE,
  buildCourt,
  buildCourtFixtures,
  buildCrowd,
  buildStadiumEnvironment,
  detectCourtNetImpact,
  makePlayer,
  poseLimb,
  type CrowdRig,
  type PlayerRig,
} from './DmoLiveCourt3DScene';
import {
  BROADCAST_TIME_OF_DAY_OPTIONS,
  createDmoBroadcastLighting,
  type BroadcastTimeOfDay,
} from './DmoBroadcastLighting';
import styles from './DmoLiveCourt3D.module.css';
import CourtFullscreenButton from './CourtFullscreenButton';
import CourtPictureInPictureButton from './CourtPictureInPictureButton';
import { attachHumanPlayer, disposeHumanModel, loadHumanModel } from './DmoHumanModels';
import { bundledCaptureTiming, type BundledMotionSource } from './DmoBundledGroundstroke';
import { attachHumanCourtStaff, addCrowdAccessories } from './DmoHumanCrowd';
import { attachSpectatorCrowd, loadSpectatorModel, loadDiverseSpectatorModel } from './DmoSpectatorCrowd';
import { DIVERSE_SPECTATORS } from '../lib/dmoSpectatorRoster';
import { ATP_PLAYER_KITS, WTA_PLAYER_KITS } from './DmoNativeKit';
import { selectDmoPlayerKitIndices } from '@/lib/dmoPlayerWardrobe.mjs';
import { racketCarryOrientation, racketContactOrientation, racketGripElbow, racketGripWrist } from './DmoRacketOrientation';
import type { StadiumScoreboardData } from './DmoStadiumArchitecture';
import densityStyles from './DmoCrowdDensityControl.module.css';
import {
  CROWD_DENSITY_CHOICES,
  resolveCrowdDensity,
  type CrowdDensityChoice,
} from '@/lib/dmoCrowdDensity';
import {
  cancelUmpireCall,
  createCourtAudioContext,
  createLiveUmpireScoreTether,
  deriveUmpireCallEvents,
  createLiveUmpireEventCursor,
  consumeLiveUmpireCallEvents,
  resetLiveUmpireEventCursor,
  liveUmpireMatchKey,
  matchLiveUmpireScoreToDmoPointEnd,
  observeLiveUmpireScore,
  preloadLineCallAudio,
  resetLiveUmpireScoreTether,
  resumeUmpireAudioContext,
  watchUmpireAudioContext,
  speakUmpireCall,
  umpireCallsBetween,
  type UmpireCallEvent,
} from '@/lib/liveCourtUmpire';

type Props = {
  modelAssetBase?: string;
  playerBundledMotions?: readonly [BundledMotionSource | null, BundledMotionSource | null];
  playerCharacters?: readonly [string | null, string | null];
  commentaryNames?: readonly [string, string] | null;
  playerGruntSettings?: readonly [DmoCharacterGruntSetting | null, DmoCharacterGruntSetting | null];
  playerOutfitSeed?: string;
  commentaryPoints?: readonly CommentaryReplayPoint[];
  snapshot: Te4LiveSnapshot;
  surface: Te4CourtSurface;
  playbackSpeed: Te4DmoReplaySpeed;
  stadiumAtmosphere?: boolean;
  isWta?: boolean;
  buffering?: boolean;
  fullReplay?: boolean;
  scoreboard?: StadiumScoreboardData;
  crowdDensity?: number;
  tournamentRound?: string | null;
  tournamentName?: string | null;
  onReplayFrameChange?: (frame: number) => void;
};

type CommentaryReplayPoint = {
  frame: number;
  number: number;
  server: 1 | 2;
  winner: 1 | 2;
  rallyHits: number;
  scoreBeforeLabel?: string;
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

/** Frames (at 60 per second) before his own shot when a running player brings
 * the racket back in front for the recorded take-back. */
const RALLY_RUN_CARRY_CUTOFF_FRAMES = 36;
/** Real walks face travel; short adjustments and imminent serves face the net. */
const SHORT_WALK_METRES = 2;
const SHORT_WALK_MAX_TURN = THREE.MathUtils.degToRad(60);
const SERVE_IMMINENT_SECONDS = 1.5;
const SERVE_IMMINENT_MAX_TURN = THREE.MathUtils.degToRad(30);
/** A stretch for a ball going past is mostly arm and upper body: this share
 *  of the lunge a groundstroke that wide would get. */
const ATTEMPT_LUNGE_SHARE = 0.6;
/** Beyond this reach (m from his centre) a two-handed player lets go with the
 *  free hand to stretch for a backhand. */
const ONE_HAND_STRETCH_METRES = 1.3;
/** A volley this far (m) from his centre: he reaches out for it as in a stretch. */
const WIDE_VOLLEY_METRES = 1;

function limitHeadingToNet(heading: number, netFacing: number, secondsToServe: number, metresToGo: number) {
  const limit = secondsToServe < SERVE_IMMINENT_SECONDS ? SERVE_IMMINENT_MAX_TURN
    : metresToGo < SHORT_WALK_METRES ? SHORT_WALK_MAX_TURN : Math.PI;
  const delta = Math.atan2(Math.sin(heading - netFacing), Math.cos(heading - netFacing));
  return netFacing + THREE.MathUtils.clamp(delta, -limit, limit);
}
/** Furthest the hips turn toward a fast run across the court (radians). */
const RUN_HIP_TURN = 1.05;

const colorToCss = (color: number) => `#${color.toString(16).padStart(6, '0')}`;

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
  destination?: AudioNode,
) {
  const voice = context.createBufferSource();
  const gain = context.createGain();
  voice.buffer = buffer;
  voice.playbackRate.value = playbackRate;
  gain.gain.value = volume;
  voice.connect(gain).connect(destination ?? context.destination);
  active?.add(voice);
  voice.onended = () => { active?.delete(voice); voice.disconnect(); gain.disconnect(); };
  voice.start();
}

function ThreeCourt({
  modelAssetBase,
  playerBundledMotions,
  playerCharacters = [null, null],
  commentaryNames = null,
  playerGruntSettings,
  playerOutfitSeed,
  commentaryPoints = [],
  snapshot,
  surface,
  playbackSpeed,
  crowdDensity = 0.98,
  fullReplay = false,
  stadiumAtmosphere = true,
  isWta = false,
  buffering = false,
  scoreboard,
  tournamentName,
  tournamentRound,
  onReplayFrameChange,
  gruntsEnabled,
  onGruntsEnabledChange,
  onUnsupported,
  renderQuality,
  renderSetting,
  onRenderSettingChange,
  onRenderFrame,
}: Props & GruntControlProps & {
  onUnsupported: () => void;
  renderQuality: BroadcastRenderResolution;
  renderSetting: BroadcastRenderSetting;
  onRenderSettingChange: (setting: BroadcastRenderSetting) => void;
  onRenderFrame: (elapsedMs: number) => void;
}) {
  const sceneElementRef = useRef<HTMLElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const canvasElementRef = useRef<HTMLCanvasElement>(null);
  const mediaVideoRef = useRef<HTMLVideoElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const crowdRigRef = useRef<CrowdRig | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const crowdAudioRef = useRef<HTMLAudioElement | null>(null);
  const crowdGainRef = useRef<GainNode | null>(null);
  const crowdVolumeRef = useRef(0.24);
  useEffect(() => {
    crowdRigRef.current?.setDensity(crowdDensity);
  }, [crowdDensity]);
  const playerCharacterKey = playerCharacters.map((name) => name?.trim() ?? '').join('\u0000');
  const playerGruntKey = `${playerCharacterKey}\u0001${playerGruntSettings
    ?.map((setting) => setting ? `${setting.groupId ?? ''}:${setting.useGenericFallback}` : '')
    .join('\u0000') ?? ''}`;
  const gruntAudioRef = useRef<{
    isWta: boolean;
    characterKey: string;
    samples: [AudioBuffer[], AudioBuffer[]];
  } | null>(null);
  const applauseAudioRef = useRef<AudioBuffer | null>(null);
  const courtEffectSamplesRef = useRef<CourtEffectSamples>({});
  const courtEffectSamplesLoadRef = useRef<Promise<void> | null>(null);
  const activeGruntsRef = useRef(new Set<AudioBufferSourceNode>());
  const activeApplauseRef = useRef(new Set<AudioBufferSourceNode>());
  const gruntsEnabledRef = useRef(gruntsEnabled);
  gruntsEnabledRef.current = gruntsEnabled;
  const soundEventsRef = useRef<Array<{ frame: number; kind: 'racket' | 'bounce' | 'footstep' }>>([]);
  const skidMarksRef = useRef<LiveCourtSkidMark[]>([]);
  const effectsVolumeRef = useRef(0.9);
  const footworkEventsRef = useRef<LiveCourtFootworkEvent[]>([]);
  const transitionRef = useRef<HTMLDivElement>(null);
  const sampleBufferRef = useRef<LiveCourtSample[]>([]);
  const trajectoryEventsRef = useRef<LiveCourtMotionEvent[]>([]);
  const umpireCallEventsRef = useRef<UmpireCallEvent[]>([]);
  // The events the players move to: TE4's, plus the beaten player's attempt at
  // a ball that goes past him (live: only when known in time). Sounds, umpire
  // calls, callouts and the ball use TE4's own events.
  const motionEventsRef = useRef<LiveCourtMotionEvent[]>([]);
  const attemptsSeenRef = useRef(new Map<string, boolean>());
  // Live: how far (whole seconds) the court plays behind live, for the label.
  const [courtDelay, setCourtDelay] = useState<number | null>(null);
  const courtDelayReportedAtRef = useRef(0);
  const playheadRef = useRef<number | null>(null);
  const lastSoundFrameRef = useRef(Math.max(0, snapshot.frameCount - 3));
  const lastUmpireCallFrameRef = useRef(snapshot.courtFrameIndices?.[0] ?? 0);
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

  useEffect(() => {
    if (fullReplay) onReplayFrameChange?.(replayFrame);
  }, [fullReplay, onReplayFrameChange, replayFrame]);

  const scoreboardData: StadiumScoreboardData = scoreboard ?? {
    players: snapshot.players,
    score: {
      sets: snapshot.score.sets,
      games: snapshot.score.games,
      pointText: snapshot.score.pointText,
      tiebreak: snapshot.score.tiebreak,
      server: snapshot.score.server === 1 ? 1 : snapshot.score.server === 2 ? 2 : null,
    },
    live: false,
  };
  const liveUmpireScoreTetherRef = useRef(createLiveUmpireScoreTether());
  const liveUmpireEventCursorRef = useRef(createLiveUmpireEventCursor());
  const liveScoreboardRef = useRef(scoreboardData.live);
  liveScoreboardRef.current = scoreboardData.live;
  const sceneDataRef = useRef({
    snapshot,
    surface,
    playbackSpeed,
    stadiumAtmosphere,
    isWta,
    scoreboard: scoreboardData,
  });
  sceneDataRef.current = {
    snapshot,
    surface,
    playbackSpeed: fullReplay ? replaySpeed : playbackSpeed,
    stadiumAtmosphere,
    isWta,
    scoreboard: scoreboardData,
  };
  const soundOnRef = useRef(false);
  const soundPreferenceRef = useRef(true);
  const soundActivationPendingRef = useRef(false);
  const umpireCallsEnabledRef = useRef(true);
  const initialCameraView: Exclude<CameraView, 'custom'> = fullReplay ? 'tv' : 'court';
  const cameraViewRef = useRef<CameraView>(initialCameraView);
  const selectedCameraViewRef = useRef<Exclude<CameraView, 'custom'>>(initialCameraView);
  const playerCameraPanRef = useRef(0);
  const [cameraView, setCameraView] = useState<CameraView>(initialCameraView);
  useEffect(() => {
    cameraViewRef.current = initialCameraView;
    selectedCameraViewRef.current = initialCameraView;
    setCameraView(initialCameraView);
  }, [initialCameraView]);
  const [timeOfDay, setTimeOfDay] = useState<BroadcastTimeOfDay>('day');
  const renderQualityRef = useRef(renderQuality);
  renderQualityRef.current = renderQuality;
  const renderFrameObserverRef = useRef(onRenderFrame);
  renderFrameObserverRef.current = onRenderFrame;
  const rendererResizeRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    rendererResizeRef.current?.();
  }, [renderQuality]);
  const timeOfDayRef = useRef(timeOfDay);
  timeOfDayRef.current = timeOfDay;
  const broadcastLightingRef = useRef<ReturnType<typeof createDmoBroadcastLighting> | null>(null);
  useEffect(() => {
    broadcastLightingRef.current?.apply(timeOfDay);
  }, [timeOfDay]);
  const [playerCameraPan, setPlayerCameraPan] = useState(0);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [soundReady, setSoundReady] = useState(false);
  const umpireCallsEnabled = soundEnabled;
  const [umpireSpeechReady, setUmpireSpeechReady] = useState(false);
  const [soundError, setSoundError] = useState('');
  const commentaryPlaybackState = useCallback(() => {
    const frame = playheadRef.current ?? -1;
    const events = trajectoryEventsRef.current;
    let rallyActive = true;
    let rallyShotCount = 0;
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event.frame > frame) continue;
      if (event.kind === 'point-end') {
        rallyActive = false;
        break;
      }
      rallyActive = true;
      if (event.shotType === 'rally') rallyShotCount = Math.min(20, rallyShotCount + 1);
    }
    return {
      frame,
      playing: !fullReplay || replayPlayingRef.current,
      rallyActive,
      rallyShotCount,
    };
  }, [fullReplay]);
  const commentary = useDmoCommentary({
    snapshot,
    commentaryNames,
    fullReplay,
    commentaryPoints,
    replayFrame,
    tournamentName,
    surface,
    tournamentRound,
    isWta,
    soundEnabled,
    soundReady: soundEnabled && soundReady,
    playbackState: commentaryPlaybackState,
  });
  const [crowdVolume, setCrowdVolume] = useState(0.24);
  const [effectsVolume, setEffectsVolume] = useState(0.9);
  const [hasCourtData, setHasCourtData] = useState(snapshot.court.length > 0);
  const [modelStatus, setModelStatus] = useState<'loading' | 'ready' | 'partial' | 'failed'>('loading');
  const [shotCallout, setShotCallout] = useState<{
    player: string;
    shotType: 'serve' | 'rally';
    speedKmh: number;
    frame: number;
  } | null>(null);
  soundPreferenceRef.current = soundEnabled;
  umpireCallsEnabledRef.current = umpireCallsEnabled;
  const umpireSpeechReadyRef = useRef(umpireSpeechReady);
  umpireSpeechReadyRef.current = umpireSpeechReady;
  const soundPointerActivationRef = useRef(false);

  useEffect(() => {
    const previous = previousSnapshotRef.current;
    const identityChanged = snapshot.filename !== previous.filename
      || snapshot.players[0] !== previous.players[0]
      || snapshot.players[1] !== previous.players[1]
      || snapshot.frameCount < previous.frameCount;
    if (identityChanged) {
      sampleBufferRef.current = [];
      trajectoryEventsRef.current = [];
      umpireCallEventsRef.current = [];
      motionEventsRef.current = [];
      attemptsSeenRef.current.clear();
      soundEventsRef.current = [];
      skidMarksRef.current = [];
      footworkEventsRef.current = [];
      playheadRef.current = null;
      lastCalloutFrameRef.current = null;
      lastUmpireCallFrameRef.current = snapshot.courtFrameIndices?.[0] ?? 0;
      setShotCallout(null);
      if (shotCalloutTimerRef.current !== null) {
        window.clearTimeout(shotCalloutTimerRef.current);
        shotCalloutTimerRef.current = null;
      }
      lastSoundFrameRef.current = Math.max(0, snapshot.frameCount - 3);
      resetLiveUmpireScoreTether(liveUmpireScoreTetherRef.current);
      resetLiveUmpireEventCursor(liveUmpireEventCursorRef.current);
      cancelUmpireCall(audioContextRef.current, liveUmpireMatchKey(snapshot.players, isWta));
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
    {
      // Live: only an attempt seen in time to swing (its moment at least 0.5 s
      // ahead of the playhead when it first shows up) is played; otherwise he'd
      // snap into a late swing. Decided once per attempt.
      const fps = snapshot.frameRate ?? TE4_DMO_FRAMES_PER_SECOND;
      const withAttempts = withReachAttempts(
        trajectoryEventsRef.current, sampleBufferRef.current, fps,
        fullReplay ? undefined : sampleBufferRef.current.at(-1)?.frame,
      );
      const seen = attemptsSeenRef.current;
      motionEventsRef.current = fullReplay ? withAttempts : withAttempts.filter((event) => {
        if (!(event as { attempt?: boolean }).attempt) return true;
        const key = `${event.frame}:${event.player}`;
        if (!seen.has(key)) seen.set(key, event.frame - (playheadRef.current ?? event.frame) >= fps * 0.5);
        return seen.get(key);
      });
      if (seen.size > 512) for (const key of [...seen.keys()].slice(0, seen.size - 512)) seen.delete(key);
    }
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
    umpireCallEventsRef.current = deriveUmpireCallEvents(
      [
        ...trajectoryEventsRef.current,
        ...(snapshot.trajectoryEvents ?? []).filter(event =>
          event.kind === 'point-end' && event.frame < earliestFrame),
      ].sort((a, b) => a.frame - b.frame),
      soundEventsRef.current,
      sampleBufferRef.current,
      { allowPendingPointEnd: !fullReplay },
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
      lastUmpireCallFrameRef.current = sampleBufferRef.current[0].frame;
      if (fullReplay) {
        replayFrameRef.current = sampleBufferRef.current[0].frame;
        setReplayFrame(sampleBufferRef.current[0].frame);
        setReplayPlaying(true);
        replayPlayingRef.current = true;
      }
    } else if (playheadRef.current !== null && playheadRef.current < earliestFrame) {
      playheadRef.current = earliestFrame;
      lastCalloutFrameRef.current = earliestFrame;
      lastUmpireCallFrameRef.current = earliestFrame;
      if (fullReplay) {
        replayFrameRef.current = earliestFrame;
        setReplayFrame(earliestFrame);
      }
    }
    setHasCourtData(sampleBufferRef.current.length > 0);
  }, [snapshot, playbackSpeed, fullReplay, replaySpeed]);

  useEffect(() => {
    const call = observeLiveUmpireScore(
      liveUmpireScoreTetherRef.current,
      scoreboardData.live ? scoreboardData.score : null,
      scoreboardData.players,
      scoreboardData.live
        && umpireCallsEnabledRef.current
        && umpireSpeechReadyRef.current,
    );
    if (call) {
      void speakUmpireCall(
        call,
        audioContextRef.current,
        isWta,
        () => umpireCallsEnabledRef.current && umpireSpeechReadyRef.current,
        liveUmpireMatchKey(snapshot.players, isWta),
      );
    }
  }, [scoreboardData, umpireCallsEnabled, umpireSpeechReady]);

  useEffect(() => {
    const context = audioContextRef.current;
    if ((!umpireSpeechReady && !soundReady) || !context) return;
    return watchUmpireAudioContext(context, () => {
      soundOnRef.current = false;
      setSoundReady(false);
      crowdAudioRef.current?.pause();
      umpireSpeechReadyRef.current = false;
      setUmpireSpeechReady(false);
      cancelUmpireCall(context, liveUmpireMatchKey(snapshot.players, isWta));
      resetLiveUmpireEventCursor(liveUmpireEventCursorRef.current);
      if (soundPreferenceRef.current) setSoundError('The browser paused audio. Tap Enable sound to resume.');
    });
  }, [umpireSpeechReady, soundReady, isWta, snapshot.players]);

  // Cues are consumed by the animation playhead, never snapshot arrival.

  useEffect(() => () => {
    cancelUmpireCall(audioContextRef.current, liveUmpireMatchKey(snapshot.players, isWta));
    const crowdAudio = crowdAudioRef.current;
    crowdAudio?.pause();
    crowdAudio?.removeAttribute('src');
    crowdAudio?.load();
    crowdAudioRef.current = null;
    crowdGainRef.current?.disconnect();
    crowdGainRef.current = null;
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
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
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
    canvasElementRef.current = renderer.domElement;

    const scene = new THREE.Scene();
    sceneRef.current = scene;
    const isIndoor = isIndoorDmoVenue(sceneDataRef.current.snapshot.stadium);
    buildStadiumEnvironment(
      scene,
      isIndoor,
      sceneDataRef.current.scoreboard,
      sceneDataRef.current.snapshot.stadium,
    );
    const broadcastLighting = createDmoBroadcastLighting(scene, renderer, isIndoor);
    broadcastLightingRef.current = broadcastLighting;
    broadcastLighting.apply(timeOfDayRef.current);
    const stadiumCameraData = scene.getObjectByName('wtsl-stadium-superstructure')?.userData;
    const stadiumCameraLimit = stadiumCameraData?.maxInteriorCameraDistance;
    const cameraMaxDistance = typeof stadiumCameraLimit === 'number' && Number.isFinite(stadiumCameraLimit)
      ? stadiumCameraLimit
      : 40;
    const cameraInteriorRadius = typeof stadiumCameraData?.interiorSeatEdgeRadius === 'number'
      && Number.isFinite(stadiumCameraData.interiorSeatEdgeRadius)
      ? stadiumCameraData.interiorSeatEdgeRadius
      : cameraMaxDistance + 7 * Math.SQRT2;
    const cameraPanLimit = typeof stadiumCameraData?.maxInteriorCameraPan === 'number'
      && Number.isFinite(stadiumCameraData.maxInteriorCameraPan)
      ? stadiumCameraData.maxInteriorCameraPan
      : 7;
    const maxDistanceForTarget = (target: THREE.Vector3) => dmoCameraMaxDistanceInsideBowl(
      target,
      cameraInteriorRadius,
      cameraPanLimit,
      cameraMaxDistance,
    );
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 500);
    camera.position.copy(DEFAULT_CAMERA);
    camera.lookAt(0, 0.3, 0);
    const controls = new OrbitControls(camera, renderer.domElement);
    const cameraTargetAnchor = new THREE.Vector3(0, 0.5, 0);
    let preferredCameraMinDistance = 14;
    controls.target.copy(cameraTargetAnchor);
    Object.assign(controls, dmoOrbitSettings(window.matchMedia('(pointer: coarse)').matches));
    controls.touches.ONE = THREE.TOUCH.ROTATE;
    controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
    renderer.domElement.style.touchAction = 'none';
    controls.maxDistance = maxDistanceForTarget(cameraTargetAnchor);
    controls.minDistance = Math.min(preferredCameraMinDistance, controls.maxDistance);
    controls.update();
    // Preserve the bounded bowl while allowing full vertical look-around.
    controls.addEventListener('change', () => {
      const bounded = constrainDmoOrbit(
        camera.position, controls.target, cameraTargetAnchor, cameraPanLimit, cameraMaxDistance,
      );
      camera.position.set(bounded.camera.x, bounded.camera.y, bounded.camera.z);
      controls.target.set(bounded.target.x, bounded.target.y, bounded.target.z);
    });
    const stopObservingManualCamera = observeDmoManualCamera(controls, () => {
      cameraViewRef.current = 'custom';
      setCameraView('custom');
    });

    const courtEffects = buildCourt(
      scene,
      sceneDataRef.current.surface,
      sceneDataRef.current.isWta,
      sceneDataRef.current.snapshot.stadium,
    );
    const fixtureRig = buildCourtFixtures(scene);
    const crowdRig = buildCrowd(scene, sceneDataRef.current.snapshot.stadium, crowdDensity);
    crowdRigRef.current = crowdRig;
    const playerAppearanceNames = [
      playerCharacters[0] ?? snapshot.players[0],
      playerCharacters[1] ?? snapshot.players[1],
    ] as const;
    const playerAppearances = [
      getDmoCharacterAppearance(playerAppearanceNames[0]),
      getDmoCharacterAppearance(playerAppearanceNames[1]),
    ] as const;
    const players = [
      makePlayer(
        PALETTE.shirtOne,
        0x335d58,
        isWta,
        playerAppearances[0],
      ),
      makePlayer(
        PALETTE.shirtTwo,
        0x514b61,
        isWta,
        playerAppearances[1],
      ),
    ];
    const playerKits = isWta ? WTA_PLAYER_KITS : ATP_PLAYER_KITS;
    const playerKitIndices = selectDmoPlayerKitIndices(
      playerOutfitSeed || snapshot.filename,
      [
        playerCharacters[0] ?? snapshot.players[0],
        playerCharacters[1] ?? snapshot.players[1],
      ],
      playerKits.length,
    );
    const selectedPlayerKits = playerKitIndices.map((kitIndex, index) => ({
      ...playerKits[kitIndex],
      skinColor: playerAppearances[index]?.complexionColor ?? null,
    })) as [typeof playerKits[number], typeof playerKits[number]];
    players.forEach(({ root }, index) => {
      root.userData.dominantHandedness = sceneDataRef.current.snapshot.handedness?.[index] ?? 'right';
      root.userData.outfitKitId = selectedPlayerKits[index].id;
    });
    players.forEach(({ root }) => scene.add(root));
    const modelLoad = new AbortController();
    let detailedPlayersReady = false;
    setModelStatus('loading');
    Promise.allSettled([
      loadHumanModel(isWta ? 'female' : 'male', 'player', modelLoad.signal, modelAssetBase,
        playerBundledMotions?.find(Boolean)?.schema.modelHash),
      loadSpectatorModel('male', 'far', modelLoad.signal, modelAssetBase),
      loadSpectatorModel('female', 'far', modelLoad.signal, modelAssetBase),
      loadHumanModel('male', 'crowd-high', modelLoad.signal, modelAssetBase),
      loadHumanModel('female', 'crowd-high', modelLoad.signal, modelAssetBase),
      loadSpectatorModel('male', 'full', modelLoad.signal, modelAssetBase),
      loadSpectatorModel('female', 'full', modelLoad.signal, modelAssetBase),
      ...DIVERSE_SPECTATORS.map(model => loadDiverseSpectatorModel(model.id, model.gender, modelLoad.signal, modelAssetBase)),
    ]).then((results) => {
      try {
        if (modelLoad.signal.aborted) return;
        const [player, maleCrowd, femaleCrowd, maleStaff, femaleStaff, maleHighDetailCrowd, femaleHighDetailCrowd, ...diverseCrowd] = results;
        if (player.status === 'fulfilled') {
          attachHumanPlayer(player.value, players[0], PALETTE.shirtOne, undefined, undefined,
            selectedPlayerKits[0], 0, playerBundledMotions?.[0] ?? undefined);
          attachHumanPlayer(player.value, players[1], PALETTE.shirtTwo, undefined, undefined,
            selectedPlayerKits[1], 1, playerBundledMotions?.[1] ?? undefined);
          detailedPlayersReady = true;
        }
        if (maleCrowd.status === 'fulfilled' && femaleCrowd.status === 'fulfilled') {
          const additions = diverseCrowd.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
          const crowdTemplates = [maleCrowd.value, femaleCrowd.value, ...additions];
          attachSpectatorCrowd(scene, crowdRig, crowdTemplates);
          addCrowdAccessories(scene, crowdRig);
          if (maleHighDetailCrowd.status === 'fulfilled') {
            crowdRig.setHighDetailModel(maleHighDetailCrowd.value, 0);
          }
          if (femaleHighDetailCrowd.status === 'fulfilled') {
            crowdRig.setHighDetailModel(femaleHighDetailCrowd.value, 1);
          }
          additions.forEach((template, index) => crowdRig.setHighDetailModel(template, index + 2));
          // Staff retain their existing rig. Never send a Rocketbox spectator
          // into the legacy absolute-joint staff posing code.
          if (maleStaff.status === 'fulfilled' || femaleStaff.status === 'fulfilled') {
            const male = maleStaff.status === 'fulfilled' ? maleStaff.value : (femaleStaff as PromiseFulfilledResult<THREE.Group>).value;
            const female = femaleStaff.status === 'fulfilled' ? femaleStaff.value : male;
            attachHumanCourtStaff(scene, fixtureRig, [male, female], crowdRig, male);
          }
        }
        const requiredFailure = [player, maleCrowd, femaleCrowd]
          .find((result) => result.status === 'rejected');
        if (requiredFailure?.status === 'rejected') throw requiredFailure.reason;
        const highDetailFailed = [maleHighDetailCrowd, femaleHighDetailCrowd, maleStaff, femaleStaff, ...diverseCrowd]
          .some((result) => result.status === 'rejected');
        if (highDetailFailed) {
          console.warn('Some crowd identities or full-detail models could not load; the crowd roster is incomplete.');
        }
        setModelStatus(highDetailFailed ? 'partial' : 'ready');
      } finally {
        // Visible instances retain texture maps; discard only the unused template buffers.
        results.forEach((result) => { if (result.status === 'fulfilled') disposeHumanModel(result.value, modelLoad.signal.aborted); });
      }
    }).catch((error: unknown) => {
      if (modelLoad.signal.aborted) return;
      console.error('Detailed DMO character models could not load.', error);
      setModelStatus(detailedPlayersReady ? 'partial' : 'failed');
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
    // Before a serve the ball is drawn in the server's free hand (bounces,
    // then held until the toss); this eases it back onto the recorded toss.
    const serveBall = { frame: -1, hand: null as THREE.Object3D | null };
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

    let wasFullscreen = false;
    const resize = () => {
      const bounds = viewport.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const width = bounds.width;
      const height = bounds.height;
      host.style.width = '100%';
      host.style.height = '100%';
      renderer.setPixelRatio(getBroadcastRenderPixelRatio(
        width,
        height,
        renderQualityRef.current,
        window.devicePixelRatio || 1,
      ));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      const compactFrame = bounds.width <= 720;
      const sceneElement = sceneElementRef.current;
      const fullscreenElement = document.fullscreenElement
        ?? (document as Document & { webkitFullscreenElement?: Element | null }).webkitFullscreenElement
        ?? null;
      const nativeFullscreen = fullscreenElement === sceneElement;
      const fullscreenActive = nativeFullscreen
        || Boolean(sceneElement?.classList.contains(styles.fullscreenFallback));
      const activeView = fullscreenCameraView<Exclude<CameraView, 'custom'>>(
        cameraViewRef.current, selectedCameraViewRef.current, wasFullscreen, fullscreenActive,
      );
      if (activeView !== cameraViewRef.current) {
        cameraViewRef.current = activeView;
        setCameraView(activeView);
      }
      wasFullscreen = fullscreenActive;
      const fullscreenCourtCamera = activeView === 'court'
        ? dmoFullscreenCourtCamera(
          width, height, fullscreenActive, maxDistanceForTarget(new THREE.Vector3(0, 0.5, 0)),
        )
        : null;
      const tvBroadcastCamera = activeView === 'tv'
        ? dmoTvBroadcastCamera(width, height, maxDistanceForTarget(new THREE.Vector3(0, 0.5, 0)))
        : null;
      camera.fov = activeView === 'aerial'
        ? 48
        : tvBroadcastCamera?.fov ?? fullscreenCourtCamera?.fov ?? (compactFrame ? 38 : 34);
      camera.updateProjectionMatrix();
      // Use an aspect-specific fullscreen pose to keep the whole court in frame.
      const responsiveScale = responsiveDmoCourtCameraScale(width, height, fullscreenActive);
      if (activeView === 'court') {
        if (fullscreenCourtCamera) {
          camera.position.set(
            fullscreenCourtCamera.x,
            fullscreenCourtCamera.y,
            fullscreenCourtCamera.z,
          );
        } else {
          camera.position.copy(DEFAULT_CAMERA).multiplyScalar(responsiveScale);
        }
        controls.target.set(0, 0.5, 0);
        cameraTargetAnchor.copy(controls.target);
      } else if (activeView === 'tv') {
        if (tvBroadcastCamera) {
          camera.position.set(tvBroadcastCamera.x, tvBroadcastCamera.y, tvBroadcastCamera.z);
        } else {
          camera.position.set(35, 11, 0);
        }
        controls.target.set(0, 0.5, 0);
        cameraTargetAnchor.copy(controls.target);
      } else if (activeView === 'aerial') {
        camera.position.set(0, Math.min(32, cameraMaxDistance * 0.98), 0.1);
        controls.target.set(0, 0.5, 0);
        cameraTargetAnchor.copy(controls.target);
      }
      controls.maxDistance = maxDistanceForTarget(cameraTargetAnchor);
      controls.minDistance = Math.min(preferredCameraMinDistance, controls.maxDistance);
      controls.update();
    };
    rendererResizeRef.current = resize;
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', resize);
    document.addEventListener('fullscreenchange', resize);
    document.addEventListener('webkitfullscreenchange', resize);
    document.addEventListener('courtfullscreenchange', resize);
    const observer = new ResizeObserver(resize);
    observer.observe(viewport);
    resize();

    let animation = 0;
    let lastTime = performance.now();
    let currentFrame = sampleBufferRef.current[0]?.frame ?? 0;
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let graphicsFailed = false;
    let changeoverUntil = 0;
    let changeoverLabelUntil = 0;
    let lastCrowdEventFrame: number | null = null;
    let crowdApplauseUntil = 0;
    let olderNetBallPosition: THREE.Vector3 | null = null;
    let previousNetBallPosition: THREE.Vector3 | null = null;
    let previousNetBallFrame: number | null = null;
    let lastNetImpactFrame = Number.NEGATIVE_INFINITY;
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
        // A recorded switch of ends is a scene cut, not a straight walk through
        // the net. It is labelled only when the score says the players change
        // ends (after odd games, odd sets, every six tie-break points).
        changeoverUntil = performance.now() + 650;
        rig.root.position.copy(position);
        if (transitionRef.current) {
          const label = isChangeoverCut(events, frame);
          if (label) changeoverLabelUntil = changeoverUntil;
          if (label || performance.now() >= changeoverLabelUntil) {
            transitionRef.current.textContent = label ? 'Change of ends' : '';
          }
          transitionRef.current.style.transition = 'none';
          transitionRef.current.style.opacity = '1';
        }
      }
      const replayRate = sceneDataRef.current.snapshot.frameRate ?? TE4_DMO_FRAMES_PER_SECOND;
      const wasWalking = Boolean(rig.root.userData.walking);
      // Walking advances with replay time, so pausing or scrubbing stops it.
      const lastWalkFrame = Number(rig.root.userData.lastWalkFrame ?? frame);
      const replaySeconds = Math.max(0, frame - lastWalkFrame) / (sceneDataRef.current.snapshot.frameRate ?? TE4_DMO_FRAMES_PER_SECOND);
      rig.root.userData.lastWalkFrame = frame;
      rig.root.userData.walking = false;
      if (!rig.root.userData.positionInitialized) {
        rig.root.position.copy(position);
        rig.root.userData.positionInitialized = true;
      } else {
        const movement = position.clone().sub(rig.root.position);
        const distance = movement.length();
        const nextServe = findLiveCourtShotInRange(events, frame, frame + replayRate * 90, 'serve');
        const plan = changedEnds ? 'follow' : planReposition({
          distance,
          betweenPoints: isBetweenPoints(events, frame),
          secondsToNextServe: nextServe
            ? (nextServe.frame - frame) / replayRate
            : Number.POSITIVE_INFINITY,
          walking: wasWalking,
        });
        if (plan === 'cut') {
          // Too far (or too little time) to walk before the next point: a short
          // fade to the new position, like a broadcast cut, never a glide.
          changeoverUntil = performance.now() + 450;
          rig.root.position.copy(position);
          rig.root.userData.lastRootPosition = position.clone();
          if (transitionRef.current) {
            if (performance.now() >= changeoverLabelUntil) transitionRef.current.textContent = '';
            transitionRef.current.style.transition = 'none';
            transitionRef.current.style.opacity = '1';
          }
        } else if (plan === 'walk') {
          // Between points: walk there at walking pace, facing the way it goes.
          const step = replaySeconds * WALK_SPEED;
          rig.root.position.addScaledVector(movement, Math.min(1, step / distance));
          rig.root.userData.walking = true;
          // Face the way he walks; square up to the net over the last half metre.
          // Short adjustments and imminent serves stay facing the net.
          const netFacing = liveCourtFacingAngle(position.x < 0 ? -1 : 1);
          rig.root.userData.walkHeading = distance > 0.5
            ? limitHeadingToNet(Math.atan2(movement.x, movement.z), netFacing,
              nextServe ? (nextServe.frame - frame) / replayRate : Number.POSITIVE_INFINITY, distance)
            : netFacing;
        } else {
          // Follow the recording through a jitter filter (whole-cm samples every
          // other frame shake by a centimetre or two; see filterCourtPosition).
          // (A change of ends or a jump backwards restarts it from the recording.)
          const filter = filterCourtPosition(
            changedEnds ? undefined : rig.root.userData.positionFilter as PositionFilter | undefined,
            position.x,
            position.z,
            frame < lastWalkFrame ? Number.POSITIVE_INFINITY : replaySeconds,
          );
          rig.root.userData.positionFilter = filter;
          const smoothed = new THREE.Vector3(filter.x, 0, filter.z);
          const toSmoothed = smoothed.clone().sub(rig.root.position);
          // Limit location changes to a plausible court movement speed to avoid
          // teleport flashes when the recording shifts between sampled positions.
          const maximumStep = Math.max(0.04, elapsedMs / 1000 * 7);
          // A seek (scrubbing, or jumping back) places him where the recording
          // has him rather than gliding there.
          const seeking = frame < lastWalkFrame || replaySeconds > 0.5;
          const followDistance = toSmoothed.length();
          if (seeking || followDistance <= maximumStep) rig.root.position.copy(smoothed);
          else if (followDistance > 0) rig.root.position.addScaledVector(toSmoothed, maximumStep / followDistance);
        }
      }
      {
        // Keep the filter on the rig's actual position after a walk, a cut or
        // a capped step, with the velocity it really moved at.
        const previousFilter = rig.root.userData.positionFilter as PositionFilter | undefined;
        const lastPlaced = rig.root.userData.lastPlacedPosition as THREE.Vector3 | undefined;
        const placedVelocity = lastPlaced && replaySeconds > 0 && replaySeconds <= 0.5
          ? rig.root.position.clone().sub(lastPlaced).divideScalar(replaySeconds)
          : undefined;
        const velocityStep = replaySeconds > 0.5 || !previousFilter ? 1 : 1 - Math.exp(-replaySeconds / 0.08);
        rig.root.userData.positionFilter = {
          ...previousFilter,
          x: rig.root.position.x,
          z: rig.root.position.z,
          vx: placedVelocity && previousFilter
            ? previousFilter.vx + (placedVelocity.x - previousFilter.vx) * velocityStep
            : replaySeconds === 0 && previousFilter && frame >= lastWalkFrame ? previousFilter.vx : 0,
          vz: placedVelocity && previousFilter
            ? previousFilter.vz + (placedVelocity.z - previousFilter.vz) * velocityStep
            : replaySeconds === 0 && previousFilter && frame >= lastWalkFrame ? previousFilter.vz : 0,
        } satisfies PositionFilter;
        if (replaySeconds > 0 || !lastPlaced) rig.root.userData.lastPlacedPosition = rig.root.position.clone();
      }
      const frameRate = sceneDataRef.current.snapshot.frameRate ?? TE4_DMO_FRAMES_PER_SECOND;
      // Stroke timings below use 60-per-second frames. Full replays at 30 fps
      // need their frame deltas converted or recorded motions run too slowly.
      const frameScale = liveCourtReplayFrameScale(frameRate);
      const maxGapFrames = frameRate * sceneDataRef.current.playbackSpeed / 2;
      const prior = interpolateLiveCourtFrame(samples, Math.max(firstFrame, frame - 2), maxGapFrames) ?? values;
      const later = interpolateLiveCourtFrame(samples, Math.min(lastFrame, frame + 2), maxGapFrames) ?? values;
      const xIndex = index === 0 ? 3 : 5;
      const zIndex = index === 0 ? 4 : 6;
      // Movement over 4 frames, from the filtered position (the raw samples'
      // jitter made the speed, stride and body lean shake).
      const filteredVelocity = rig.root.userData.positionFilter as PositionFilter;
      const velocityX = filteredVelocity.vx * 4 / frameRate;
      const velocityZ = filteredVelocity.vz * 4 / frameRate;
      const speed = Math.min(1, Math.hypot(velocityX, velocityZ) / 0.35);
      const ballX = values[0] * SCALE;
      const ballZ = values[1] * SCALE;
      const ballY = Math.max(0, values[2] * SCALE) + BALL_RADIUS;
      const storedSide = rig.root.userData.courtSide;
      const courtSide = (storedSide === -1 || storedSide === 1) && Math.abs(position.x) <= 0.8
        ? storedSide
        : position.x < 0 ? -1 : 1;
      rig.root.userData.courtSide = courtSide;
      const walking = Boolean(rig.root.userData.walking);
      // Between points TE4 often records the walk back to the line itself.
      // Walking a few metres sideways or backwards while facing the net looked
      // like a long crab-shuffle; he turns and walks there instead, then squares
      // up as he arrives. Look half a second ahead so shuffling in place does
      // not turn him.
      let strollHeading: number | undefined;
      if (!walking && !changedEnds && isBetweenPoints(events, frame)) {
        const ahead = interpolateLiveCourtFrame(samples, Math.min(lastFrame, frame + Math.round(frameRate / 2)), maxGapFrames);
        if (ahead) {
          const aheadX = (ahead[xIndex] - values[xIndex]) * SCALE;
          const aheadZ = (ahead[zIndex] - values[zIndex]) * SCALE;
          const covering = Math.hypot(aheadX, aheadZ);
          const strolling = covering > (rig.root.userData.strollFacing ? 0.3 : 0.5);
          rig.root.userData.strollFacing = strolling;
          if (strolling) {
            // How far the walk still goes: the path the recording has him walk
            // over the next 4 s, up to where he stops or TE4 cuts (jumps him to
            // his place). Judged by where he'd be later, a walk cut short by
            // a jump, or a slow one, counted as a short adjustment and he
            // side-stepped all the way back.
            let metresToGo = 0;
            {
              let previous = values;
              let still = 0;
              for (let ahead = frame + 2; ahead <= Math.min(lastFrame, frame + frameRate * 4); ahead += 2) {
                const next = interpolateLiveCourtFrame(samples, ahead, maxGapFrames);
                if (!next) break;
                const step = Math.hypot((next[xIndex] - previous[xIndex]) * SCALE, (next[zIndex] - previous[zIndex]) * SCALE);
                if (step > 0.5) break; // a cut
                metresToGo += step;
                still = step * frameRate / 2 < 0.3 ? still + 2 : 0;
                if (still >= frameRate / 2) break; // stopped
                previous = next;
              }
            }
            const serveDue = findLiveCourtShotInRange(events, frame, frame + frameRate * 90, 'serve');
            strollHeading = limitHeadingToNet(Math.atan2(aheadX, aheadZ), liveCourtFacingAngle(courtSide),
              serveDue ? (serveDue.frame - frame) / frameRate : Number.POSITIVE_INFINITY, metresToGo);
          }
        }
      } else {
        rig.root.userData.strollFacing = false;
      }
      const targetFacing = walking
        ? Number(rig.root.userData.walkHeading)
        : strollHeading ?? liveCourtFacingAngle(courtSide);
      const facingDelta = Math.atan2(
        Math.sin(targetFacing - rig.root.rotation.y),
        Math.cos(targetFacing - rig.root.rotation.y),
      );
      // Ease turns in replay time and cap them so players step through the turn.
      const turnSeconds = frame < lastWalkFrame || replaySeconds > 0.5 ? Number.POSITIVE_INFINITY : replaySeconds;
      const turnCap = 6 * turnSeconds;
      const facing = rig.root.userData.facingInitialized
        ? rig.root.rotation.y + THREE.MathUtils.clamp(
          facingDelta * (1 - Math.exp(-12 * turnSeconds)), -turnCap, turnCap)
        : targetFacing;
      const turned = rig.root.userData.facingInitialized ? Math.abs(facing - rig.root.rotation.y) : 0;
      rig.root.userData.facingInitialized = true;
      const eventPlayer = index === 0 ? 1 : 2;
      const bundledSource = playerBundledMotions?.[index];
      const nativeServeTiming = bundledCaptureTiming(bundledSource, { stroke: 'serve' });
      const nearbyEvent = findPlayerShotEvent(events, eventPlayer, frame, 24 / frameScale);
      const upcomingServe = nearbyEvent
        ? undefined
        : findPlayerShotEvent(events, eventPlayer, frame,
          (nativeServeTiming?.leadFrames ?? SERVE_LEAD_FRAMES) / frameScale, 'serve');
      const event = nearbyEvent ?? (upcomingServe && upcomingServe.frame > frame ? upcomingServe : undefined);
      const serving = event?.shotType === 'serve';
      const contactCue = event
        ? inferLiveCourtContactCue(
          event,
          samples,
          sceneDataRef.current.snapshot.frameRate ?? TE4_DMO_FRAMES_PER_SECOND,
        )
        : 'standard';
      const jump = serving ? serveLift((frame - event.frame) * frameScale) : 0;
      const strokeDelta = event ? (frame - event.frame) * frameScale : Number.POSITIVE_INFINITY;
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
      let servePreparation = serving
        ? THREE.MathUtils.smoothstep(strokeDelta, -24, -12)
          * (1 - THREE.MathUtils.smoothstep(strokeDelta, -3, 0))
        : 0;
      let serveToss = serving
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
      // Where the player looks: the ball (when the recording has it), in rig
      // space. Between points, more loosely.
      const ballRecorded = Math.abs(values[0]) > 1 || Math.abs(values[1]) > 1;
      rig.root.userData.lookTarget = [localX, ballY / rig.root.scale.y, localZ];
      rig.root.userData.lookWeight = ballRecorded ? (isBetweenPoints(events, frame) ? 0.6 : 1) : 0;
      const slideWeight = liveCourtSlideWeight(footworkEventsRef.current, eventPlayer, frame, frameRate);
      const lateralVelocity = velocityX * localXAxis[0] + velocityZ * localXAxis[1];
      const slideDirection = Math.sign(lateralVelocity);
      // Ground-locked stepping: the step cycle advances by the distance the rig
      // actually travels, along its travel direction (see lib/liveCourtGait).
      const speedMs = Math.hypot(velocityX, velocityZ) * frameRate / 4;
      const gait = (rig.root.userData.gait as GaitState | undefined) ?? newGaitState();
      rig.root.userData.gait = gait;
      const lastRoot = rig.root.userData.lastRootPosition as THREE.Vector3 | undefined;
      const moved = lastRoot ? rig.root.position.clone().sub(lastRoot) : new THREE.Vector3();
      rig.root.userData.lastRootPosition = rig.root.position.clone();
      const travel: [number, number] = moved.length() > 0.6 ? [0, 0] : [
        (moved.x * localXAxis[0] + moved.z * localXAxis[1]) / rig.root.scale.x,
        (moved.x * Math.sin(facing) + moved.z * Math.cos(facing)) / rig.root.scale.x,
      ];
      // Turning on the spot is stepped too, rather than pivoting on planted feet.
      const turnDistance = turned * 0.18;
      const turnSpeed = Number.isFinite(turnSeconds) && turnSeconds > 0 ? turnDistance / turnSeconds : 0;
      if (turnDistance > 0 && Number.isFinite(turnSeconds)) {
        travel[0] += gait.direction[0] * turnDistance;
        travel[1] += gait.direction[1] * turnDistance;
      }
      const steppingSpeed = Math.max(walking ? WALK_SPEED : speedMs * (1 - slideWeight), Math.min(1.5, turnSpeed));
      // Stride style: natural strides when walking or jogging somewhere between
      // points (and on a sprint with the racket at the side); short quick
      // footwork around the ball in a rally. Use the eased carry from last frame.
      gait.walking = walking ? 1 : THREE.MathUtils.clamp(Number(rig.root.userData.carryMove ?? 0), 0, 1);
      // On a fast run across the court the hips turn toward the run (up to
      // ~60 degrees, chest half as much, eyes on the ball) and the steps go
      // along it, alternating like a real run. A side-shuffle at that speed
      // spread the legs wide and stiff. The gait works in the hips' frame.
      const hipYaw = Number(rig.root.userData.runHipYaw ?? 0);
      const toHips = (v: [number, number]): [number, number] => [
        v[0] * Math.cos(hipYaw) - v[1] * Math.sin(hipYaw),
        v[0] * Math.sin(hipYaw) + v[1] * Math.cos(hipYaw),
      ];
      const fromHips = (x: number, z: number): [number, number] => [
        x * Math.cos(hipYaw) + z * Math.sin(hipYaw),
        -x * Math.sin(hipYaw) + z * Math.cos(hipYaw),
      ];
      advanceGait(gait, toHips(travel), steppingSpeed);
      const [stepA, stepB] = gaitFeet(gait, steppingSpeed);
      {
        const travelDirection = fromHips(gait.direction[0], gait.direction[1]);
        const across = Math.abs(travelDirection[0]);
        const ownShotSoon = (() => {
          const next = nextShotEvent(events, eventPlayer, frame);
          return next !== undefined && (next.frame - frame) * frameScale < RALLY_RUN_CARRY_CUTOFF_FRAMES;
        })();
        const turnWanted = THREE.MathUtils.smoothstep(steppingSpeed, 2.6, 3.6)
          * THREE.MathUtils.smoothstep(across, 0.5, 0.85) * gait.amount
          * (ownShotSoon || walking ? 0 : 1);
        const wantedYaw = THREE.MathUtils.clamp(
          Math.atan2(travelDirection[0], Math.abs(travelDirection[1])),
          -RUN_HIP_TURN,
          RUN_HIP_TURN,
        ) * turnWanted;
        const maxTurn = 3 * Math.max(0, Math.min(0.1, replaySeconds));
        rig.root.userData.runHipYaw = replaySeconds > 0.5
          ? wantedYaw
          : hipYaw + THREE.MathUtils.clamp(wantedYaw - hipYaw, -maxTurn, maxTurn);
      }
      rig.root.userData.locomotionSpeed = steppingSpeed;
      const phase = gait.phase * Math.PI * 2 + index * Math.PI;
      const gaitSpeed = gait.amount * Math.min(1, speedMs / 4);
      // Return of serve: wide, low, hips hinged, racket in front, with a
      // split-step timed to the server's contact.
      const opponentServe = findPlayerShotEvent(events, eventPlayer === 1 ? 2 : 1, frame, 90 / frameScale, 'serve');
      const framesToServe = opponentServe ? (opponentServe.frame - frame) * frameScale : Number.POSITIVE_INFINITY;
      // Sets up once this player's own last shot is over, easing in rather than
      // switching on the frame the shot window ends.
      const ownLastShot = lastShotFrame(events, eventPlayer, frame);
      const upcomingOwn = event && event.frame > frame;
      const freeOfOwnShot = upcomingOwn ? 0
        : ownLastShot === undefined ? 1 : THREE.MathUtils.smoothstep((frame - ownLastShot) * frameScale, 14, 34);
      // Only once he has arrived: walking back to the line (or any real
      // movement) is done upright, and the stance settles in after he stops.
      // Covers the walk back that TE4 records at the start of a point as well as
      // our own walks. Recorded speed is noisy (whole-cm samples every other
      // frame), so it is smoothed over replay time first.
      const speedStep = replaySeconds > 0.5 ? 1 : 1 - Math.exp(-replaySeconds / 0.15);
      const previousSpeed = Number(rig.root.userData.smoothSpeed ?? steppingSpeed);
      const smoothSpeed = previousSpeed + (steppingSpeed - previousSpeed) * speedStep;
      rig.root.userData.smoothSpeed = smoothSpeed;
      // Net travel: shuffling in place counts as being in position, while
      // walking or running somewhere does not.
      const travelFilter = rig.root.userData.positionFilter as PositionFilter;
      const travelTrend = (rig.root.userData.travelTrend as [number, number] | undefined) ?? [travelFilter.vx, travelFilter.vz];
      const trendDt = frame < lastWalkFrame ? Number.POSITIVE_INFINITY : replaySeconds;
      const nextTrend: [number, number] = [
        easeToward(travelTrend[0], travelFilter.vx, trendDt, 0.35),
        easeToward(travelTrend[1], travelFilter.vz, trendDt, 0.35),
      ];
      rig.root.userData.travelTrend = nextTrend;
      const travelSpeed = walking ? WALK_SPEED : Math.hypot(nextTrend[0], nextTrend[1]);
      const settleTarget = walking ? 0 : 1 - THREE.MathUtils.smoothstep(travelSpeed, 0.45, 0.9);
      const previousSettle = Number(rig.root.userData.settled ?? settleTarget);
      const settleTime = settleTarget < previousSettle ? 0.08 : 0.2; // rise quickly, settle gently
      const settleStep = replaySeconds > 0.5 ? 1 : 1 - Math.exp(-replaySeconds / settleTime);
      const settled = previousSettle + (settleTarget - previousSettle) * settleStep;
      rig.root.userData.settled = settled;
      // Serve and return set-ups wait until the player is in position: stopped
      // (not walking), and at the baseline to serve or in the back of his half
      // to return. After a point TE4 can record the next serve before the
      // player has got back, and the set-up used to start wherever he was.
      // Once a serve has set up it plays through.
      const behindBaseline = COURT_LENGTH / 2 - Math.abs(rig.root.position.x); // + = inside the court
      const stoppedAt = (place: boolean) => (!walking && place ? 1 - THREE.MathUtils.smoothstep(travelSpeed, 0.6, 1.2) : 0);
      const easeGate = (key: string, target: number, latchFrame?: number) => {
        const latched = latchFrame !== undefined && rig.root.userData[`${key}Latch`] === latchFrame;
        if (latched) return 1;
        const previous = Number(rig.root.userData[key] ?? target);
        const step = replaySeconds > 0.5 ? 1 : replaySeconds / 0.35;
        const next = THREE.MathUtils.clamp(previous + THREE.MathUtils.clamp(target - previous, -step, step), 0, 1);
        rig.root.userData[key] = next;
        if (latchFrame !== undefined && next >= 0.999) rig.root.userData[`${key}Latch`] = latchFrame;
        return next * next * (3 - 2 * next);
      };
      // (Whatever the positions say, the serve itself is fully on by 10 frames
      // before contact, so it never snaps in at the hit.)
      const serveGate = serving && event
        ? Math.max(
          easeGate('serveGate', stoppedAt(behindBaseline < 0.6), event.frame),
          THREE.MathUtils.smoothstep(strokeDelta, -30, -10),
        )
        : easeGate('serveGate', 0);
      servePreparation *= serveGate;
      serveToss *= serveGate;
      rig.root.userData.serveSetUp = serveGate;
      // Pre-serve bounces (the recording only holds the ball still): the free
      // hand meets the ball at the top of each bounce.
      {
        const ownServe = nextShotEvent(events, eventPlayer, frame);
        const secondsToContact = ownServe?.shotType === 'serve' ? (ownServe.frame - frame) / frameRate : Number.NaN;
        const held = Number.isFinite(secondsToContact) ? liveCourtBallHeldSeconds(samples, frame, frameRate) : 0;
        const bounce = serveBounceHeight(secondsToContact, secondsToContact + held);
        const start = SERVE_BOUNCE_END_SECONDS + SERVE_BOUNCES * SERVE_BOUNCE_SECONDS;
        const handWeight = bounce === null ? 0
          : THREE.MathUtils.smoothstep(start - secondsToContact, 0, 0.15)
            * THREE.MathUtils.smoothstep(secondsToContact - SERVE_BOUNCE_END_SECONDS, 0, 0.15);
        // TE4 holds the ball low (about hip height or below), out of reach of
        // the hanging hand: the bounces start from a comfortable hand height
        // (just above where the arm hangs), and the ball drawing uses the same top.
        const top = Math.max(values[2] * SCALE, 0.9 * rig.root.scale.y);
        rig.root.userData.serveBounceTop = top;
        rig.root.userData.serveBounce = handWeight > 0 ? {
          weight: handWeight,
          hand: [localX, (top * Math.max(bounce!, 0.85) + BALL_RADIUS + 0.05) / rig.root.scale.y, localZ],
        } : undefined;
      }
      const returnGate = opponentServe
        ? easeGate('returnGate', stoppedAt(behindBaseline < 3.2), opponentServe.frame)
        : easeGate('returnGate', 0);
      // Once set to return, small adjustment shuffles keep the stance; a real
      // run takes it away. Gating only on stillness made the receiver bob.
      const returnSetUp = opponentServe !== undefined
        && rig.root.userData.returnGateLatch === opponentServe.frame;
      const stanceHold = returnSetUp && !walking
        ? easeToward(
          rig.root.userData.stanceHold as number | undefined,
          1 - THREE.MathUtils.smoothstep(travelSpeed, 1.2, 2.0),
          frame < lastWalkFrame ? Number.POSITIVE_INFINITY : replaySeconds,
          0.25,
        )
        : settled;
      rig.root.userData.stanceHold = stanceHold;
      const ready = opponentServe ? returnReadiness(framesToServe) * freeOfOwnShot * stanceHold * returnGate : 0;
      // A small split-step as the opponent hits in a rally too (players are
      // neutral then, before turning to the ball), when not running hard.
      const opponentRallyShot = opponentServe ? undefined
        : findPlayerShotEvent(events, eventPlayer === 1 ? 2 : 1, frame, 12 / frameScale, 'rally');
      const rallySplit = opponentRallyShot && !walking
        ? splitStepLift((opponentRallyShot.frame - frame) * frameScale) * 0.6 * freeOfOwnShot
          * (1 - THREE.MathUtils.smoothstep(travelSpeed, 1.5, 3))
        : 0;
      const splitStep = opponentServe
        ? splitStepLift(framesToServe) * freeOfOwnShot * stanceHold * returnGate
        : rallySplit;
      // Ease the switch between captured and procedural legs over replay time.
      rig.root.userData.stepLegs = easeToward(
        rig.root.userData.stepLegs as number | undefined,
        THREE.MathUtils.smoothstep(smoothSpeed, 0.5, 1.4),
        frame < lastWalkFrame ? Number.POSITIVE_INFINITY : replaySeconds,
        0.12,
      );
      const stanceHalfWidth = 0.15 + ready * 0.2;
      const slideSpread = slideDirection * slideWeight * 0.15;
      const landing = 1 - slideWeight * 0.8;
      const leftLift = (stepA.lift + jump + splitStep) * landing;
      const rightLift = (stepB.lift + jump + splitStep) * landing;
      const footstepState: FootstepContactState = (rig.root.userData.footstepState as FootstepContactState | undefined)
        ?? { frame, airborne: [false, false] };
      rig.root.userData.footstepState = footstepState;
      rig.root.userData.footstepContact = updateLiveCourtFootstepContact(
        footstepState, frame, [leftLift, rightLift],
        steppingSpeed > 0.5 && slideWeight < 0.15 && !serving
          && jump < 0.001 && splitStep < 0.001 && rig.root.userData.stepLegs > 0.5,
        frameRate,
      );
      // Pick the same current/lead shot used by the stroke player before
      // computing body posture, so an overhead cannot crouch during its lead-in.
      const heldStroke = rig.root.userData.capturedGroundstrokeEvent as {
        frame: number; stroke: GroundstrokeName;
        slice?: boolean; smash?: boolean;
      } | undefined;
      const heldNativeTiming = heldStroke ? bundledCaptureTiming(bundledSource, heldStroke) : undefined;
      const heldRecoveryFrames = heldNativeTiming?.recoveryFrames ?? (isRecordedVolley(heldStroke?.stroke)
        ? VOLLEY_RECOVERY_FRAMES * frameRate / 60 * frameScale
        : CAPTURE_RECOVERY_FRAMES);
      const recovering = heldStroke !== undefined && frame >= heldStroke.frame
        && (frame - heldStroke.frame) * frameScale <= heldRecoveryFrames;
      const comingShot = event || recovering ? undefined : nextShotEvent(events, eventPlayer, frame);
      const leadEvent = comingShot && comingShot.shotType === 'rally'
        && (comingShot.frame - frame) * frameScale <= GROUNDSTROKE_LEAD_FRAMES ? comingShot : undefined;
      // A serve coming up does not cut short the previous stroke's recovery
      // either (its recorded set-up starts ~1.8 s ahead); only a shot about to
      // be played (within the 24-frame shot window) takes over.
      const waitForRecovery = recovering && event && (event.frame - frame) * frameScale > 24
        && event.frame !== heldStroke!.frame;
      const strokeEvent = waitForRecovery ? undefined : event ?? leadEvent;
      const strokeCue = !strokeEvent ? 'standard' : strokeEvent === event ? contactCue : inferLiveCourtContactCue(
        strokeEvent,
        samples,
        sceneDataRef.current.snapshot.frameRate ?? TE4_DMO_FRAMES_PER_SECOND,
      );
      const contactSample = strokeEvent
        ? interpolateLiveCourtFrame(samples, strokeEvent.frame, maxGapFrames)
        : undefined;
      const bodyBounce = (stepA.lift + stepB.lift) * 0.3 + jump + splitStep;
      const earlierCapturedSmash = Boolean(
        (rig.root.userData.capturedGroundstrokeEvent as { smash?: boolean } | undefined)?.smash,
      );
      const suppressSmashCrouch = Boolean(rig.root.userData.capturedSmash
        && (earlierCapturedSmash || isCapturedSmashShot(strokeEvent, contactSample)));
      const crouch = suppressSmashCrouch ? 0
        : impactWeight * lowReachDrop(ballY, Math.hypot(localX, localZ))
          + slideWeight * 0.13 + ready * 0.24;
      rig.root.rotation.y = facing;
      const bodyY = 1.22 + bodyBounce - crouch * 0.45;
      const strokeSide = Math.sign(localX || dominantHandX(handedness));
      const trunkTurn = (shapedBackswing * 0.36 - shapedFollowThrough * 0.28
        + servePreparation * 0.22 - serveFollowThrough * 0.16) * strokeSide;
      const runLean = gait.amount * Math.min(0.16, steppingSpeed * 0.045);
      rig.body.position.set(Math.sin(phase * 0.5) * gaitSpeed * 0.02, bodyY, 0);
      rig.body.rotation.z = THREE.MathUtils.clamp(
        -lateralVelocity * 1.8 - slideDirection * slideWeight * 0.09,
        -0.3,
        0.3,
      );
      rig.body.rotation.x = crouch * 0.5 + shapedFollowThrough * 0.08 - serveFollowThrough * 0.05
        + ready * 0.36 + runLean;
      rig.body.rotation.y = trunkTurn + hipYaw * 0.5;
      rig.hip.position.y = 0.90 + bodyBounce - crouch * 0.75;
      // Standing between points: a slow, small weight shift from foot to foot
      // instead of standing frozen (not once set up at the line).
      {
        const idle = isBetweenPoints(events, frame) && !walking && steppingSpeed < 0.3
          ? 1 - Math.max(serveGate, returnGate) : 0;
        const sway = Math.sin((frame / frameRate) * Math.PI * 2 * 0.3 + index * 1.7);
        rig.hip.position.x = sway * 0.018 * idle;
        rig.hip.rotation.z = -sway * 0.025 * idle;
      }
      rig.hip.rotation.x = ready * 0.3 + runLean * 0.5;
      rig.hip.rotation.y = trunkTurn * 0.42 + hipYaw;
      rig.head.position.set(0, 1.73 + bodyBounce * 0.8 - crouch * 0.3 - ready * 0.12, ready * 0.26);
      rig.head.rotation.y = THREE.MathUtils.clamp(localX * 0.72, -0.28, 0.28) * (1 - ready);
      rig.head.rotation.x = THREE.MathUtils.clamp(-(ballY - 1.45) * 0.08, -0.18, 0.18) - ready * 0.08;
      const effort = THREE.MathUtils.clamp(
        impactWeight * 0.35 + shapedBackswing * 0.18 + shapedFollowThrough * 0.48 + gaitSpeed * 0.16 + jump * 0.32,
        0,
        1,
      );
      rig.face.leftEye.scale.y = 0.68 - effort * 0.1;
      rig.face.rightEye.scale.y = 0.68 - effort * 0.1;
      rig.face.mouth.scale.y = 0.16 + effort * 0.84;
      rig.face.leftBrow.rotation.z = 0.04 + effort * 0.07;
      rig.face.rightBrow.rotation.z = -0.04 - effort * 0.07;
      const leftHip = new THREE.Vector3(-0.13, 0.90 + bodyBounce - crouch * 0.75, 0);
      const rightHip = new THREE.Vector3(0.13, 0.90 + bodyBounce - crouch * 0.75, 0);
      const [leftFootX, leftFootZ] = fromHips(-stanceHalfWidth + stepA.x - slideSpread * 0.35, stepA.z + ready * 0.05);
      const [rightFootX, rightFootZ] = fromHips(stanceHalfWidth + stepB.x + slideSpread * 0.35, stepB.z + ready * 0.05);
      const leftFoot = new THREE.Vector3(leftFootX, 0.1 + leftLift, leftFootZ);
      const rightFoot = new THREE.Vector3(rightFootX, 0.1 + rightLift, rightFootZ);
      {
        // A planted foot doesn't turn with the hips: once the hips have turned
        // (toward or back from a run across the court) since it landed, it
        // stays where it is on the court, moving only against the body's
        // travel, until it lifts; in the air it eases back onto the stride.
        // (The steps are laid out in the hips' frame, so turning that frame
        // swung a planted foot round.) Held per foot from landing to lift-off,
        // so repeated updates within one replay frame keep the hold.
        type FootPin = { x: number; z: number; lift: number; yaw: number; ox: number; oz: number; frame: number };
        const pins = rig.root.userData.footPins as { left: FootPin; right: FootPin } | undefined;
        const seeking = replaySeconds > 0.5 || (pins !== undefined && frame < pins.left.frame);
        const next = {} as { left: FootPin; right: FootPin };
        for (const [key, foot, lift] of [['left', leftFoot, leftLift], ['right', rightFoot, rightLift]] as const) {
          const before = seeking ? undefined : pins?.[key];
          let ox = 0, oz = 0, yaw = hipYaw;
          if (before && lift <= 1e-4 && before.lift <= 1e-4) {
            yaw = before.yaw; // the hips' turn when this foot landed
            if (Math.abs(hipYaw - yaw) > 1e-4 || Math.hypot(before.ox, before.oz) > 1e-4) {
              ox = before.x - travel[0] - foot.x;
              oz = before.z - travel[1] - foot.z;
            }
          } else if (before) {
            const fade = Math.exp(-replaySeconds / 0.06);
            ox = before.ox * fade;
            oz = before.oz * fade;
          }
          foot.x += ox;
          foot.z += oz;
          next[key] = { x: foot.x, z: foot.z, lift, yaw, ox, oz, frame };
        }
        rig.root.userData.footPins = next;
      }
      {
        // Wide-ball lunges spread the leading and trailing feet as recorded.
        const lunge = rig.root.userData.lunge as { weight: number; side: number } | undefined;
        if (lunge && lunge.weight > 0.001) {
          const lead = lunge.side > 0 ? rightFoot : leftFoot;
          const trail = lead === rightFoot ? leftFoot : rightFoot;
          const apart = (lead.x - trail.x) * lunge.side;
          const wanted = LUNGE_FEET_APART * lunge.weight;
          if (apart < wanted) {
            lead.x += (wanted - apart) * 0.6 * lunge.side;
            trail.x -= (wanted - apart) * 0.4 * lunge.side;
          }
        }
      }
      // Recorded legs (walk / jog / run) for the detailed player: on a run or
      // walk the swinging leg follows the recording (knee drive, heel lift);
      // a planted foot stays exactly where the gait put it. Not for side
      // shuffles, which the recordings (straight-ahead runs) don't show.
      {
        const hipsDirection = gait.direction;
        const shuffle = THREE.MathUtils.smoothstep(Math.abs(hipsDirection[0]), 0.45, 0.85);
        const backward = THREE.MathUtils.smoothstep(-hipsDirection[1], 0.2, 0.6);
        rig.root.userData.recordedLegs = THREE.MathUtils.smoothstep(steppingSpeed, 0.9, 1.6)
          * THREE.MathUtils.clamp(gait.amount, 0, 1) * (1 - shuffle) * (1 - backward);
        rig.root.userData.gaitLift = { r: stepA.lift * landing, l: stepB.lift * landing };
      }
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
      rig.leftShoe.rotation.y = 0;
      rig.rightShoe.rotation.y = 0;
      rig.leftShoe.rotation.z = -slideDirection * slideWeight * 0.08;
      rig.rightShoe.rotation.z = slideDirection * slideWeight * 0.08;
      const dominantX = dominantHandX(handedness);
      const playerStrokeStyle = sceneDataRef.current.snapshot.strokeStyles?.[index];
      const contactSide = contactSample
        ? ((contactSample[0] - contactSample[xIndex]) * localXAxis[0]
          + (contactSample[1] - contactSample[zIndex]) * localXAxis[1]) * SCALE / rig.root.scale.x
        : localX;
      const baseStroke = groundstrokeForBallSide(contactSide, handedness);
      const stroke = baseStroke;
      type CapturedEvent = {
        frame: number;
        stroke: GroundstrokeName;
        handedness: 'left' | 'right';
        slice?: boolean;
        spinSlice?: boolean;
        smash?: boolean;
        /** A stretch at a ball going past him (no TE4 shot). */
        attempt?: boolean;
        /** A two-hander's stretched backhand: he lets go with the free hand. */
        oneHandReach?: boolean;
      };
      let capturedEvent = rig.root.userData.capturedGroundstrokeEvent as CapturedEvent | undefined;
      // Inferred soft-touch cues are not a reason to replace a recorded stroke
      // with the procedural arm pose; retain capture for both playing hands.
      // Height at the rally contact is the only overhead selector; it applies
      // on either side of a bounce and anywhere on court. Serves are excluded
      // by isCapturedSmashShot.
      const recordedSmash = Boolean(rig.root.userData.capturedSmash
        && isCapturedSmashShot(strokeEvent, contactSample));
      const recordedVolley = !recordedSmash
        && strokeCue === 'close-net' && Boolean(rig.root.userData.capturedVolleys);
      const recordedTouch = !recordedSmash
        && strokeCue === 'soft-touch' && Boolean(rig.root.userData.capturedVolleys);
      if (strokeEvent && !recordedSmash && (
        (strokeCue === 'close-net' && !recordedVolley)
        || (strokeCue === 'soft-touch' && !recordedTouch)
      )) {
        delete rig.root.userData.capturedGroundstrokeEvent;
        delete rig.root.userData.groundstrokePlayback;
        capturedEvent = undefined;
      }
      if (strokeEvent) {
        if (capturedEvent?.frame !== strokeEvent.frame || capturedEvent.handedness !== handedness) {
          capturedEvent = {
            frame: strokeEvent.frame,
            // The recording is a one-handed racket-side overhead, independent
            // of which side of the body the ball approaches from.
            stroke: strokeEvent.shotType === 'serve' ? 'serve' : recordedSmash ? 'forehand' : stroke,
            handedness,
            ...(recordedSmash ? { smash: true } : {}),
            ...((strokeEvent as { attempt?: boolean }).attempt ? { attempt: true } : {}),
            ...((strokeEvent as { attempt?: boolean }).attempt && stroke === 'backhand' && contactSample
              && Math.hypot((contactSample[0] - contactSample[xIndex]) * SCALE, (contactSample[1] - contactSample[zIndex]) * SCALE)
                > ONE_HAND_STRETCH_METRES ? { oneHandReach: true } : {}),
          };
          if (!recordedSmash && isCapturedVolleyShot(
            strokeEvent, contactSample, samples, events, soundEventsRef.current,
            sceneDataRef.current.snapshot.frameRate ?? TE4_DMO_FRAMES_PER_SECOND,
          )) {
            capturedEvent.stroke = recordedStrokeForSide(baseStroke, true);
          } else if (
            !recordedSmash
            && rig.detailed
            && !recordedVolley
            && Boolean(rig.root.userData.capturedVolleys)
            && strokeEvent.shotType === 'rally'
            // (A stretch for a ball going past him is a full reach, not a slice.)
            && !capturedEvent.attempt
          ) {
            const spinSlice = liveCourtShotSpin(samples, strokeEvent.frame, frameRate) === 'slice';
            if (recordedTouch || spinSlice) capturedEvent.slice = true;
            if (spinSlice) capturedEvent.spinSlice = true;
          }
        }
        rig.root.userData.capturedGroundstrokeEvent = capturedEvent;
        if (contactSample) {
          // Recorded ball position at the hit, relative to this player's
          // recorded position at that frame, in the rig's local space. The
          // detailed player bends its captured swing to meet it.
          const dx = (contactSample[0] - contactSample[xIndex]) * SCALE;
          const dz = (contactSample[1] - contactSample[zIndex]) * SCALE;
          rig.root.userData.contactTarget = {
            key: `${strokeEvent.frame}:${capturedEvent.stroke}:${capturedEvent.handedness}:${capturedEvent.smash ? 'smash' : ''}${capturedEvent.attempt ? ':stretch' : ''}`,
            // A stretch: he reaches out toward a ball beyond his normal reach
            // (a ball going past him, or a wide volley: the volley recording's
            // contact is close in front, so a volley more than a metre to the
            // side would otherwise miss it by about that much).
            ...(capturedEvent.attempt
              || (isRecordedVolley(capturedEvent.stroke) && Math.hypot(dx, dz) > WIDE_VOLLEY_METRES)
              ? { stretch: true } : {}),
            point: [
              (dx * localXAxis[0] + dz * localXAxis[1]) / rig.root.scale.x,
              (Math.max(0, contactSample[2] * SCALE) + BALL_RADIUS) / rig.root.scale.y,
              (dx * Math.sin(facing) + dz * Math.cos(facing)) / rig.root.scale.x,
            ],
          };
        }
      }
      if (!capturedEvent) delete rig.root.userData.contactTarget;
      if (capturedEvent) {
        const captureDelta = (frame - capturedEvent.frame) * frameScale;
        const volley = isRecordedVolley(capturedEvent.stroke);
        const nativeTiming = bundledCaptureTiming(bundledSource, capturedEvent);
        const recoveryFrames = nativeTiming?.recoveryFrames ?? (volley
          ? VOLLEY_RECOVERY_FRAMES * frameRate / 60 * frameScale
          : CAPTURE_RECOVERY_FRAMES);
        if (captureDelta < -Math.max(SERVE_LEAD_FRAMES, nativeTiming?.leadFrames ?? 0)
          || captureDelta > recoveryFrames) {
          delete rig.root.userData.capturedGroundstrokeEvent;
          delete rig.root.userData.groundstrokePlayback;
          rig.root.userData.lowReachDrop = 0;
          delete rig.root.userData.lunge;
        } else {
          // Fade the next stroke in after the previous one has handed back,
          // rather than starting part-way up its envelope (a snap). A shot
          // about to be played still gets its full recorded swing.
          const previousOwnShot = lastShotFrame(events, eventPlayer, capturedEvent.frame - 1);
          // The opponent's contact before this shot: the take-back waits until
          // the player has had time to read the ball.
          const opponentContact = lastShotFrame(
            events, eventPlayer === 1 ? 2 : 1, capturedEvent.frame - 1,
          );
          const opponentContactGap = opponentContact === undefined
            ? undefined
            : (capturedEvent.frame - opponentContact) * frameScale;
          const returningServe = opponentContact !== undefined
            && events.some(e => e.kind === 'shot' && e.frame === opponentContact && e.shotType === 'serve');
          const handOver = previousOwnShot === undefined ? 1 : Math.max(
            THREE.MathUtils.smoothstep(
              (frame - previousOwnShot) * frameScale,
              CAPTURE_RECOVERY_FRAMES,
              CAPTURE_RECOVERY_FRAMES + 24,
            ),
            THREE.MathUtils.smoothstep(captureDelta, -24, -8),
          );
          const weight = handOver * (capturedEvent.stroke === 'serve'
            ? serveCaptureWeight(captureDelta, nativeTiming) * (captureDelta >= 0 ? 1 : Number(rig.root.userData.serveSetUp ?? 1))
            : volley ? volleyCaptureWeight(captureDelta, nativeTiming)
              : groundstrokeCaptureWeight(captureDelta, groundstrokeLeadFrames(opponentContactGap), nativeTiming));
          // (An attempt at a ball going past him is mainly a stretch, the arm
          // and upper body reaching out; the legs only lunge for the furthest,
          // and not as deep.)
          const reachToBall = contactSample ? Math.hypot(
            (contactSample[0] - contactSample[xIndex]) * SCALE,
            (contactSample[1] - contactSample[zIndex]) * SCALE,
          ) : 0;
          const contactLunge = capturedEvent.stroke !== 'serve' && !volley
            && !capturedEvent.smash && contactSample
            ? lungeWeight(reachToBall, Boolean(capturedEvent.spinSlice))
              * (capturedEvent.attempt ? ATTEMPT_LUNGE_SHARE : 1)
            : 0;
          const lungeTiming = THREE.MathUtils.smoothstep(captureDelta, -16, -2)
            * (1 - THREE.MathUtils.smoothstep(captureDelta, 24, 44));
          const lowOnly = capturedEvent.stroke !== 'serve' && !capturedEvent.smash && contactSample
            ? lowReachDrop(Math.max(0, contactSample[2] * SCALE), 0)
            : 0;
          rig.root.userData.lowReachDrop = Math.min(
            LOW_REACH_MAX_DROP,
            lowOnly * weight + LUNGE_DROP * contactLunge * lungeTiming * Math.min(1, weight * 2),
          );
          rig.root.userData.lowReachFull = capturedEvent.smash
            ? 0
            : lowReachDrop(ballY, Math.hypot(localX, localZ));
          const contactPoint = rig.root.userData.contactTarget?.point as [number, number, number] | undefined;
          rig.root.userData.lunge = contactLunge > 0 && contactPoint
            ? { weight: contactLunge * lungeTiming, side: Math.sign(contactPoint[0]) || 1 }
            : undefined;
          if (weight > 0) {
            rig.root.userData.groundstrokePlayback = {
              stroke: capturedEvent.stroke,
              deltaSeconds: captureDelta / 60,
              weight,
              handedness: capturedEvent.handedness,
              rootOffset: false,
              hands: !capturedEvent.smash && !capturedEvent.slice && !capturedEvent.oneHandReach
                && recordedStrokeUsesTwoHands(capturedEvent.stroke, playerStrokeStyle, false) ? 'two' : 'one',
              ...(capturedEvent.smash ? { smash: true } : {}),
              ...(capturedEvent.slice ? { slice: true } : {}),
              // (A slice return does fit its whole preparation in: without it
              // only the last ~0.3 s of the slice showed, and it read as a
              // push or a drive. Rally slices keep their slow preparation.)
              ...(shouldCompressGroundstrokeTakeBack(capturedEvent.stroke, capturedEvent.slice && !returningServe)
                ? { leadScale: (nativeTiming?.leadFrames ?? GROUNDSTROKE_LEAD_FRAMES)
                  / groundstrokeLeadFrames(opponentContactGap) }
                : {}),
            };
          } else {
            delete rig.root.userData.groundstrokePlayback;
          }
        }
      } else {
        delete rig.root.userData.groundstrokePlayback;
        rig.root.userData.lowReachDrop = 0;
        delete rig.root.userData.lunge;
      }
        const twoHandedStroke = !serving && !capturedEvent?.smash && !isRecordedVolley(capturedEvent?.stroke)
          && !capturedEvent?.slice && !capturedEvent?.oneHandReach
        && recordedStrokeUsesTwoHands(stroke, playerStrokeStyle, stroke === 'backhand');
      const armPump = Math.sin(phase * 0.55) * gaitSpeed * 0.12;
      // Between shots the racket is carried, not held up by the head: in front
      // at the waist with the free hand on the throat when standing, in the
      // dominant hand alongside when running or walking.
      const strokeActivity = THREE.MathUtils.clamp(1.5 * Math.max(
        shapedBackswing, strikeWeight, shapedFollowThrough, servePreparation, serveToss, serveFollowThrough,
      ), 0, 1);
      const carry = 1 - strokeActivity;
      // Carry style. Players keep the racket in front, free hand on the throat,
      // while they recover and shuffle; it moves to the side (free arm swinging)
      // only when walking between points or on a sustained sprint with no shot
      // of their own due within a second. Recorded speed is noisy (whole-cm
      // samples every other frame), so speed and style are smoothed over replay
      // time instead of following each sample: following them made the racket
      // flick between the two carries from one frame to the next.
      const carrySpeed = smoothSpeed;
      const ownNextShot = nextShotEvent(events, eventPlayer, frame);
      // (A serve coming up is handled by the serve set-up, which waits until he
      // is at the line; it must not take the relaxed walking carry away early.)
      // TE4 records the walk back to the line at the start of the next point;
      // that is walking too, so it gets the same relaxed carry as our own walks.
      // (Not once he has set up to serve or return: shuffling there is not a walk.)
      // Also relax when the last shot has gone unanswered or a point-end is
      // delayed in the feed; the split-step and serve/return setup still win.
      const rallyOver = rallyOverWeight(events, frame, frameRate, shot => {
        const receiverIndex = shot.player === 1 ? 5 : shot.player === 2 ? 3 : undefined;
        return receiverIndex === undefined
          ? undefined
          : ballPassedReceiverFrame(samples, shot.frame, frame, receiverIndex);
      });
      const strolling = Math.max(isBetweenPoints(events, frame) ? 1 : 0, rallyOver)
        * (1 - Math.max(serveGate, returnGate));
      // The racket comes up in front for the split-step around the opponent's
      // contact and for his own shot. Recovery runs carry it at the side.
      const opponent = eventPlayer === 1 ? 2 : 1;
      const opponentNext = nextShotEvent(events, opponent, frame);
      const opponentLast = lastShotFrame(events, opponent, frame);
      const splitWindow = (opponentNext !== undefined && (opponentNext.frame - frame) / frameRate < 0.3)
        || (opponentLast !== undefined && (frame - opponentLast) / frameRate < 0.2);
      const ownShotNear = ownNextShot !== undefined && ownNextShot.shotType !== 'serve'
        && (ownNextShot.frame - frame) / frameRate < 0.4;
      const carryIntent = walking ? 1 : ownShotNear || (splitWindow && rallyOver < 0.5) ? 0
        : Math.max(strolling, THREE.MathUtils.smoothstep(carrySpeed, 1.0, 1.6));
      const carryMode = nextLiveCourtCarryMode(Boolean(rig.root.userData.carryMode), {
        walking,
        shotDue: ownShotNear || (splitWindow && rallyOver < 0.5),
        strolling,
        speed: carrySpeed,
        carryIntent,
      });
      // Change carries in a quick, eased 0.3 s so speed noise cannot flick the
      // racket or leave the arms hovering between poses.
      rig.root.userData.carryMode = carryMode;
      const previousRamp = Number(rig.root.userData.carryRamp ?? (carryMode ? 1 : 0));
      const carryRamp = replaySeconds > 0.5 ? (carryMode ? 1 : 0)
        : THREE.MathUtils.clamp(previousRamp + (carryMode ? 1 : -1) * replaySeconds / 0.3, 0, 1);
      rig.root.userData.carryRamp = carryRamp;
      const onTheMove = carryRamp * carryRamp * (3 - 2 * carryRamp);
      rig.root.userData.carryMove = onTheMove;
      // Ready carry: grip hand just to the racket side of the navel, racket
      // pointing at the opponent with the head a little up, so the free hand
      // reaches forward to the throat instead of across behind the strings.
      const standingCarryHand = new THREE.Vector3(dominantX * 0.22, 1.0, 0.32);
      // Walking: arms hang nearly straight, hands beside the thighs; running:
      // elbows bent, hands higher. (The running carry used for a walk put the
      // hands on the hips with the elbows flared out.)
      // (From a jog: a jog with the straight walking arms flared the elbows.)
      const runFactor = THREE.MathUtils.smoothstep(smoothSpeed, 1.6, 3.0);
      // (Running: racket hand in front of the hip, close in, elbow bent and
      // back. It sat out wide at hip height, which flared the elbow out like a
      // hand on the hip.)
      // (Walking: hand low beside the thigh so the arm hangs nearly straight; at
      // 0.86 the elbow bent ~80 degrees and the hand sat on the hip.)
      const movingCarryHand = new THREE.Vector3(dominantX * 0.64, 0.74 + bodyBounce, 0.1)
        .lerp(new THREE.Vector3(dominantX * 0.5, 0.98 + bodyBounce, 0.24), runFactor);
      const dominantHand = new THREE.Vector3(dominantX, 1.12 + bodyBounce + armPump, 0.06)
        .lerp(standingCarryHand.lerp(movingCarryHand, onTheMove), carry);
      const nonDominantHand = new THREE.Vector3(-dominantX * 0.72, 0.96 + bodyBounce - armPump, 0.1);
      {
        // Running arm action: elbow bent, the free hand swings from chest height
        // in front to just behind the hip, against its same-side leg, and is
        // kept clear of the torso instead of brushing the hip.
        // A smooth arc in time with the same-side leg (the foot's own cycle has a
        // corner at lift-off, which would jolt the hand every step).
        const sameSidePhase = gait.phase + (dominantX < 0 ? 0.5 : 0);
        const strideReach = Math.min(1, Math.hypot(stepA.x, stepA.z, stepB.x, stepB.z) / 0.3 + 0.35);
        const swing = -Math.cos(2 * Math.PI * sameSidePhase) * Math.sign(gait.direction[1] || 1) * strideReach;
        // Running: a runner's arm, elbow bent and close to the body, the hand
        // swinging from in front of the stomach to just behind the hip (wider
        // only as it passes the hip). It was held out wide at hip height,
        // elbows flared: hands on hips.
        // (Walking: arm hanging, swinging from the shoulder; held higher, the
        // elbow folded up to ~70 degrees on the back swing, hand on the hip.)
        const runningHand = new THREE.Vector3(
          -dominantX * 0.64,
          0.76 + bodyBounce + Math.abs(swing) * 0.04,
          0.03 + swing * 0.16,
        ).lerp(new THREE.Vector3(
          -dominantX * (0.5 + 0.06 * Math.max(0, -swing)),
          0.96 + bodyBounce + Math.max(0, swing) * 0.14 - Math.max(0, -swing) * 0.16,
          0.06 + swing * 0.22,
        ), runFactor);
        nonDominantHand.lerp(runningHand, gait.amount);
      }
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
      if (ready > 0) {
        // Ready to return: hands in front of the stomach, racket pointing at
        // the server with the head up.
        dominantHand.lerp(new THREE.Vector3(dominantX * 0.2, 0.88 + bodyBounce, 0.4), ready);
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
      if (handedness === 'left') {
        resting.set(resting.x, -resting.y, -resting.z, resting.w);
      }
      const backswingRotation = resting.clone().multiply(
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -strokeSide * 0.9)),
      );
      const serveLoadRotation = resting.clone().multiply(
        new THREE.Quaternion().setFromEuler(new THREE.Euler(-strokeSide * 0.72, 0, -strokeSide * 0.78)),
      );
      // Resolve the string-bed roll from the outgoing flight at the shot,
      // rather than pointing only the shaft at the ball and leaving its face
      // in an arbitrary upright orientation. Use observed movement when the
      // live buffer does not yet include the post-contact samples.
      const flightStart = event
        ? interpolateLiveCourtFrame(samples, Math.min(lastFrame, event.frame + 1), maxGapFrames) ?? prior
        : prior;
      const flightEnd = event
        ? interpolateLiveCourtFrame(samples, Math.min(lastFrame, event.frame + 4), maxGapFrames) ?? later
        : later;
      const flight = new THREE.Vector3(
        flightEnd[0] - flightStart[0],
        flightEnd[2] - flightStart[2],
        flightEnd[1] - flightStart[1],
      ).applyAxisAngle(new THREE.Vector3(0, 1, 0), -facing);
      // Both sides of the string bed are equivalent; keep a stable facing
      // sign so a transition from incoming to outgoing flight cannot flip it.
      if (flight.z < 0) flight.negate();
      const contactRotation = racketContactOrientation(new THREE.Vector3(...contact.axis), flight);
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
      // Neutral: the racket points straight at the opponent, head a little up.
      // (Angled across toward the backhand side it read as about to hit one.)
      const standingShaft = new THREE.Vector3(-Math.sign(dominantX) * 0.04, 0.32, 0.95).normalize();
      const movingShaft = new THREE.Vector3(-Math.sign(dominantX) * 0.1, -0.2 - 0.15 * (1 - runFactor), 0.97).normalize();
      const carryRotation = racketCarryOrientation(standingShaft, handedness)
        .slerp(racketCarryOrientation(movingShaft, handedness), onTheMove);
      // Last frame's racket as the viewer saw it (the detailed player sets it).
      const visibleRacket = rig.racket.quaternion.clone();
      rig.racket.quaternion.copy(resting).slerp(carryRotation, carry);
      if (serving && servePreparation > 0) rig.racket.quaternion.slerp(serveLoadRotation, servePreparation);
      if (shapedBackswing > 0) rig.racket.quaternion.slerp(backswingRotation, shapedBackswing);
      if (impactWeight > 0) rig.racket.quaternion.slerp(contactRotation, impactWeight);
      if (shapedFollowThrough > 0) rig.racket.quaternion.slerp(followRotation, shapedFollowThrough);
      if (serveFollowThrough > 0) rig.racket.quaternion.slerp(serveFollowRotation, serveFollowThrough);
      if (ready > 0) {
        // Head forward and up, straight at the server; face upright.
        const readyShaft = new THREE.Vector3(-Math.sign(dominantX) * 0.06, 0.42, 0.9).normalize();
        const readyRotation = racketCarryOrientation(readyShaft, handedness);
        rig.racket.quaternion.slerp(readyRotation, ready);
      }
      // Preserve the original unarticulated hand surface; do not sculpt
      // fingertips or force a wrist roll to simulate missing finger joints.
      rig.root.userData.dominantHandedness = handedness;
      {
        // While a recorded stroke hands back, start the procedural racket from
        // where the viewer last saw it and let it travel to the carry as the
        // recording fades. Blending a recorded racket into a procedural one
        // pointing nearly the opposite way could spin it round in one frame.
        const playback = rig.root.userData.groundstrokePlayback as { weight: number; deltaSeconds: number } | undefined;
        if (playback && playback.deltaSeconds > 0 && rig.detailed) {
          rig.racket.quaternion.copy(visibleRacket.slerp(rig.racket.quaternion, THREE.MathUtils.clamp(1 - playback.weight, 0, 1)));
        }
      }
      dominantMesh.quaternion.copy(rig.racket.quaternion);
      const wrist = racketGripWrist(rig.racket.position, rig.racket.quaternion, handedness === 'left');
      dominantElbow.copy(racketGripElbow(dominantShoulder, wrist, rig.racket.quaternion, handedness === 'left'));
      poseLimb(dominantUpperArm, dominantShoulder, dominantElbow);
      dominantElbowMesh.position.copy(dominantElbow);
      poseLimb(dominantForearm, dominantElbow, wrist);
      const strokeGrip = twoHandedStroke && (impactWeight > 0 || shapedBackswing > 0 || shapedFollowThrough > 0);
      rig.root.userData.twoHandedGrip = strokeGrip;
      // Free hand: on the throat in the return stance and when standing between
      // shots; lets go (and swings) when running or walking; slides down onto
      // the handle for a two-handed stroke. Every change is a blend, never a snap.
      // The stroke being played back (if any) decides the grip style through
      // its recovery, rather than the ball's current side after the event passes.
      const recordedStroke = rig.root.userData.capturedGroundstrokeEvent as
        { frame: number; stroke: GroundstrokeName; slice?: boolean; smash?: boolean; oneHandReach?: boolean } | undefined;
      const nativeRecovery = recordedStroke ? bundledCaptureTiming(bundledSource, recordedStroke) : undefined;
      const twoHandedSide = Boolean(recordedStroke)
        && recordedStroke!.stroke !== 'serve'
        && recordedStroke!.stroke !== 'smash'
        && !recordedStroke!.smash
        && !isRecordedVolley(recordedStroke!.stroke)
        && recordedStrokeUsesTwoHands(recordedStroke!.stroke, playerStrokeStyle, false);
      const recordedTwoHanded = recordedStroke
        ? twoHandedSide && !recordedStroke.slice && !recordedStroke.smash && !recordedStroke.oneHandReach
        : twoHandedStroke;
      const sliceTakeBackHold = recordedStroke?.slice && twoHandedSide && frame <= recordedStroke.frame
        ? 1 - THREE.MathUtils.smoothstep(
          (frame - recordedStroke.frame) * frameScale,
          -14,
          -6,
        )
        : 0;
      // Two-handed players keep both hands on through the recovery.
      const recovery = recordedStroke && frame > recordedStroke.frame
        ? 1 - THREE.MathUtils.smoothstep(
          (frame - recordedStroke.frame) * frameScale,
          nativeRecovery?.recoveryFadeStart ?? RECOVERY_FADE_START,
          nativeRecovery?.recoveryFrames ?? CAPTURE_RECOVERY_FRAMES,
        )
        : 0;
      rig.root.userData.twoHandedStyle = recordedTwoHanded;
      const twoHandedWeight = recordedTwoHanded
        ? THREE.MathUtils.clamp(Math.max(strikeWeight, shapedBackswing, shapedFollowThrough, recovery) * 1.6, 0, 1)
        : 0;
      rig.root.userData.supportHoldWeight = Math.max(
        twoHandedWeight,
        sliceTakeBackHold,
        ready,
        carry * (1 - onTheMove),
      );
      rig.root.userData.sliceTakeBackHold = sliceTakeBackHold;
      rig.root.userData.relaxedCarry = carry * onTheMove;
      // Walking, jogging and running with the racket at the side: recorded
      // arms follow the step phase (0 = the right foot landing in front).
      rig.root.userData.locomotionArms = carry * onTheMove * THREE.MathUtils.clamp(gait.amount, 0, 1);
      rig.root.userData.locomotionPhase = gait.phase;
      rig.root.userData.locomotionArmsSpeed = smoothSpeed;
      // Standing, waiting and return stance use the tennis player's recorded
      // ready position; the ready clip is sampled slowly forwards and back.
      rig.root.userData.readyArms = Math.max(carry * (1 - onTheMove), ready);
      rig.root.userData.readyTime = frame / frameRate;
      rig.root.userData.returnCrouch = ready;
      const supportGrip = Math.max(twoHandedWeight, sliceTakeBackHold);
      rig.root.userData.supportStrokeWeight = supportGrip;
      rig.root.userData.supportGripOffset = THREE.MathUtils.lerp(0.2, 0.11, supportGrip);
      // Server's feet must stay behind the baseline until contact; landing
      // inside the court afterwards is legal and eases in. The guard also
      // eases in as the serve comes up: switched on at full strength it moved
      // a server still walking up to the line back by up to ~0.6 m in a frame.
      rig.root.userData.baselineGuard = serving
        ? {
          weight: Math.max(serveGate, THREE.MathUtils.smoothstep(strokeDelta, -12, -4))
            * THREE.MathUtils.smoothstep(strokeDelta, -64, -40) * (1 - THREE.MathUtils.smoothstep(strokeDelta, 2, 14)),
          baseline: COURT_LENGTH / 2,
        }
        : undefined;
      if (rig.root.userData.twoHandedGrip) {
        const supportWrist = racketGripWrist(nonDominantHand, rig.racket.quaternion, handedness !== 'left');
        nonDominantElbow.copy(racketGripElbow(nonDominantShoulder, supportWrist, rig.racket.quaternion, handedness !== 'left'));
        poseLimb(nonDominantUpperArm, nonDominantShoulder, nonDominantElbow);
        nonDominantElbowMesh.position.copy(nonDominantElbow);
        poseLimb(nonDominantForearm, nonDominantElbow, supportWrist);
      }
      rig.detailed?.update();
    };

    const animate = (now: number) => {
      if (graphicsFailed) return;
      animation = window.requestAnimationFrame(animate);
      const clockElapsed = Math.max(0, now - lastTime);
      renderFrameObserverRef.current(clockElapsed);
      const elapsed = Math.min(80, clockElapsed);
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
              clockElapsed,
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
          // Never closer than one DMO update to the newest data (bounce/Out
          // calls need the next sample), and normally LIVE_CUSHION_SECONDS
          // behind it, so a ball going past a player is known in time for him
          // to stretch for it. Both are measured from the newest frame, so
          // they don't add up.
          currentFrame = advanceLiveCourtPlayhead(
            playheadRef.current,
            clockElapsed,
            sceneDataRef.current.playbackSpeed,
            samples,
            frameRate,
            LIVE_DMO_EVENT_SYNC_BUFFER_FRAMES,
            LIVE_CUSHION_SECONDS * frameRate * sceneDataRef.current.playbackSpeed,
          ) ?? firstFrame;
          if (now - courtDelayReportedAtRef.current >= 1000) {
            courtDelayReportedAtRef.current = now;
            // Behind the newest data, plus that data's average age on arrival
            // (it comes in every LIVE_DMO_UPDATE_INTERVAL_MS).
            const behind = (lastFrame - currentFrame) / (frameRate * Math.max(1, sceneDataRef.current.playbackSpeed))
              + LIVE_DMO_UPDATE_INTERVAL_MS / 2000;
            const seconds = Math.round(behind);
            setCourtDelay(previous => (previous === seconds ? previous : seconds));
          }
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
              // Footsteps come from the rendered foot plants below, not inferred event timers.
              if (cue.kind === 'footstep') continue;
              if (crossedFrame(cue.frame, previous, currentFrame)) {
                playCue(context, cue.kind, sceneDataRef.current.surface,
                  effectsVolumeRef.current, courtEffectSamplesRef.current);
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
              if (audioCue === 'grunt'
                && gruntAudioRef.current?.isWta === isWta
                && gruntAudioRef.current.characterKey === playerGruntKey) {
                const playerSamples = cue.player === 1
                  ? gruntAudioRef.current.samples[0]
                  : cue.player === 2
                    ? gruntAudioRef.current.samples[1]
                    : [...gruntAudioRef.current.samples[0], ...gruntAudioRef.current.samples[1]];
                const sample = playerSamples[Math.floor(Math.random() * playerSamples.length)];
                if (sample) playSample(context, sample, 0.72, activeGruntsRef.current, 0.92 + Math.random() * 0.12);
              } else if (audioCue === 'cheer' && cue.frame % 3 === 0 && applauseAudioRef.current) {
                playSample(context, applauseAudioRef.current,
                  crowdGainRef.current ? 1 : crowdVolumeRef.current,
                  activeApplauseRef.current, 1, crowdGainRef.current ?? undefined);
              }
            }
          }
        }
        lastSoundFrameRef.current = currentFrame;
        const umpireFrame = fullReplay
          ? currentFrame
          : clampLiveCourtPlayheadToTail(
            currentFrame,
            samples,
            LIVE_DMO_EVENT_SYNC_BUFFER_FRAMES,
          ) ?? currentFrame;
        const previousCallFrame = lastUmpireCallFrameRef.current;
        if (umpireFrame < previousCallFrame) {
          cancelUmpireCall(
            audioContextRef.current,
            liveUmpireMatchKey(sceneDataRef.current.snapshot.players, sceneDataRef.current.isWta),
          );
        }
        const callsEnabled = umpireCallsEnabledRef.current && umpireSpeechReadyRef.current;
        const dueCalls = fullReplay
          ? callsEnabled && umpireFrame >= previousCallFrame && umpireFrame - previousCallFrame < 120
            ? umpireCallsBetween(umpireCallEventsRef.current, previousCallFrame, umpireFrame) : []
          : consumeLiveUmpireCallEvents(
            liveUmpireEventCursorRef.current, umpireCallEventsRef.current,
            previousCallFrame, umpireFrame, callsEnabled,
          );
        {
          for (const call of dueCalls) {
            if (!fullReplay && (call.kind === 'score' || call.kind === 'point-end')) {
              const liveScoreCall = matchLiveUmpireScoreToDmoPointEnd(
                liveUmpireScoreTetherRef.current,
                liveScoreboardRef.current
                  && umpireCallsEnabledRef.current
                  && umpireSpeechReadyRef.current,
              );
              if (liveScoreCall) {
                void speakUmpireCall(
                  liveScoreCall,
                  audioContextRef.current,
                  isWta,
                  () => umpireCallsEnabledRef.current && umpireSpeechReadyRef.current,
                  liveUmpireMatchKey(snapshot.players, isWta),
                );
              }
              continue;
            }
            if (call.kind === 'point-end') continue;
            void speakUmpireCall(
              call.text,
              audioContextRef.current,
              isWta,
              () => umpireCallsEnabledRef.current && umpireSpeechReadyRef.current,
              liveUmpireMatchKey(snapshot.players, isWta),
            );
          }
        }
        lastUmpireCallFrameRef.current = umpireFrame;
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
        // Pre-serve: the recording holds the ball still, low by the hip (TE4's
        // hand), until the toss. From the first bounce it is drawn in the
        // server's free hand instead: bounced from hand height, then held,
        // easing back onto the recorded flight once the toss starts.
        let serveBallShown = false;
        {
          let pinned = false;
          const nextServe = trajectoryEventsRef.current.find(e => e.kind === 'shot' && e.shotType === 'serve' && e.frame >= currentFrame);
          if (nextServe) {
            const secondsToContact = (nextServe.frame - currentFrame) / frameRate;
            const held = liveCourtBallHeldSeconds(samples, currentFrame, frameRate);
            const bounce = serveBounceHeight(secondsToContact, secondsToContact + held);
            const start = SERVE_BOUNCE_END_SECONDS + SERVE_BOUNCES * SERVE_BOUNCE_SECONDS;
            const inHand = secondsToContact <= start && secondsToContact + held >= start - 1e-3;
            const server = nextServe.player === 1
              ? players[0]
              : nextServe.player === 2 ? players[1] : undefined;
            const serverHandedness = nextServe.player === 1
              ? sceneDataRef.current.snapshot.handedness?.[0]
              : nextServe.player === 2 ? sceneDataRef.current.snapshot.handedness?.[1] : undefined;
            const freeSide = (serverHandedness ?? 'right') === 'left' ? 'r' : 'l';
            const handBone = server?.root.getObjectByName(`hand_${freeSide}`);
            if (server && handBone && (bounce !== null || inHand)) {
              // (The free hand as drawn last frame; ball centre just under the palm.)
              const hand = handBone.getWorldPosition(new THREE.Vector3());
              const top = Number(server.root.userData.serveBounceTop ?? ballPosition.y);
              const target = new THREE.Vector3(
                hand.x,
                bounce !== null ? Math.max(ballPosition.y, top) * bounce : hand.y - 0.05 - BALL_RADIUS,
                hand.z,
              );
              serveBall.frame = currentFrame;
              serveBall.hand = handBone;
              ballPosition.copy(target);
              pinned = true;
              serveBallShown = true;
            }
          }
          const easeFrames = 0.3 * frameRate;
          if (!pinned && serveBall.hand && currentFrame >= serveBall.frame && currentFrame - serveBall.frame < easeFrames) {
            // Released: from the tossing hand onto the recorded flight (TE4
            // jumps the ball from its hip hold to the toss).
            const k = 1 - THREE.MathUtils.smoothstep((currentFrame - serveBall.frame) / easeFrames, 0, 1);
            const hand = serveBall.hand.getWorldPosition(new THREE.Vector3());
            ballPosition.lerp(hand.setY(hand.y - 0.05 - BALL_RADIUS), k);
            ballPosition.y = Math.max(0, ballPosition.y);
            serveBallShown = true;
          }
        }
        if (previousNetBallFrame !== null) {
          const frameGap = currentFrame - previousNetBallFrame;
          if (frameGap < 0 || frameGap > frameRate * 0.25) {
            olderNetBallPosition = null;
            previousNetBallPosition = null;
            previousNetBallFrame = null;
            lastNetImpactFrame = Number.NEGATIVE_INFINITY;
            courtEffects.net.clear();
          }
        }
        if (previousNetBallPosition && currentFrame > (previousNetBallFrame ?? currentFrame)) {
          const netImpact = detectCourtNetImpact(
            olderNetBallPosition,
            previousNetBallPosition,
            ballPosition,
          );
          if (netImpact && currentFrame - lastNetImpactFrame > 4) {
            courtEffects.net.impact(
              netImpact.z,
              netImpact.strength,
              netImpact.direction,
              now / 1000,
            );
            lastNetImpactFrame = currentFrame;
          }
        }
        if (previousNetBallFrame === null || currentFrame > previousNetBallFrame) {
          olderNetBallPosition = previousNetBallPosition;
          previousNetBallPosition = ballPosition.clone();
          previousNetBallFrame = currentFrame;
        }
        courtEffects.net.update(now / 1000);
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
        updatePlayer(players[0], values[3], values[4], 0, values, currentFrame, samples, lastFrame, firstFrame, motionEventsRef.current, strikingPlayer === 0, elapsed, sceneDataRef.current.snapshot.handedness?.[0] ?? 'right');
        updatePlayer(players[1], values[5], values[6], 1, values, currentFrame, samples, lastFrame, firstFrame, motionEventsRef.current, strikingPlayer === 1, elapsed, sceneDataRef.current.snapshot.handedness?.[1] ?? 'right');
        if (soundOnRef.current && context?.state === 'running') {
          for (const player of players) {
            if (player.root.userData.footstepContact) {
              playCue(context, 'footstep', sceneDataRef.current.surface,
                effectsVolumeRef.current, courtEffectSamplesRef.current);
            }
          }
        }
        const gazeTarget = trailAllowed(trajectoryEventsRef.current, currentFrame) ? ball.position : undefined;
        crowdRig.update(now / 1000, now < crowdApplauseUntil, gazeTarget, camera);
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
              .addScaledVector(forward, 1.6)
              .addScaledVector(side, 3.0);
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
        ball.visible = (showTrail || tossing || serveBallShown || !knownPhase) && performance.now() >= changeoverUntil;
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
      selectedCameraViewRef.current = view;
      if (view.startsWith('player-')) {
        playerCameraPanRef.current = 0;
        setPlayerCameraPan(0);
      }
      controls.target.set(0, 0.5, 0);
      const viewportBounds = viewportRef.current?.getBoundingClientRect();
      const viewportWidth = viewportBounds?.width ?? window.innerWidth;
      const viewportHeight = viewportBounds?.height ?? window.innerHeight;
      const compactViewport = viewportWidth <= 720;
      const sceneElement = sceneElementRef.current;
      const fullscreenElement = document.fullscreenElement
        ?? (document as Document & { webkitFullscreenElement?: Element | null }).webkitFullscreenElement
        ?? null;
      const nativeFullscreen = fullscreenElement === sceneElement;
      const fullscreenActive = nativeFullscreen
        || Boolean(sceneElement?.classList.contains(styles.fullscreenFallback));
      const fullscreenCourtCamera = view === 'court'
        ? dmoFullscreenCourtCamera(
          viewportWidth, viewportHeight, fullscreenActive,
          maxDistanceForTarget(new THREE.Vector3(0, 0.5, 0)),
        )
        : null;
      const tvBroadcastCamera = view === 'tv'
        ? dmoTvBroadcastCamera(
          viewportWidth, viewportHeight, maxDistanceForTarget(new THREE.Vector3(0, 0.5, 0)),
        )
        : null;
      const narrowScale = responsiveDmoCourtCameraScale(viewportWidth, viewportHeight, fullscreenActive);
      camera.fov = view === 'aerial'
        ? 50
        : tvBroadcastCamera?.fov ?? fullscreenCourtCamera?.fov ?? (compactViewport ? 38 : 34);
      camera.updateProjectionMatrix();
      if (view === 'aerial') camera.position.set(0, Math.min(32, cameraMaxDistance * 0.98), 0.1);
      else if (view === 'tv') {
        if (tvBroadcastCamera) {
          camera.position.set(tvBroadcastCamera.x, tvBroadcastCamera.y, tvBroadcastCamera.z);
        } else {
          camera.position.set(35, 11, 0);
        }
      }
      else if (view === 'court') {
        if (fullscreenCourtCamera) {
          camera.position.set(
            fullscreenCourtCamera.x,
            fullscreenCourtCamera.y,
            fullscreenCourtCamera.z,
          );
        } else {
          camera.position.copy(DEFAULT_CAMERA).multiplyScalar(narrowScale);
        }
      }
      else {
        const playerIndex = view.startsWith('player-two') ? 1 : 0;
        const player = players[playerIndex];
        const forward = new THREE.Vector3(
          Math.sin(player.root.rotation.y),
          0,
          Math.cos(player.root.rotation.y),
        );
        const side = new THREE.Vector3(forward.z, 0, -forward.x);
        if (view.endsWith('-first')) {
          camera.position.copy(player.root.position).add(new THREE.Vector3(0, 1.55, 0));
          controls.target.copy(camera.position).addScaledVector(forward, 16);
        } else {
          camera.position.copy(player.root.position)
            .add(new THREE.Vector3(0, 3.0, 0))
            .addScaledVector(forward, 1.6)
            .addScaledVector(side, 3.0);
          controls.target.copy(player.root.position)
            .add(new THREE.Vector3(0, 1.0, 0))
            .addScaledVector(forward, 1.5);
        }
      }
      cameraTargetAnchor.copy(controls.target);
      preferredCameraMinDistance = view.startsWith('player-')
        ? view.endsWith('-first') ? 0.5 : 2
        : 14;
      controls.maxDistance = maxDistanceForTarget(cameraTargetAnchor);
      controls.minDistance = Math.min(preferredCameraMinDistance, controls.maxDistance);
      controls.update();
      setCameraView(view);
    };
    const zoom = (factor: number) => {
      const direction = new THREE.Vector3().subVectors(camera.position, controls.target).multiplyScalar(factor);
      camera.position.copy(controls.target).add(direction);
      controls.update();
    };
    const reset = () => preset(initialCameraView);
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
      if (crowdRigRef.current === crowdRig) crowdRigRef.current = null;
      if (broadcastLightingRef.current === broadcastLighting) broadcastLightingRef.current = null;
      modelLoad.abort();
      window.cancelAnimationFrame(animation);
      observer.disconnect();
      window.removeEventListener('resize', resize);
      window.removeEventListener('orientationchange', resize);
      document.removeEventListener('fullscreenchange', resize);
      document.removeEventListener('webkitfullscreenchange', resize);
      document.removeEventListener('courtfullscreenchange', resize);
      if (rendererResizeRef.current === resize) rendererResizeRef.current = null;
      stopObservingManualCamera();
      controls.dispose();
      viewport.removeEventListener('courtzoom', onZoom);
      viewport.removeEventListener('courtreset', reset);
      viewport.removeEventListener('courtpreset', onPreset);
      viewport.removeEventListener('courtplayerpan', onPlayerPan);
      renderer.dispose();
      renderer.domElement.remove();
      if (canvasElementRef.current === renderer.domElement) canvasElementRef.current = null;
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      const textures = new Set<THREE.Texture>();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
          geometries.add(object.geometry);
          const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
          objectMaterials.forEach((item) => {
            materials.add(item);
            Object.values(item).forEach((value) => { if (value instanceof THREE.Texture) textures.add(value); });
          });
          if (object instanceof THREE.SkinnedMesh) object.skeleton.dispose();
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
  }, [
    fullReplay,
    isWta,
    modelAssetBase,
    playerBundledMotions,
    playerOutfitSeed,
    onUnsupported,
    playerCharacterKey,
    snapshot.filename,
    snapshot.players[0],
    snapshot.players[1],
    snapshot.stadium,
  ]);

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

  const activateSoundFromGesture = async (reportFailure = true) => {
    if (!soundPreferenceRef.current
      || (soundOnRef.current && audioContextRef.current?.state === 'running')) return;
    if (soundActivationPendingRef.current) {
      // An autoplay resume can be pending when the first trusted gesture arrives.
      // Resume again inside that gesture rather than waiting for its timeout.
      void audioContextRef.current?.resume().catch(() => {});
      return;
    }
    soundActivationPendingRef.current = true;
    try {
      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        audioContextRef.current = createCourtAudioContext();
      }
      const context = audioContextRef.current;
      const resumed = await resumeUmpireAudioContext(context);
      if (!soundPreferenceRef.current) return;
      if (!resumed) throw new Error(`Audio context is ${context.state}`);
      void preloadLineCallAudio(context).catch(() => {});
      // Core court effects must not wait for, or fail with, optional MP3 layers.
      lastSoundFrameRef.current = playheadRef.current ?? snapshot.frameCount;
      soundOnRef.current = true;
      setSoundReady(true);
      umpireCallsEnabledRef.current = true;
      umpireSpeechReadyRef.current = true;
      setUmpireSpeechReady(true);
      resetLiveUmpireEventCursor(liveUmpireEventCursorRef.current);
      const currentCallFrame = playheadRef.current ?? snapshot.frameCount;
      lastUmpireCallFrameRef.current = fullReplay
        ? currentCallFrame
        : clampLiveCourtPlayheadToTail(
          currentCallFrame,
          sampleBufferRef.current,
          LIVE_DMO_EVENT_SYNC_BUFFER_FRAMES,
        ) ?? currentCallFrame;
      setSoundError('');
      const layers: Array<Promise<unknown>> = [];
      let sampleLoad = courtEffectSamplesLoadRef.current;
      if (!sampleLoad) {
        sampleLoad = loadCourtEffectSamples(context).then(({ samples, missing }) => {
          courtEffectSamplesRef.current = samples;
          if (missing.length && soundOnRef.current) {
            setSoundError('Some tennis court samples could not be loaded; backup effects are active.');
          }
        }).catch(() => {
          if (soundOnRef.current) {
            setSoundError('Tennis court samples could not be loaded; backup effects are active.');
          }
        });
        courtEffectSamplesLoadRef.current = sampleLoad;
      }
      layers.push(sampleLoad);
      if (stadiumAtmosphere) {
        if (!crowdAudioRef.current) {
          const crowdAudio = new Audio('/audio/te4-crowd-ambience.mp3');
          crowdAudio.loop = true;
          crowdAudio.preload = 'auto';
          // iOS ignores HTMLMediaElement.volume; use the resumed Web Audio graph.
          const crowdGain = context.createGain();
          crowdGain.gain.value = crowdVolumeRef.current;
          context.createMediaElementSource(crowdAudio).connect(crowdGain).connect(context.destination);
          crowdGainRef.current = crowdGain;
          crowdAudioRef.current = crowdAudio;
        }
        crowdGainRef.current?.gain.setTargetAtTime(crowdVolumeRef.current, context.currentTime, 0.03);
        layers.push(crowdAudioRef.current.play().catch(() => {
          if (soundOnRef.current) setSoundError('Court effects are on; crowd audio could not be loaded.');
        }));
      }
      if (gruntAudioRef.current?.isWta !== isWta
        || gruntAudioRef.current.characterKey !== playerGruntKey) {
        layers.push(loadLiveCharacterGruntSamples(
          context, isWta, playerCharacters, playerGruntSettings,
        ).then(samples => {
          if (soundOnRef.current) gruntAudioRef.current = { isWta, characterKey: playerGruntKey, samples };
        }).catch(() => {
          if (soundOnRef.current) setSoundError('Court effects are on; player grunt audio could not be loaded.');
        }));
      }
      if (!applauseAudioRef.current) {
        layers.push((async () => {
          const response = await fetch('/audio/te4-point-applause.mp3');
          if (!response.ok) throw new Error('Applause sample unavailable');
          const sample = await context.decodeAudioData(await response.arrayBuffer());
          if (soundOnRef.current) applauseAudioRef.current = sample;
        })().catch(() => {
          if (soundOnRef.current) setSoundError('Court effects are on; applause audio could not be loaded.');
        }));
      }
      void Promise.all(layers);
    } catch (error) {
      crowdAudioRef.current?.pause();
      soundOnRef.current = false;
      setSoundReady(false);
      if (soundPreferenceRef.current && reportFailure) {
        const reason = error instanceof Error ? error.message : 'Audio activation failed';
        setSoundError(`Sound could not start: ${reason}. Tap Enable sound to retry.`);
      }
    } finally {
      soundActivationPendingRef.current = false;
    }
  };

  const toggleSound = async () => {
    if (soundPointerActivationRef.current) {
      soundPointerActivationRef.current = false;
      return;
    }
    if (soundPreferenceRef.current
      && (!soundOnRef.current || audioContextRef.current?.state !== 'running')) {
      await activateSoundFromGesture();
      return;
    }
    if (soundPreferenceRef.current) {
      soundPreferenceRef.current = false;
      umpireCallsEnabledRef.current = false;
      umpireSpeechReadyRef.current = false;
      setUmpireSpeechReady(false);
      cancelUmpireCall(audioContextRef.current, liveUmpireMatchKey(snapshot.players, isWta));
      resetLiveUmpireEventCursor(liveUmpireEventCursorRef.current);
      setSoundError('');
      crowdAudioRef.current?.pause();
      for (const voice of activeGruntsRef.current) voice.stop();
      activeGruntsRef.current.clear();
      for (const voice of activeApplauseRef.current) voice.stop();
      activeApplauseRef.current.clear();
      soundOnRef.current = false;
      setSoundReady(false);
      setSoundEnabled(false);
      return;
    }
    soundPreferenceRef.current = true;
    setSoundEnabled(true);
    await activateSoundFromGesture();
  };

  useEffect(() => {
    const updateScoreboard = sceneRef.current
      ?.getObjectByName('wtsl-stadium-architecture')
      ?.userData.updateScoreboard;
    if (typeof updateScoreboard === 'function') updateScoreboard(scoreboardData);
  }, [scoreboardData]);

  useEffect(() => {
    const context = audioContextRef.current;
    if (!soundEnabled || !gruntsEnabled || !context
      || (gruntAudioRef.current?.isWta === isWta
        && gruntAudioRef.current.characterKey === playerGruntKey)) return;
    let cancelled = false;
    void loadLiveCharacterGruntSamples(context, isWta, playerCharacters, playerGruntSettings)
      .then((samples) => {
        if (!cancelled) gruntAudioRef.current = { isWta, characterKey: playerGruntKey, samples };
      })
      .catch(() => {
        if (!cancelled) setSoundError('Player grunt audio could not be loaded.');
      });
    return () => { cancelled = true; };
  }, [isWta, playerGruntKey, soundEnabled, gruntsEnabled]);
  const changeCrowdVolume = (volume: number) => {
    setCrowdVolume(volume);
    crowdVolumeRef.current = volume;
    const context = audioContextRef.current;
    if (context && crowdGainRef.current) {
      crowdGainRef.current.gain.setTargetAtTime(volume, context.currentTime, 0.03);
    }
  };
  const adjustCrowdVolume = (delta: number) => {
    changeCrowdVolume(THREE.MathUtils.clamp(Math.round((crowdVolume + delta) * 100) / 100, 0, 1));
  };
  const changeGruntsEnabled = (enabled: boolean) => {
    onGruntsEnabledChange(enabled);
    if (!enabled) {
      for (const voice of activeGruntsRef.current) voice.stop();
      activeGruntsRef.current.clear();
    }
  };
  const handleSoundActivationGesture = (target: EventTarget | null) => {
    if (target instanceof Element) {
      if (target.closest('[data-pip-toggle]')) return;
      if (target.closest('[data-sound-toggle]')) {
        if (!soundPreferenceRef.current) {
          soundPreferenceRef.current = true;
          setSoundEnabled(true);
        } else if (soundOnRef.current && audioContextRef.current?.state === 'running') {
          return;
        }
        soundPointerActivationRef.current = true;
      }
    }
    if (!soundPreferenceRef.current) return;
    void activateSoundFromGesture();
  };
  useEffect(() => {
    // Default-on broadcasts and replays start immediately when autoplay is permitted.
    // Otherwise the first trusted viewer gesture resumes every audio layer.
    void activateSoundFromGesture(false);
  }, [fullReplay]);
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
    lastUmpireCallFrameRef.current = frame;
    lastCalloutFrameRef.current = frame;
    replayUiUpdateAt.current = 0;
    setReplayFrame(frame);
  };
  const toggleReplay = async () => {
    if (replayPlayingRef.current) {
      replayPlayingRef.current = false;
      setReplayPlaying(false);
      return;
    }
    if (soundPreferenceRef.current && !soundOnRef.current) {
      await activateSoundFromGesture();
    }
    if (replayFrameRef.current === null || replayFrameRef.current >= replayEndFrame) {
      seekReplay(replayStartFrame);
    }
    replayPlayingRef.current = true;
    setReplayPlaying(true);
  };

  return (
    <section
      ref={sceneElementRef}
      className={styles.scene}
      data-full-replay={fullReplay ? 'true' : undefined}
      aria-label={fullReplay ? 'Three-dimensional full match replay' : 'Three-dimensional live court'}
      onPointerDownCapture={(event) => handleSoundActivationGesture(event.target)}
      onPointerCancelCapture={() => { soundPointerActivationRef.current = false; }}
      onKeyDownCapture={(event) => {
        if (event.target instanceof Element && event.target.closest('[data-sound-toggle]')) return;
        handleSoundActivationGesture(event.target);
      }}
    >
      <div className={styles.toolbar}>
        <div className={styles.title}>
          <span className={styles.liveDot} aria-hidden="true" />
          <strong>{fullReplay ? 'FULL MATCH REPLAY' : 'LIVE'}</strong>
          {!fullReplay && courtDelay !== null && courtDelay >= 1 && (
            <span
              style={{
                display: 'inline-flex', alignItems: 'center', minHeight: 20, padding: '3px 7px',
                border: '1px solid rgba(176, 244, 59, .35)', borderRadius: 999,
                color: '#c9f27a', font: '750 9px/1 system-ui, sans-serif', letterSpacing: '.06em',
                cursor: 'help',
              }}
              title="The court plays a few seconds behind the live match, so players can go for every ball and line calls are right. The score is live, so it can change before you see the point finish."
            >
              ~{courtDelay} s behind live
            </span>
          )}
        </div>
        <div className={styles.controls} aria-label="Court view controls">
          <div className={styles.presets} role="group" aria-label="Camera angle">
            <button type="button" aria-pressed={cameraView === 'court'} onClick={() => setPreset('court')}>Court</button>
            <button type="button" aria-pressed={cameraView === 'aerial'} onClick={() => setPreset('aerial')}>Aerial</button>
            <button type="button" aria-pressed={cameraView === 'tv'} onClick={() => setPreset('tv')}>TV view</button>
          </div>
          <div className={styles.presets} role="group" aria-label="Broadcast time of day">
            {BROADCAST_TIME_OF_DAY_OPTIONS.map(option => (
              <button
                key={option.value}
                type="button"
                aria-pressed={timeOfDay === option.value}
                onClick={() => setTimeOfDay(option.value)}
              >
                {option.label}
              </button>
            ))}
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
          <label className={styles.playerCameraControl}>
            <span>Resolution</span>
            <select
              aria-label="Graphics resolution"
              value={renderSetting}
              onChange={(event) => onRenderSettingChange(event.currentTarget.value as BroadcastRenderSetting)}
            >
              {!fullReplay && <option value="auto">Auto · {renderQuality}</option>}
              {BROADCAST_RENDER_QUALITY_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <div className={styles.iconControls} role="group" aria-label="Zoom and reset">
            <button type="button" aria-label="Zoom out" onClick={() => requestZoom(1.15)}><Minus size={15} /></button>
            <button type="button" aria-label="Zoom in" onClick={() => requestZoom(0.87)}><Plus size={15} /></button>
            <button type="button" aria-label="Reset court camera" onClick={resetCamera}><RotateCcw size={15} /></button>
          </div>
          <CourtFullscreenButton
            targetRef={sceneElementRef}
            className={`${styles.soundButton} ${styles.mobileFullscreenExit}`}
            statusClassName={styles.visuallyHidden}
            fallbackClassName={styles.fullscreenFallback}
          />
          <CourtPictureInPictureButton
            canvasRef={canvasElementRef}
            mediaVideoRef={mediaVideoRef}
            className={styles.pictureInPictureButton}
            statusClassName={styles.pictureInPictureStatus}
            videoClassName={styles.pictureInPictureSource}
          />
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
            data-sound-toggle
            type="button"
            aria-pressed={soundEnabled && soundReady}
            aria-label={soundEnabled && soundReady ? 'Mute all broadcast audio' : 'Enable all broadcast audio on this device'}
            title={soundEnabled && soundReady ? 'Mute all broadcast audio' : 'Enable all broadcast audio on this device'}
            onClick={() => void toggleSound()}
          >
            {soundEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
            <span>{soundEnabled ? soundReady ? 'Sound on' : 'Enable sound' : 'Sound off'}</span>
          </button>
          <button
            className={styles.soundButton}
            type="button"
            aria-pressed={commentary.enabled}
            aria-label={commentary.enabled ? 'Turn match commentary off' : 'Turn match commentary on'}
            title="Prefers two modern-sounding U.S. English voices when available. Voice labels are only hints; age, gender and sound quality vary by device."
            disabled={!soundEnabled || !soundReady}
            onClick={commentary.toggle}
          >
            <span>Commentary {commentary.enabled ? 'on' : 'off'}</span>
          </button>
          <button
            className={styles.soundButton}
            type="button"
            disabled={!soundEnabled || !soundReady}
            onClick={commentary.previewVoice}
          >
            <span>Preview commentary voices</span>
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
          {stadiumAtmosphere && (
            <div className={styles.volumeControl} role="group" aria-label="Crowd volume controls">
              <span>Crowd</span>
              <button
                className={styles.volumeButton}
                type="button"
                aria-label="Lower crowd volume"
                onClick={() => adjustCrowdVolume(-0.1)}
              >
                <Minus size={14} />
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={crowdVolume}
                aria-label="Crowd volume"
                onChange={(event) => changeCrowdVolume(Number(event.currentTarget.value))}
              />
              <output aria-label="Crowd volume level">{Math.round(crowdVolume * 100)}%</output>
              <button
                className={styles.volumeButton}
                type="button"
                aria-label="Raise crowd volume"
                onClick={() => adjustCrowdVolume(0.1)}
              >
                <Plus size={14} />
              </button>
            </div>
          )}
          {soundEnabled && (
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
          )}
        </div>
      </div>
      <div className={styles.viewport} ref={viewportRef}>
        <div className={styles.canvasHost} ref={canvasHostRef} />
        <div ref={transitionRef} className={styles.changeover} aria-hidden="true" />
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
      {modelStatus !== 'ready' && (
        <p className={styles.modelStatus} role="status">
          {modelStatus === 'loading'
            ? 'Loading textured character models…'
            : modelStatus === 'partial'
              ? 'Detailed players loaded; some crowd or staff models could not load.'
            : 'Detailed characters could not load. Simplified reconstruction is shown.'}
        </p>
      )}
      <div className={styles.legend}>
        <span><i style={{ backgroundColor: colorToCss(PALETTE.playerOne) }} />{snapshot.players[0]}</span>
        <span><i style={{ backgroundColor: colorToCss(PALETTE.playerTwo) }} />{snapshot.players[1]}</span>
        <span><i className={styles.ball} style={{ backgroundColor: colorToCss(PALETTE.yellow) }} />Ball</span>
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
      {commentary.error && <p className={styles.soundError} role="status">{commentary.error}</p>}
    </section>
  );
}

export default function DmoLiveCourt3D(props: Props) {
  const { fullReplay = false, ...courtProps } = props;
  const [use2dFallback, setUse2dFallback] = useState(false);
  const [gruntsEnabled, setGruntsEnabled] = useState(true);
  const [selectedRenderSetting, setRenderSetting] = useState<BroadcastRenderSetting>(
    () => getInitialBroadcastRenderSetting(fullReplay),
  );
  const renderSetting = fullReplay && selectedRenderSetting === 'auto'
    ? '1080p'
    : selectedRenderSetting;
  const [adaptiveTier, setAdaptiveTier] = useState(0);
  const adaptiveStateRef = useRef<AdaptiveRenderState>(createAdaptiveRenderState());
  const adaptiveTierRef = useRef(0);
  const renderSettingRef = useRef(renderSetting);
  renderSettingRef.current = renderSetting;
  const [crowdDensityChoice, setCrowdDensityChoice] = useState<CrowdDensityChoice>('auto');
  const crowdDensity = resolveCrowdDensity(crowdDensityChoice, props.tournamentRound);
  const useFallback = useCallback(() => setUse2dFallback(true), []);
  const onRenderFrame = useCallback((elapsedMs: number) => {
    if (renderSettingRef.current !== 'auto') return;
    const nextTier = observeAdaptiveRenderFrame(
      adaptiveStateRef.current,
      elapsedMs,
      document.visibilityState === 'visible',
    );
    if (nextTier === adaptiveTierRef.current) return;
    adaptiveTierRef.current = nextTier;
    setAdaptiveTier(nextTier);
  }, []);
  const onRenderSettingChange = useCallback((setting: BroadcastRenderSetting) => {
    adaptiveStateRef.current = createAdaptiveRenderState();
    adaptiveTierRef.current = 0;
    setAdaptiveTier(0);
    setRenderSetting(setting);
  }, []);
  const renderQuality = renderSetting === 'auto'
    ? AUTO_RENDER_RESOLUTIONS[adaptiveTier]
    : renderSetting;
  const gruntControls = { gruntsEnabled, onGruntsEnabledChange: setGruntsEnabled };
  return (
    <div className={densityStyles.courtDensityShell}>
      <label className={densityStyles.crowdDensityControl}>
        <span>Crowd density</span>
        <select
          value={crowdDensityChoice}
          aria-label="Crowd density"
          onChange={(event) => setCrowdDensityChoice(event.currentTarget.value as CrowdDensityChoice)}
        >
          {CROWD_DENSITY_CHOICES.map((choice) => (
            <option key={choice} value={choice}>
              {choice === 'auto' ? 'Auto by round' : choice[0].toUpperCase() + choice.slice(1)}
            </option>
          ))}
        </select>
      </label>
      {use2dFallback ? (
        <DmoLiveCourt
          {...courtProps}
          fullReplay={fullReplay}
          crowdDensity={crowdDensity}
          renderQuality={renderQuality}
          renderSetting={renderSetting}
          onRenderSettingChange={onRenderSettingChange}
          onRenderFrame={onRenderFrame}
          {...gruntControls}
        />
      ) : (
        <ThreeCourt
          {...props}
          crowdDensity={crowdDensity}
          renderQuality={renderQuality}
          renderSetting={renderSetting}
          onRenderSettingChange={onRenderSettingChange}
          onRenderFrame={onRenderFrame}
          {...gruntControls}
          onUnsupported={useFallback}
        />
      )}
    </div>
  );
}

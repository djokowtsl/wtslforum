import type { Te4CourtSurface } from './te4DmoTypes';
import type { LiveCourtFootworkEvent, LiveCourtMotionEvent, LiveCourtSample } from './liveCourtMotion';
import { courtSurfaceSoundProfile } from './te4DmoSurface';

export type CourtEffectKind = 'racket' | 'bounce' | 'footstep' | 'slide';
export type CourtEffectSamples = Partial<Record<CourtEffectKind, AudioBuffer>>;
export type CourtSoundEvent = { frame: number; kind: CourtEffectKind; player?: 1 | 2 };

/** Fill missing contact cues from the same recorded timeline used for animation. */
export function deriveLiveCourtSoundEvents(
  source: CourtSoundEvent[],
  shots: LiveCourtMotionEvent[],
  footwork: LiveCourtFootworkEvent[],
  samples: LiveCourtSample[],
  frameRate = 60,
): CourtSoundEvent[] {
  const fps = Number.isFinite(frameRate) && frameRate > 0 ? frameRate : 60;
  const events: CourtSoundEvent[] = [
    ...source,
    ...footwork,
    ...shots.filter(event => event.kind === 'shot').map(event => ({
      frame: event.frame, kind: 'racket' as const, player: event.player,
    })),
  ];
  let phaseIndex = -1;
  for (let index = 1; index < samples.length - 1; index += 1) {
    const before = samples[index - 1];
    const current = samples[index];
    const after = samples[index + 1];
    while (phaseIndex + 1 < shots.length && shots[phaseIndex + 1].frame <= current.frame) phaseIndex += 1;
    if (shots.length && (phaseIndex < 0 || shots[phaseIndex].kind !== 'shot')) continue;
    if (current.frame <= before.frame || after.frame <= current.frame
      || current.frame - before.frame > fps * 0.2 || after.frame - current.frame > fps * 0.2) continue;
    const height = current.values[2] * 0.01;
    const descent = (before.values[2] - current.values[2]) * 0.01;
    const ascent = (after.values[2] - current.values[2]) * 0.01;
    if (height >= 0 && height <= 0.35 && descent > 0.015 && ascent > 0.015) {
      events.push({ frame: current.frame, kind: 'bounce' });
    }
  }
  events.sort((a, b) => a.frame - b.frame || a.kind.localeCompare(b.kind));
  const lastByKind = new Map<string, number>();
  return events.filter(event => {
    if (!Number.isFinite(event.frame) || event.frame < 0) return false;
    // Source contacts and reconstructed contacts must never sound twice.
    const key = `${event.kind}:${event.kind === 'footstep' || event.kind === 'slide' ? event.player ?? '' : ''}`;
    const previous = lastByKind.get(key);
    if (previous !== undefined && event.frame - previous <= fps * 0.06) return false;
    lastByKind.set(key, event.frame);
    return true;
  });
}

const effectBuffers = new WeakMap<BaseAudioContext, Map<string, AudioBuffer[]>>();
const effectBuses = new WeakMap<BaseAudioContext, DynamicsCompressorNode>();
const courtEffectAssets: Partial<Record<CourtEffectKind, string>> = {
  racket: '/audio/dmo-racket-impact.mp3',
  bounce: '/audio/dmo-ball-bounce.mp3',
  footstep: '/audio/dmo-court-footstep.mp3',
};

export async function loadCourtEffectSamples(
  context: BaseAudioContext,
  fetcher: (url: string) => Promise<Response> = url => fetch(url),
): Promise<{ samples: CourtEffectSamples; missing: CourtEffectKind[] }> {
  const results = await Promise.all(
    (Object.entries(courtEffectAssets) as Array<[CourtEffectKind, string]>).map(async ([kind, url]) => {
      try {
        const response = await fetcher(url);
        if (!response.ok) throw new Error(`Court sound unavailable: ${kind}`);
        return { kind, buffer: await context.decodeAudioData(await response.arrayBuffer()) };
      } catch {
        return { kind, buffer: null };
      }
    }),
  );
  const samples: CourtEffectSamples = {};
  const missing: CourtEffectKind[] = [];
  for (const { kind, buffer } of results) {
    if (buffer) samples[kind] = buffer;
    else missing.push(kind);
  }
  return { samples, missing };
}

function effectsBus(context: BaseAudioContext) {
  const existing = effectBuses.get(context);
  if (existing) return existing;
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -18;
  compressor.knee.value = 18;
  compressor.ratio.value = 2.5;
  compressor.attack.value = 0.004;
  compressor.release.value = 0.16;
  compressor.connect(context.destination);
  effectBuses.set(context, compressor);
  return compressor;
}

function seededRandom(seedText: string) {
  let seed = 2_166_136_261;
  for (const character of seedText) {
    seed = Math.imul(seed ^ character.charCodeAt(0), 16_777_619) >>> 0;
  }
  return () => {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    return seed / 0x1_0000_0000;
  };
}

function courtEffectDuration(kind: CourtEffectKind, surface: Te4CourtSurface) {
  const profile = courtSurfaceSoundProfile(surface);
  if (kind === 'slide') return surface === 'clay' ? 0.09 : 0.07;
  if (kind === 'footstep') return 0.07;
  if (kind === 'racket') return Math.max(0.07, profile.racketDuration);
  return Math.min(0.095, profile.bounceDuration);
}

function createCourtEffectBuffer(
  context: BaseAudioContext,
  kind: CourtEffectKind,
  surface: Te4CourtSurface,
  variant: number,
) {
  const profile = courtSurfaceSoundProfile(surface);
  const duration = courtEffectDuration(kind, surface);
  const sampleRate = context.sampleRate;
  const buffer = context.createBuffer(1, Math.ceil(sampleRate * duration), sampleRate);
  const samples = buffer.getChannelData(0);
  const random = seededRandom(`${kind}:${surface}:${variant}`);
  const isSlide = kind === 'slide';
  const isStep = kind === 'footstep';

  const modes = kind === 'racket'
    ? [
      { frequency: profile.racketHz[1], gain: profile.racketGain * 3, decay: 0.052 },
      { frequency: profile.racketHz[0], gain: profile.racketGain * 1.5, decay: 0.021 },
      { frequency: profile.racketHz[0] * 2.15, gain: profile.racketGain * 0.3, decay: 0.012 },
    ]
    : kind === 'bounce'
      ? [
        { frequency: profile.bounceHz[1], gain: profile.bounceGain * 3, decay: 0.061 },
        { frequency: profile.bounceHz[0], gain: profile.bounceGain * 1.5, decay: 0.031 },
        { frequency: profile.bounceHz[1] * 0.52, gain: profile.bounceGain * 0.5, decay: 0.076 },
      ]
      : isStep
        ? [
          { frequency: profile.stepToneHz[1], gain: 0.18, decay: 0.046 },
          { frequency: profile.stepToneHz[0], gain: 0.075, decay: 0.022 },
        ]
        : [];
  const variedModes = modes.map((mode) => ({
    ...mode,
    frequency: mode.frequency * (0.97 + random() * 0.06),
    phase: random() * Math.PI * 2,
  }));

  const nyquist = sampleRate / 2;
  const lowCutoff = Math.min(nyquist * 0.45, isSlide ? profile.slideNoiseHz * 0.52
    : isStep ? profile.stepNoiseHz * 0.5 : kind === 'racket' ? 1_100 : 500);
  const highCutoff = Math.min(nyquist * 0.9, isSlide ? profile.slideNoiseHz * 1.8
    : isStep ? profile.stepNoiseHz * 2.1 : kind === 'racket' ? 5_200 : 2_800);
  const lowAlpha = 1 - Math.exp((-2 * Math.PI * lowCutoff) / sampleRate);
  const highAlpha = 1 - Math.exp((-2 * Math.PI * highCutoff) / sampleRate);
  let lowState = 0;
  let highState = 0;
  let peak = 0;

  for (let index = 0; index < samples.length; index += 1) {
    const time = index / sampleRate;
    const attack = Math.min(1, time / (isSlide ? 0.01 : 0.0016));
    const white = random() * 2 - 1;
    lowState += lowAlpha * (white - lowState);
    highState += highAlpha * (white - highState);
    const bandNoise = highState - lowState;
    const noiseEnvelope = isSlide
      ? Math.min(1, time / 0.008) * Math.exp(-Math.max(0, time - 0.012) / 0.032)
      : Math.exp(-time / (kind === 'racket' ? 0.012 : isStep ? 0.022 : 0.01));
    const noiseLevel = isSlide ? 0.12 : isStep ? 0.15 : kind === 'racket' ? 0.14 : 0.12;
    const noise = bandNoise * noiseEnvelope * noiseLevel;
    const body = variedModes.reduce((sum, mode) =>
      sum + Math.sin((2 * Math.PI * mode.frequency * time) + mode.phase)
        * mode.gain * Math.exp(-time / mode.decay), 0);
    const sample = (body + noise) * attack;
    samples[index] = sample;
    peak = Math.max(peak, Math.abs(sample));
  }

  const targetPeak = kind === 'racket' ? 0.58 : kind === 'bounce' ? 0.52 : isStep ? 0.3 : isSlide ? 0.12 : 0.26;
  if (peak > 0) {
    const scale = targetPeak / peak;
    for (let index = 0; index < samples.length; index += 1) samples[index] *= scale;
  }
  return buffer;
}

function courtEffectVariants(
  context: BaseAudioContext,
  kind: CourtEffectKind,
  surface: Te4CourtSurface,
) {
  let buffers = effectBuffers.get(context);
  if (!buffers) {
    buffers = new Map();
    effectBuffers.set(context, buffers);
  }
  const key = `${kind}:${surface}`;
  const cached = buffers.get(key);
  if (cached) return cached;
  const variants = [0, 1, 2].map(variant => createCourtEffectBuffer(context, kind, surface, variant));
  buffers.set(key, variants);
  return variants;
}

const sampleSurfacePitch: Record<Te4CourtSurface, number> = {
  hard: 1.02,
  clay: 0.97,
  grass: 0.94,
  unknown: 1,
};

const sampleGain: Record<CourtEffectKind, number> = {
  racket: 0.82,
  bounce: 0.78,
  footstep: 0.56,
  slide: 0.28,
};

/** Play short recorded court cues, retaining surface-specific EQ and a procedural fallback. */
export function playLiveCourtEffect(
  context: BaseAudioContext,
  kind: CourtEffectKind,
  surface: Te4CourtSurface,
  volume = 0.9,
  samples: CourtEffectSamples = {},
  delaySeconds = 0,
) {
  const level = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 0));
  if (level <= 0) return;
  // The bundled slide recording is a long tonal squeak. Slides use a short,
  // non-tonal friction burst instead, while the other effects keep their samples.
  const sample = kind === 'slide' ? undefined : samples[kind];
  const variants = sample ? null : courtEffectVariants(context, kind, surface);
  const buffer = sample ?? variants![Math.floor(Math.random() * variants!.length)];
  const now = context.currentTime;
  const source = context.createBufferSource();
  const output = context.createGain();
  source.buffer = buffer;
  source.playbackRate.value = sample
    ? sampleSurfacePitch[surface] * (0.99 + Math.random() * 0.02)
    : 0.97 + Math.random() * 0.06;
  output.gain.value = sample
    ? level * sampleGain[kind] * (0.96 + Math.random() * 0.08)
    : level * (0.94 + Math.random() * 0.1);
  source.connect(output).connect(effectsBus(context));
  const startAt = now + Math.max(0, Number.isFinite(delaySeconds) ? delaySeconds : 0);
  source.start(startAt);
  source.stop(startAt + buffer.duration);
  source.onended = () => {
    source.disconnect();
    output.disconnect();
  };
}

/** Schedule a recognizable four-cue check directly from the user's tap. */
export function playCourtSoundCheck(
  context: BaseAudioContext,
  surface: Te4CourtSurface,
  volume = 0.9,
  samples: CourtEffectSamples = {},
) {
  (['racket', 'bounce', 'footstep', 'slide'] as const).forEach((kind, index) => {
    playLiveCourtEffect(context, kind, surface, volume, samples, index * 0.36);
  });
}

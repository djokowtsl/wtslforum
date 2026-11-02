import type { Te4CourtSurface } from './te4DmoTypes';
import type { LiveCourtFootworkEvent, LiveCourtMotionEvent, LiveCourtSample } from './liveCourtMotion';
import { courtSurfaceSoundProfile } from './te4DmoSurface';

export type CourtEffectKind = 'racket' | 'bounce' | 'footstep' | 'slide';
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

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();
const effectBuses = new WeakMap<BaseAudioContext, DynamicsCompressorNode>();

function effectsBus(context: BaseAudioContext) {
  const existing = effectBuses.get(context);
  if (existing) return existing;
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -12;
  compressor.knee.value = 12;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.12;
  compressor.connect(context.destination);
  effectBuses.set(context, compressor);
  return compressor;
}

/** Short, layered physical impacts, separate from crowd and effort voices. */
export function playLiveCourtEffect(
  context: BaseAudioContext,
  kind: CourtEffectKind,
  surface: Te4CourtSurface,
  volume = 0.9,
) {
  if (volume <= 0) return;
  const profile = courtSurfaceSoundProfile(surface);
  const now = context.currentTime;
  const isStep = kind === 'footstep';
  const isSlide = kind === 'slide';
  const duration = isSlide ? (surface === 'clay' ? 0.38 : 0.26)
    : isStep ? 0.13 : kind === 'racket' ? 0.095 : 0.14;
  let buffer = noiseBuffers.get(context);
  if (!buffer) {
    buffer = context.createBuffer(1, Math.ceil(context.sampleRate * 0.5), context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
    noiseBuffers.set(context, buffer);
  }
  const noise = context.createBufferSource();
  noise.buffer = buffer;
  const filter = context.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = isSlide ? profile.slideNoiseHz
    : isStep ? profile.stepNoiseHz : kind === 'racket' ? 1800 : 700;
  filter.Q.value = isSlide ? 0.45 : 0.7;
  const noiseGain = context.createGain();
  const strength = Math.min(1, volume) * (isSlide ? 0.5 : isStep ? 0.34 : kind === 'racket' ? 0.58 : 0.42);
  noiseGain.gain.setValueAtTime(0.0001, now);
  noiseGain.gain.exponentialRampToValueAtTime(strength, now + (isSlide ? 0.035 : 0.003));
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  noise.connect(filter).connect(noiseGain).connect(effectsBus(context));
  noise.start(now);
  noise.stop(now + duration);

  // A low resonant body under the scrape/pop avoids electronic ticking.
  const tone = context.createOscillator();
  const toneGain = context.createGain();
  tone.type = 'sine';
  const frequencies = isStep ? profile.stepToneHz : isSlide ? profile.slideToneHz
    : kind === 'racket' ? profile.racketHz : profile.bounceHz;
  tone.frequency.setValueAtTime(frequencies[0], now);
  tone.frequency.exponentialRampToValueAtTime(frequencies[1], now + duration * 0.8);
  const body = isSlide ? profile.slideToneGain * 3
    : isStep ? 0.15 : kind === 'racket' ? profile.racketGain * 3.2 : profile.bounceGain * 3;
  toneGain.gain.setValueAtTime(0.0001, now);
  toneGain.gain.exponentialRampToValueAtTime(body * volume, now + 0.003);
  toneGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  tone.connect(toneGain).connect(effectsBus(context));
  tone.start(now);
  tone.stop(now + duration);
}

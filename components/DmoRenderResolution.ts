export const BROADCAST_RENDER_QUALITY_OPTIONS = [
  { value: '720p', label: '720p', width: 1280, height: 720 },
  { value: '1080p', label: '1080p', width: 1920, height: 1080 },
  { value: '4k', label: '4K', width: 3840, height: 2160 },
] as const;

export type BroadcastRenderQuality = typeof BROADCAST_RENDER_QUALITY_OPTIONS[number]['value'];
export type BroadcastRenderSetting = BroadcastRenderQuality | 'auto';
export type BroadcastRenderResolution = BroadcastRenderQuality | '540p' | '360p';

export function getInitialBroadcastRenderSetting(fullReplay: boolean): BroadcastRenderSetting {
  return fullReplay ? '1080p' : 'auto';
}

const RENDER_RESOLUTIONS: Record<BroadcastRenderResolution, { width: number; height: number }> = {
  '360p': { width: 640, height: 360 },
  '540p': { width: 960, height: 540 },
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
  '4k': { width: 3840, height: 2160 },
};

export const AUTO_RENDER_RESOLUTIONS: readonly BroadcastRenderResolution[] = [
  '1080p',
  '720p',
  '540p',
  '360p',
];

export type AdaptiveRenderState = {
  tierIndex: number;
  sampleFrames: number;
  sampleElapsedMs: number;
  lowPerformanceMs: number;
  recoveryMs: number;
};

export function createAdaptiveRenderState(): AdaptiveRenderState {
  return {
    tierIndex: 0,
    sampleFrames: 0,
    sampleElapsedMs: 0,
    lowPerformanceMs: 0,
    recoveryMs: 0,
  };
}

/** Update a render-resolution tier from sustained animation-frame pacing. */
export function observeAdaptiveRenderFrame(
  state: AdaptiveRenderState,
  frameElapsedMs: number,
  visible = true,
): number {
  if (
    !visible
    || !Number.isFinite(frameElapsedMs)
    || frameElapsedMs <= 0
    || frameElapsedMs > 1000
  ) {
    state.sampleFrames = 0;
    state.sampleElapsedMs = 0;
    state.lowPerformanceMs = 0;
    state.recoveryMs = 0;
    return state.tierIndex;
  }

  state.sampleFrames += 1;
  state.sampleElapsedMs += frameElapsedMs;
  if (state.sampleElapsedMs < 1000) return state.tierIndex;

  const framesPerSecond = state.sampleFrames * 1000 / state.sampleElapsedMs;
  if (framesPerSecond < 45) {
    state.lowPerformanceMs += state.sampleElapsedMs;
    state.recoveryMs = 0;
  } else if (framesPerSecond > 55) {
    state.recoveryMs += state.sampleElapsedMs;
    state.lowPerformanceMs = 0;
  } else {
    state.lowPerformanceMs = 0;
    state.recoveryMs = 0;
  }

  if (
    state.lowPerformanceMs >= 2000
  ) {
    if (state.tierIndex < AUTO_RENDER_RESOLUTIONS.length - 1) state.tierIndex += 1;
    state.lowPerformanceMs = 0;
    state.recoveryMs = 0;
  } else if (state.recoveryMs >= 8000 && state.tierIndex > 0) {
    state.tierIndex -= 1;
    state.lowPerformanceMs = 0;
    state.recoveryMs = 0;
  }

  state.sampleFrames = 0;
  state.sampleElapsedMs = 0;
  return state.tierIndex;
}

export function getBroadcastRenderPixelRatio(
  width: number,
  height: number,
  quality: BroadcastRenderResolution,
  devicePixelRatio: number,
) {
  if (![width, height].every(value => Number.isFinite(value) && value > 0)) return 1;
  const target = RENDER_RESOLUTIONS[quality];
  const deviceRatio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
    ? devicePixelRatio
    : 1;
  return Math.min(deviceRatio, target.width / width, target.height / height);
}

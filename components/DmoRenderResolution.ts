export const BROADCAST_RENDER_QUALITY_OPTIONS = [
  { value: '720p', label: '720p', width: 1280, height: 720 },
  { value: '1080p', label: '1080p', width: 1920, height: 1080 },
  { value: '4k', label: '4K', width: 3840, height: 2160 },
] as const;

export type BroadcastRenderQuality = typeof BROADCAST_RENDER_QUALITY_OPTIONS[number]['value'];

export function getBroadcastRenderPixelRatio(
  width: number,
  height: number,
  quality: BroadcastRenderQuality,
  devicePixelRatio: number,
) {
  if (![width, height].every(value => Number.isFinite(value) && value > 0)) return 1;
  const target = BROADCAST_RENDER_QUALITY_OPTIONS.find(option => option.value === quality)!;
  const deviceRatio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
    ? devicePixelRatio
    : 1;
  return Math.min(deviceRatio, target.width / width, target.height / height);
}

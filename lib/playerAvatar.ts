export const WTSL_PLAYER_AVATAR_FALLBACK = '/brand/wtsl-logo-200.png';

export function resolvePlayerAvatar(
  src: string | null | undefined,
  failedSrc: string | null,
): { src: string; isFallback: boolean } {
  const usableSrc = typeof src === 'string' ? src.trim() : '';
  if (usableSrc && usableSrc !== failedSrc) {
    return { src: usableSrc, isFallback: false };
  }
  return { src: WTSL_PLAYER_AVATAR_FALLBACK, isFallback: true };
}

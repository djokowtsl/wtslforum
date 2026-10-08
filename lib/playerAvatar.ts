export const WTSL_PLAYER_AVATAR_FALLBACK = '/brand/wtsl-logo-200.png';

export function resolvePlayerAvatarSource(
  src?: string | null,
  fallbackSrc?: string | null,
): { src: string | null; isFallback: boolean } {
  const playerAvatar = src?.trim() || null;
  const fallbackAvatar = fallbackSrc?.trim() || null;

  return {
    src: playerAvatar ?? fallbackAvatar,
    isFallback: !playerAvatar && Boolean(fallbackAvatar),
  };
}

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

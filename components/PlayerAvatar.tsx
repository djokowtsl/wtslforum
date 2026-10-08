'use client';

import { useState } from 'react';
import { resolvePlayerAvatarSource } from '@/lib/playerAvatar';
import { resolvePlayerAvatar } from '@/lib/playerAvatar';

type Props = {
  src?: string | null;
  fallbackSrc?: string | null;
  flagSrc?: string | null;
  flagLabel?: string | null;
  name?: string | null;
  size?: number;
  className?: string;
};

export default function PlayerAvatar({
  src,
  fallbackSrc,
  flagSrc,
  flagLabel,
  name,
  size = 34,
  className = '',
}: Props) {
  const flagWidth = Math.max(12, Math.round(size * 0.38));
  const flagHeight = Math.max(9, Math.round(flagWidth * 0.66));
  const initial = name?.trim().charAt(0).toUpperCase() || '?';
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const avatar = resolvePlayerAvatarSource(src, fallbackSrc);
  const failedAvatar = resolvePlayerAvatar(avatar.src, failedSrc);
  avatar.src = failedAvatar.src;
  avatar.isFallback = avatar.isFallback || failedAvatar.isFallback;
  return (
    <span
      className={`player-avatar ${className}`.trim()}
      style={{ width: size, height: size }}
      aria-hidden={!flagSrc ? true : undefined}
      title={flagLabel || undefined}
    >
      {avatar.src
        ? <img
            className={`player-avatar-image${avatar.isFallback ? ' player-avatar-image-wtsl-fallback player-avatar-fallback-image' : ''}`}
            src={avatar.src}
            alt=""
            loading="lazy"
            onError={avatar.isFallback ? undefined : () => setFailedSrc(avatar.src)}
          />
        : <span className="player-avatar-placeholder" style={{ fontSize: Math.max(12, Math.round(size * 0.42)) }}>{initial}</span>}
      {flagSrc && (
        <img
          className="player-avatar-flag"
          src={flagSrc}
          alt={flagLabel ? `${flagLabel} flag` : 'Country flag'}
          style={{ width: flagWidth, height: flagHeight }}
          loading="lazy"
        />
      )}
    </span>
  );
}

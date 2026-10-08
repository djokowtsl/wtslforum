'use client';

import { useState } from 'react';
import { resolvePlayerAvatar } from '@/lib/playerAvatar';

type Props = {
  src?: string | null;
  flagSrc?: string | null;
  flagLabel?: string | null;
  name?: string | null;
  size?: number;
  className?: string;
};

export default function PlayerAvatar({
  src,
  flagSrc,
  flagLabel,
  size = 34,
  className = '',
}: Props) {
  const flagWidth = Math.max(12, Math.round(size * 0.38));
  const flagHeight = Math.max(9, Math.round(flagWidth * 0.66));
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const avatar = resolvePlayerAvatar(src, failedSrc);
  return (
    <span
      className={`player-avatar ${className}`.trim()}
      style={{ width: size, height: size }}
      aria-hidden={!flagSrc ? true : undefined}
      title={flagLabel || undefined}
    >
      <img
        className={`player-avatar-image${avatar.isFallback ? ' player-avatar-fallback-image' : ''}`}
        src={avatar.src}
        alt=""
        loading="lazy"
        onError={avatar.isFallback ? undefined : () => setFailedSrc(avatar.src)}
      />
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

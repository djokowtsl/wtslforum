'use client';

import { useState } from 'react';

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
  name,
  size = 34,
  className = '',
}: Props) {
  const flagWidth = Math.max(12, Math.round(size * 0.38));
  const flagHeight = Math.max(9, Math.round(flagWidth * 0.66));
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const avatarSrc = src && src !== failedSrc ? src : null;
  return (
    <span
      className={`player-avatar ${className}`.trim()}
      style={{ width: size, height: size }}
      aria-hidden={!flagSrc ? true : undefined}
      title={flagLabel || undefined}
    >
      {avatarSrc
        ? <img className="player-avatar-image" src={avatarSrc} alt="" loading="lazy" onError={() => setFailedSrc(avatarSrc)} />
        : <img className="player-avatar-image player-avatar-fallback-image" src="/brand/wtsl-logo-200.png" alt="" loading="lazy" />}
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

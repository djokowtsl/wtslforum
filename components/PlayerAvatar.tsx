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
  const initial = name?.trim().charAt(0).toUpperCase() || '?';
  return (
    <span
      className={`player-avatar ${className}`.trim()}
      style={{ width: size, height: size }}
      aria-hidden={!flagSrc ? true : undefined}
      title={flagLabel || undefined}
    >
      {src
        ? <img className="player-avatar-image" src={src} alt="" loading="lazy" />
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

type Props = {
  size: 'topic' | 'post';
  src: string;
  hasTournamentLogo?: boolean;
  isCommunity?: boolean;
};

export default function ForumAvatar({ size, src, hasTournamentLogo = false, isCommunity = false }: Props) {
  const baseClass = size === 'topic' ? 'av' : 'avatar-img';
  const className = [
    baseClass,
    'forum-avatar',
    hasTournamentLogo ? 'av-tournament' : '',
    isCommunity ? 'av-wtsl' : '',
  ].filter(Boolean).join(' ');

  return (
    <span className={className} aria-hidden="true">
      <img className="forum-avatar-source" src={src} alt="" />
      {hasTournamentLogo && (
        <img className="forum-avatar-light-logo" src="/brand/wtsl-logo-200.png" alt="" />
      )}
    </span>
  );
}
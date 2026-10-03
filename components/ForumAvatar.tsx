type Props = {
  size: 'topic' | 'post';
  src: string;
  hasTournamentLogo?: boolean;
  isCommunity?: boolean;
  tournamentName?: string;
};

const LIGHT_MODE_TOURNAMENTS = [
  'us open',
  'wimbledon',
  'australian open',
  'roland garros',
  'united cup',
  'year end holidays cup',
];

function hasReadableLightModeLogo(tournamentName?: string) {
  const normalized = tournamentName?.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return !!normalized && LIGHT_MODE_TOURNAMENTS.some((name) => normalized.includes(name));
}

export default function ForumAvatar({ size, src, hasTournamentLogo = false, isCommunity = false, tournamentName }: Props) {
  const useTournamentLogoInLightMode = hasTournamentLogo && hasReadableLightModeLogo(tournamentName);
  const baseClass = size === 'topic' ? 'av' : 'avatar-img';
  const className = [
    baseClass,
    'forum-avatar',
    hasTournamentLogo ? 'av-tournament' : '',
    useTournamentLogoInLightMode ? 'av-tournament-readable' : '',
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
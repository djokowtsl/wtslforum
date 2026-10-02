import type { Metadata } from 'next';
import { safe, sql } from '@/lib/db';
import PageHero from '@/components/PageHero';
import TourTabs from '@/components/TourTabs';
import { normalizePlayerName } from '@/lib/queries';
import { DEFAULT_TOUR, isTourCode, tourLabel, type TourCode } from '@/lib/wtsl';
import { COOP_STANDINGS_URL, fetchCoopStandings } from '@/lib/coopStandings';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Players' };

export default async function PlayersPage({ searchParams }: { searchParams: Promise<{ tour?: string }> }) {
  const { tour: tourParam } = await searchParams;
  const tour: TourCode = isTourCode(tourParam) ? tourParam : DEFAULT_TOUR;
  let players: any[] = [];
  let coopTeams: Awaited<ReturnType<typeof fetchCoopStandings>> = [];
  let coopPlayerAvatars = new Map<string, string>();
  let coopUnavailable = false;
  if (tour === 'TE4_Coop') {
    try {
      coopTeams = await fetchCoopStandings();
    } catch {
      coopUnavailable = true;
    }
    if (coopTeams.length > 0) {
      const coopPlayerKeys = new Set(
        coopTeams.flatMap((team) => team.players.map(normalizePlayerName)).filter(Boolean),
      );
      const avatarRows = await safe(
        () => sql`
          SELECT name, avatar_url
          FROM wtsl_players
          WHERE tour IN ('TE4', 'TE4_(F)')
            AND avatar_url IS NOT NULL
            AND avatar_url <> ''
          ORDER BY CASE WHEN tour='TE4' THEN 0 ELSE 1 END, synced_at DESC
        `,
        [] as any[],
      );
      for (const row of avatarRows) {
        const name = normalizePlayerName(String(row.name ?? ''));
        const avatarUrl = String(row.avatar_url ?? '').trim();
        if (coopPlayerKeys.has(name) && avatarUrl && !coopPlayerAvatars.has(name)) {
          coopPlayerAvatars.set(name, avatarUrl);
        }
      }
    }
  } else {
    players = await safe(() => sql`SELECT * FROM wtsl_players WHERE tour=${tour} ORDER BY rank ASC NULLS LAST,tour_elo DESC NULLS LAST,name LIMIT 200`, [] as any[]);
  }

  const formatPercent = (value: number | null) => value === null
    ? '—'
    : `${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }).format(value)}%`;

  return (
    <>
      <PageHero eyebrow="Players" title="Players" />
      <main className="page-shell" style={{ paddingTop: 10 }}>
        <TourTabs basePath="/players" current={tour} />
        {tour === 'TE4_Coop' ? (
          <section className="panel coop-standings-panel">
            <div className="panel-head">
              <h2 className="display">Teams</h2>
              <a className="btn btn-primary btn-sm" href={COOP_STANDINGS_URL} target="_blank" rel="noreferrer">
                Official standings ↗
              </a>
            </div>
            {coopUnavailable ? (
              <div className="notice">The official COOP standings are temporarily unavailable. You can still view them on the WTSL site.</div>
            ) : coopTeams.length === 0 ? (
              <div className="empty">No COOP teams are listed in the current standings.</div>
            ) : (
              <div className="coop-team-grid">
                {coopTeams.map((team) => (
                  <article className="coop-team-card" key={`${team.position}-${team.teamName}`}>
                    <div className="coop-team-head">
                      <span className="coop-team-place">#{team.position}</span>
                      <div className="coop-team-title">
                        <h3>{team.teamName}</h3>
                        <span>{team.matchesPlayed} matches played</span>
                      </div>
                      <div className="coop-team-match-win">
                        <small>Match win</small>
                        <strong>{formatPercent(team.matchWinPercent)}</strong>
                      </div>
                    </div>
                    <div className="coop-team-players" aria-label={`${team.teamName} players`}>
                      {team.players.length > 0 ? team.players.map((player, index) => {
                        const avatarUrl = coopPlayerAvatars.get(normalizePlayerName(player));
                        return (
                          <span className="coop-team-player" key={`${player}-${index}`}>
                            {avatarUrl
                              ? <img className="coop-team-player-avatar" src={avatarUrl} alt="" loading="lazy" />
                              : <span className="coop-team-player-avatar-fallback" aria-hidden="true">{player.trim().charAt(0).toUpperCase() || '?'}</span>}
                            <span className="coop-team-player-name">{player}</span>
                          </span>
                        );
                      }) : <span className="coop-team-player">Players not listed</span>}
                    </div>
                    <div className="coop-team-stat-grid">
                      <div><small>Match record</small><strong>{team.matchRecord || '—'}</strong></div>
                      <div><small>Sets W–L</small><strong>{team.setsRecord || '—'}</strong><span>{formatPercent(team.setsWinPercent)}</span></div>
                      <div><small>Games W–L</small><strong>{team.gamesRecord || '—'}</strong><span>{formatPercent(team.gamesWinPercent)}</span></div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        ) : players.length === 0 ? (
          <div className="forum-list"><div className="empty"><strong>No players synced yet</strong>Players appear here once the WTSL {tourLabel(tour)} rankings sync has run.</div></div>
        ) : (
          <div className="player-grid">
            {players.map((p: any) => (
              <a className="player-card" href={`/players/${p.wtsl_player_id}?tour=${encodeURIComponent(tour)}`} key={p.wtsl_player_id}>
                {p.avatar_url ? <img src={p.avatar_url} alt={p.name} /> : <div className="player-placeholder">{(p.name || 'W')[0]}</div>}
                <div><strong>{p.name}</strong>{p.country && <small>{p.flag_url && <img src={p.flag_url} alt="" />}{p.country}</small>}<b>Tour Rank {p.rank ? `#${p.rank}` : 'Unranked'} | Tour Elo {p.tour_elo ?? '—'}</b></div>
                <span>↗</span>
              </a>
            ))}
          </div>
        )}
      </main>
    </>
  );
}

import Link from 'next/link';
import { initial, prettyKey, timeAgo } from '@/lib/format';

function Face({ src, name }: { src?: string | null; name?: string | null }) {
  return src ? <img src={src} alt="" /> : <div className="ph">{initial(name)}</div>;
}

/** Links straight into (or creates) the Match Talk thread for this exact match, so you don't
 * have to go find/start it yourself in the Discussions section. */
function DiscussLink({ params }: { params: Record<string, string | undefined> }) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
  return <Link href={`/api/match-thread?${qs}`} className="discuss-link">💬 Discuss</Link>;
}

/** Links a player's name to their forum profile for the tour this match/fixture belongs to —
 * falls back to plain text if we don't have an id (e.g. a bye or TBC slot). */
function PlayerLink({ id, tour, name }: { id?: string | number | null; tour?: string | null; name?: string | null }) {
  if (!id || !tour) return <>{name || 'TBC'}</>;
  return <Link href={`/players/${id}?tour=${encodeURIComponent(tour)}`}>{name || 'TBC'}</Link>;
}

export function ResultCard({ m, tournamentNames }: { m: any; tournamentNames?: Record<string, string> }) {
  const p1win = m.winner_id && String(m.winner_id) === String(m.player_one_id);
  const p2win = m.winner_id && String(m.winner_id) === String(m.player_two_id);
  // `tournament_name` is scraped and stored directly on the match row at sync time — preferred
  // over the `tournamentNames` lookup (keyed by the `tournaments` table's generated slug, which
  // doesn't match the raw tournament ID these recent-results rows carry) or the raw key itself.
  const t = m.tournament_name || (m.tournament_key && tournamentNames?.[m.tournament_key]) || prettyKey(m.tournament_key);
  return (
    <div className="match-card">
      <div className="match-top">
        <span>{t}{m.round_name ? ` · ${m.round_name}` : ''}</span>
        <b title="Completed">✓</b>
      </div>
      <div className={`match-row-p ${p1win ? 'win' : ''}`}>
        <Face src={m.player_one_avatar} name={m.player_one_name} />
        <span className={`nm ${p2win ? 'lost' : ''}`}><PlayerLink id={m.player_one_id} tour={m.tour} name={m.player_one_name} /></span>
      </div>
      <div className={`match-row-p ${p2win ? 'win' : ''}`}>
        <Face src={m.player_two_avatar} name={m.player_two_name} />
        <span className={`nm ${p1win ? 'lost' : ''}`}><PlayerLink id={m.player_two_id} tour={m.tour} name={m.player_two_name} /></span>
      </div>
      <div className="match-score">{m.score || '—'}{m.played_at ? ` · ${timeAgo(m.played_at)}` : ''}</div>
      <DiscussLink params={{ key: `match-${m.id}`, p1: m.player_one_name, p2: m.player_two_name, tournament: t, round: m.round_name, score: m.score }} />
    </div>
  );
}

export function FixtureCard({ f }: { f: any }) {
  return (
    <div className="match-card">
      <div className="match-top">
        <span>{f.tournament || 'WTSL'}</span>
        <b className="open">{String(f.status || 'open').toUpperCase()}</b>
      </div>
      <div className="match-row-p">
        <Face src={f.first_avatar} name={f.first_name} />
        <span className="nm"><PlayerLink id={f.first_id} tour={f.tour} name={f.first_name} /></span>
        <span className="val">{Number(f.odds_one).toFixed(2)}</span>
      </div>
      <div className="match-row-p">
        <Face src={f.second_avatar} name={f.second_name} />
        <span className="nm"><PlayerLink id={f.second_id} tour={f.tour} name={f.second_name} /></span>
        <span className="val">{Number(f.odds_two).toFixed(2)}</span>
      </div>
      {(f.scheduled_at || f.round_deadline) && (
        <div className="match-score">
          {f.scheduled_at ? `Scheduled: ${new Date(f.scheduled_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : `Deadline: ${new Date(f.round_deadline).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
        </div>
      )}
      <DiscussLink params={{ key: `fixture-${f.key}`, p1: f.first_name, p2: f.second_name, tournament: f.tournament }} />
    </div>
  );
}

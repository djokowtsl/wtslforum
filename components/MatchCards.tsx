import Link from 'next/link';
import { matchDateLabel, prettyKey } from '@/lib/format';
import { lookupWtslTournamentName } from '@/lib/wtslResultDisplay';
import PlayerAvatar from '@/components/PlayerAvatar';

function Face({ src, flagSrc, flagLabel, name }: { src?: string | null; flagSrc?: string | null; flagLabel?: string | null; name?: string | null }) {
  return <PlayerAvatar src={src} flagSrc={flagSrc} flagLabel={flagLabel} name={name} size={28} />;
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
  // Prefer the canonical calendar label over feed text, which can include tour and event suffixes.
  const t = lookupWtslTournamentName(m.tournament_key, tournamentNames)
    || lookupWtslTournamentName(m.tournament_name, tournamentNames)
    || m.tournament_name
    || prettyKey(m.tournament_key);
  return (
    <div className="match-card">
      <div className="match-top">
        <span>{t}{m.round_name ? ` · ${m.round_name}` : ''}</span>
        <b title="Completed">✓</b>
      </div>
      <div className={`match-row-p ${p1win ? 'win' : ''}`}>
        <Face src={m.player_one_avatar} flagSrc={m.player_one_flag} flagLabel={m.player_one_country} name={m.player_one_name} />
        <span className={`nm ${p2win ? 'lost' : ''}`}><PlayerLink id={m.player_one_id} tour={m.tour} name={m.player_one_name} /></span>
      </div>
      <div className={`match-row-p ${p2win ? 'win' : ''}`}>
        <Face src={m.player_two_avatar} flagSrc={m.player_two_flag} flagLabel={m.player_two_country} name={m.player_two_name} />
        <span className={`nm ${p1win ? 'lost' : ''}`}><PlayerLink id={m.player_two_id} tour={m.tour} name={m.player_two_name} /></span>
      </div>
      <div className="match-score">{m.score || '—'}{m.played_at ? ` · ${matchDateLabel(m.played_at)}` : ''}</div>
      <DiscussLink params={{ key: `match-${m.id}`, p1: m.player_one_name, p2: m.player_two_name, tournament: t, round: m.round_name, score: m.score, tour: m.tour }} />
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
        <Face src={f.first_avatar} flagSrc={f.first_flag} flagLabel={f.first_country} name={f.first_name} />
        <span className="nm"><PlayerLink id={f.first_id} tour={f.tour} name={f.first_name} /></span>
        <span className="val">{Number(f.odds_one).toFixed(2)}</span>
      </div>
      <div className="match-row-p">
        <Face src={f.second_avatar} flagSrc={f.second_flag} flagLabel={f.second_country} name={f.second_name} />
        <span className="nm"><PlayerLink id={f.second_id} tour={f.tour} name={f.second_name} /></span>
        <span className="val">{Number(f.odds_two).toFixed(2)}</span>
      </div>
      {f.round_deadline && (
        <div className="match-score">
          {`Deadline: ${new Date(f.round_deadline).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
        </div>
      )}
      <DiscussLink params={{ key: `fixture-${f.key}`, p1: f.first_name, p2: f.second_name, tournament: f.tournament, tour: f.tour }} />
    </div>
  );
}

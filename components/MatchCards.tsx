import { initial, prettyKey, timeAgo } from '@/lib/format';

function Face({ src, name }: { src?: string | null; name?: string | null }) {
  return src ? <img src={src} alt="" /> : <div className="ph">{initial(name)}</div>;
}

export function ResultCard({ m, tournamentNames }: { m: any; tournamentNames?: Record<string, string> }) {
  const p1win = m.winner_id && String(m.winner_id) === String(m.player_one_id);
  const p2win = m.winner_id && String(m.winner_id) === String(m.player_two_id);
  const t = (m.tournament_key && tournamentNames?.[m.tournament_key]) || prettyKey(m.tournament_key);
  return (
    <div className="match-card">
      <div className="match-top">
        <span>{t}{m.round_name ? ` · ${m.round_name}` : ''}</span>
        <b>FT</b>
      </div>
      <div className={`match-row-p ${p1win ? 'win' : ''}`}>
        <Face src={m.player_one_avatar} name={m.player_one_name} />
        <span className={`nm ${p2win ? 'lost' : ''}`}>{m.player_one_name || 'TBC'}</span>
      </div>
      <div className={`match-row-p ${p2win ? 'win' : ''}`}>
        <Face src={m.player_two_avatar} name={m.player_two_name} />
        <span className={`nm ${p1win ? 'lost' : ''}`}>{m.player_two_name || 'TBC'}</span>
      </div>
      <div className="match-score">{m.score || '—'}{m.played_at ? ` · ${timeAgo(m.played_at)}` : ''}</div>
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
        <span className="nm">{f.first_name}</span>
        <span className="val">{Number(f.odds_one).toFixed(2)}</span>
      </div>
      <div className="match-row-p">
        <Face src={f.second_avatar} name={f.second_name} />
        <span className="nm">{f.second_name}</span>
        <span className="val">{Number(f.odds_two).toFixed(2)}</span>
      </div>
    </div>
  );
}

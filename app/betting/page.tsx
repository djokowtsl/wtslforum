import {openFixtures} from '@/lib/betting';

export const dynamic='force-dynamic';

export default async function Betting(){
  const fixtures=await openFixtures();

  return <main className="container">
    <div className="page-title">
      <div className="eyebrow">WTSL COMMUNITY</div>
      <h1>WTSL BETTING</h1>
      <p>Virtual WTSL Dollars only. Follow fixtures, odds and community selections.</p>
    </div>
    <div className="notice">
      Betting data is read from the existing WTSL bot. Placement is temporarily
      disabled while the Core API remains read-only.
    </div>
    <div className="fixture-grid">
      {fixtures.map((f:any)=><article className="fixture-card" key={f.key}>
        <div className="fixture-top">
          <span>{f.tournament||'WTSL'} · {(f.tour||'TE4').toUpperCase()}</span>
          <b>{String(f.status||'open').toUpperCase()}</b>
        </div>
        <h2>{f.first_name} <small>vs</small> {f.second_name}</h2>
        <div className="odds">
          <span>{f.first_name}<strong>{Number(f.odds_one).toFixed(2)}</strong></span>
          <span>{f.second_name}<strong>{Number(f.odds_two).toFixed(2)}</strong></span>
        </div>
        <div className="topic-meta">Fixture {f.key}</div>
      </article>)}
    </div>
  </main>;
}

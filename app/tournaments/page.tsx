import Link from 'next/link';
import {getTournaments} from '@/lib/tournaments';
export const dynamic='force-dynamic';
export default async function TournamentsPage(){
  const all=await getTournaments();
  const groups=[['ongoing','Ongoing'],['upcoming','Upcoming'],['completed','Completed']];
  return <main className="page-shell"><div className="eyebrow">WTSL TOUR · COMMUNITY</div><h1 className="display">TOURNAMENTS</h1><p className="lede">Follow the WTSL calendar, open the community discussion and jump back to the official tournament page.</p>
    {groups.map(([status,label])=>{const items=all.filter((x:any)=>x.status===status); return <section className="section-block" key={status}><div className="section-heading"><h2>{label}</h2><span>{items.length}</span></div><div className="tournament-grid">{items.map((t:any)=><Link href={`/tournaments/${t.wtsl_tournament_key}`} className="tournament-card" key={t.id}><div className={`status-dot ${status}`}/><div><div className="t-name">{t.name}</div><div className="t-meta">{t.location}{t.country?`, ${t.country}`:''} · {t.category}</div><div className="t-meta">{t.surface} · {t.draw_size ?? '—'} draw · {t.start_date ? new Date(t.start_date).toLocaleDateString('en-GB') : '—'}</div></div><span className="arrow">↗</span></Link>)}</div></section>})}
  </main>
}

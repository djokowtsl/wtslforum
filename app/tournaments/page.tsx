import Link from 'next/link';
import type { Metadata } from 'next';
import { dbConfigured, safe } from '@/lib/db';
import { getTournaments } from '@/lib/tournaments';
import { fmtDate } from '@/lib/format';
import PageHero from '@/components/PageHero';
import TourTabs from '@/components/TourTabs';
import YearTabs from '@/components/YearTabs';
import { DEFAULT_TOUR, isTourCode, type TourCode } from '@/lib/wtsl';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Tournaments' };

const GROUPS: [string, string][] = [['ongoing', 'Ongoing'], ['upcoming', 'Upcoming'], ['completed', 'Completed']];

export default async function TournamentsPage({ searchParams }: { searchParams: Promise<{ tour?: string; year?: string }> }) {
  const { tour: tourParam, year } = await searchParams;
  const tour: TourCode = isTourCode(tourParam) ? tourParam : DEFAULT_TOUR;
  const unfiltered = await safe(() => getTournaments(tour), [] as any[]);
  const years = [...new Set(unfiltered.map((t: any) => t.start_date ? String(new Date(t.start_date).getFullYear()) : null).filter(Boolean))].sort((a, b) => Number(b) - Number(a)) as string[];
  const all = year ? unfiltered.filter((t: any) => t.start_date && String(new Date(t.start_date).getFullYear()) === year) : unfiltered;
  return (
    <>
      <PageHero eyebrow="WTSL Tour · Calendar" title="Tournaments">Follow the WTSL calendar, open the community discussion for each event and jump to the official tournament page.</PageHero>
      <main className="page-shell" style={{ paddingTop: 10 }}>
        <TourTabs basePath="/tournaments" current={tour} extraParams={year ? { year } : undefined} />
        {years.length > 0 && <YearTabs basePath="/tournaments" years={years} current={year} extraParams={{ tour }} />}
        {all.length === 0 && (
          <div className="forum-list"><div className="empty"><strong>{dbConfigured() ? 'No tournaments synced yet' : 'Database not connected'}</strong>{dbConfigured() ? 'The calendar syncs from the official WTSL site every hour.' : 'Set DATABASE_URL on the deployment to load the tournament calendar.'}</div></div>
        )}
        {GROUPS.map(([status, label]) => {
          const items = all.filter((x: any) => x.status === status);
          if (!items.length) return null;
          return (
            <section className="section-block" key={status}>
              <div className="section-heading"><h2>{label}</h2><span>{items.length}</span></div>
              <div className="tournament-grid">
                {items.map((t: any) => (
                  <Link href={`/tournaments/${t.wtsl_tournament_key}`} className="tournament-card" key={t.id}>
                    <div className={`status-dot ${status}`} />
                    <div>
                      <div className="t-name">{t.name}</div>
                      <div className="t-meta">{t.location}{t.country ? `, ${t.country}` : ''} · {t.category}</div>
                      <div className="t-meta">{t.surface} · {t.draw_size ?? '—'} draw · {fmtDate(t.start_date)}</div>
                    </div>
                    <span className="arrow">↗</span>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </main>
    </>
  );
}

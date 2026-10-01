import { redirect } from 'next/navigation';
import { safe } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getActiveCycle, getCategories, getNomineesForCategories, getTally, getWriteInTally } from '@/lib/awards';
import AwardAdminPanel from '@/components/AwardAdminPanel';
import PageHero from '@/components/PageHero';

export const dynamic = 'force-dynamic';

export default async function AdminAwards() {
  const u = await getSession();
  if (!u) redirect('/api/auth/discord');
  if (!u.isAdmin) redirect('/');

  const cycle = await safe(() => getActiveCycle(), null as any);
  if (!cycle) {
    return (
      <>
        <PageHero eyebrow="Staff" title="Awards admin">Manage nominees and voting.</PageHero>
        <main className="container"><div className="notice">No award cycle exists yet — create one in the database (see db.sql) before managing nominees.</div></main>
      </>
    );
  }

  const categories = await safe(() => getCategories(cycle.id), [] as any[]);
  const nominees = categories.length ? await safe(() => getNomineesForCategories(categories.map((c: any) => c.id)), [] as any[]) : [];
  const categoriesWithData = await Promise.all(
    categories.map(async (c: any) => ({
      ...c,
      nominees: nominees.filter((n: any) => n.category_id === c.id),
      tally: await safe(() => getTally(c.id), [] as any[]),
      write_ins: await safe(() => getWriteInTally(c.id), [] as any[]),
    }))
  );

  return (
    <>
      <PageHero eyebrow="Staff" title="Awards admin">Manage {cycle.season}&apos;s nominees and voting.</PageHero>
      <main className="container">
        <AwardAdminPanel cycleId={cycle.id} votingOpen={cycle.voting_open} categories={categoriesWithData} />
      </main>
    </>
  );
}

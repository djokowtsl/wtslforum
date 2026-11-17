import { redirect } from 'next/navigation';
import AdminMatchSchedulerList from '@/components/AdminMatchSchedulerList';
import PageHero from '@/components/PageHero';
import { getSession } from '@/lib/auth';
import { getAdminMatchSchedules } from '@/lib/matchSchedulerAdmin';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Admin match schedules' };

export default async function AdminMatchSchedulerPage() {
  const user = await getSession();
  if (!user) redirect('/api/auth/discord');
  if (!user.isAdmin) redirect('/');

  try {
    const schedules = await getAdminMatchSchedules();
    return (
      <>
        <PageHero eyebrow="Staff" title="Match schedules">Review every real Forum schedule without changing player decisions.</PageHero>
        <AdminMatchSchedulerList schedules={schedules} />
      </>
    );
  } catch {
    return (
      <>
        <PageHero eyebrow="Staff" title="Match schedules">Review every real Forum schedule without changing player decisions.</PageHero>
        <main className="scheduler-page">
          <section className="scheduler-empty" role="alert">
            <strong>Schedule data is temporarily unavailable</strong>
            We could not load match schedules. Please try again.
          </section>
        </main>
      </>
    );
  }
}

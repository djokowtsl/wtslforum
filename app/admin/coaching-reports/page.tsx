import { redirect } from 'next/navigation';
import Link from 'next/link';
import PageHero from '@/components/PageHero';
import AdminCoachingReportsManager from '@/components/AdminCoachingReportsManager';
import { getSession } from '@/lib/auth';
import { getAdminCoachingReports, type AdminCoachingReport } from '@/lib/coachingReports';

export const dynamic = 'force-dynamic';

function toIso(value: string | Date | null): string | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

type SerializedReport = Omit<
  AdminCoachingReport,
  'published_at' | 'consent_recorded_at' | 'reviewed_at' | 'unpublished_at'
> & {
  published_at: string;
  consent_recorded_at: string;
  reviewed_at: string;
  unpublished_at: string | null;
};

export default async function AdminCoachingReportsPage() {
  const user = await getSession();
  if (!user) redirect('/api/auth/discord');
  if (!user.isAdmin) redirect('/');

  let reports: SerializedReport[] = [];
  let unavailable = false;
  try {
    reports = (await getAdminCoachingReports()).map((report) => ({
      ...report,
      published_at: toIso(report.published_at) ?? '',
      consent_recorded_at: toIso(report.consent_recorded_at) ?? '',
      reviewed_at: toIso(report.reviewed_at) ?? '',
      unpublished_at: toIso(report.unpublished_at),
    }));
  } catch (error) {
    console.error('[admin-coaching-reports] report list unavailable', {
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    unavailable = true;
  }

  return (
    <>
      <PageHero eyebrow="Staff · Publishing" title="Coaching Reports">
        Review consent records and remove public reports when sharing approval changes.
      </PageHero>
      <main className="container" style={{ display: 'grid', gap: 16, paddingBottom: 60 }}>
        <Link className="btn btn-sm btn-ghost" href="/admin/dmo-analysis">Back to DMO analysis</Link>
        {unavailable
          ? <div className="notice">The report store is unavailable. Check the database migration and try again.</div>
          : <AdminCoachingReportsManager initialReports={reports} />}
      </main>
    </>
  );
}

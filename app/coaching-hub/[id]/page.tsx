import Link from 'next/link';
import { notFound } from 'next/navigation';
import PageHero from '@/components/PageHero';
import CoachingReportReplay from '@/components/CoachingReportReplay';
import { getPublishedCoachingReport } from '@/lib/coachingReports';
import styles from '../coaching-hub.module.css';

export const dynamic = 'force-dynamic';

function reportDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return date.toLocaleDateString('en-GB', { timeZone: 'UTC', dateStyle: 'medium' });
}

export default async function CoachingReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) notFound();
  let report;
  try {
    report = await getPublishedCoachingReport(id);
  } catch {
    notFound();
  }
  if (!report) notFound();

  return (
    <>
      <PageHero eyebrow={`${report.tournament} · ${report.round_name}`} title="Coaching Report">
        {report.player1} vs {report.player2} · {report.score}
      </PageHero>
      <main className={`container ${styles.page}`}>
        <section className={styles.reportPanel} aria-labelledby="public-report-title">
          <div className={styles.sectionHeading}>
            <div>
              <span className={styles.kicker}>PUBLIC MATCH BREAKDOWN</span>
              <h2 id="public-report-title">{report.player1} <i>vs</i> {report.player2}</h2>
            </div>
            <span className={styles.privateLabel}>Source DMO remains private</span>
          </div>
          <p className={styles.reportScore}>{report.score}</p>
          <p className={styles.reportDate}>Published {reportDate(report.published_at)}</p>
          <CoachingReportReplay reportId={report.id} players={[report.player1, report.player2]} />
          <p className={styles.consentNote}>
            This report contains the replay data approved for public sharing. The uploaded DMO and
            staff analysis workspace are not available here.
          </p>
        </section>
        <Link className="btn btn-ghost" href="/coaching-hub">Back to Coaching Hub</Link>
      </main>
    </>
  );
}

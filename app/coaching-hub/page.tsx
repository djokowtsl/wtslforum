import type { Metadata } from 'next';
import Link from 'next/link';
import PageHero from '@/components/PageHero';
import { getPublishedCoachingReports, type PublicCoachingReport } from '@/lib/coachingReports';
import styles from './coaching-hub.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Coaching Hub',
  description: 'TE4 replay analysis, live matches, and approved WTSL Forum coaching reports.',
};

const coachDestinations = [
  {
    eyebrow: 'REPLAY ANALYSIS',
    title: 'Analyse a match',
    description: 'Review a replay point by point, inspect shot ratings, and explore alternative choices.',
    href: 'https://replays.knowthew.net/',
    action: 'Open TE4 Coach',
  },
  {
    eyebrow: 'LIVE',
    title: 'Watch matches',
    description: 'Browse broadcasts and follow matches as players put them on air.',
    href: 'https://replays.knowthew.net/tv/',
    action: 'Watch live',
  },
  {
    eyebrow: 'BROADCAST',
    title: 'Put a match on air',
    description: 'Start a browser-based broadcast from the PC you play Tennis Elbow 4 on.',
    href: 'https://replays.knowthew.net/tv/golive',
    action: 'Open broadcast',
  },
  {
    eyebrow: 'SHOT LIBRARY',
    title: 'Explore everyone’s shots',
    description: 'Look up how players use different shots and situations across replays.',
    href: 'https://replays.knowthew.net/all/',
    action: 'Explore the library',
  },
  {
    eyebrow: 'MATCH DASHBOARD',
    title: 'Build a replay dashboard',
    description: 'Upload a replay folder to collect matches and review player patterns.',
    href: 'https://replays.knowthew.net/#folder',
    action: 'Create a dashboard',
  },
];

const reportCapabilities = [
  {
    title: 'Interactive replay',
    description: 'Follow the reconstructed match on court, point by point.',
  },
  {
    title: 'Ranked turning points',
    description: 'Review selected moments with their score and match context.',
  },
  {
    title: 'Match and serve summary',
    description: 'See the reconstructed score and serve results when the DMO supports them.',
  },
];

function reportDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return date.toLocaleDateString('en-GB', { timeZone: 'UTC', dateStyle: 'medium' });
}

export default async function CoachingHubPage() {
  let reports: PublicCoachingReport[] = [];
  let reportsUnavailable = false;
  try {
    reports = await getPublishedCoachingReports();
  } catch (error) {
    console.error('[coaching-hub] public reports unavailable', {
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    reportsUnavailable = true;
  }

  return (
    <>
      <PageHero eyebrow="Tennis Elbow 4 · Analysis & learning" title="Coaching Hub">
        Explore TE4 Coach and find public coaching reports prepared by the WTSL Forum.
      </PageHero>

      <main className={`container ${styles.page}`}>
        <section className={styles.intro} aria-labelledby="coaching-intro-title">
          <div>
            <span className={styles.kicker}>TE4 COACH &amp; FORUM REPORTS</span>
            <h2 id="coaching-intro-title">Match analysis built around real points.</h2>
            <p>
              Explore TE4 Coach’s replay tools, live broadcasts, and shared shot library.
              Forum reports add reviewed DMO replays and coaching notes, published only with
              both players’ consent.
            </p>
          </div>
          <div className={styles.introActions}>
            <a
              className="btn btn-primary"
              href="https://replays.knowthew.net/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Open TE4 Coach <span aria-hidden="true">↗</span>
            </a>
            <a className="btn btn-ghost" href="#forum-reports">Forum reports</a>
          </div>
        </section>

        <section className={styles.tools} aria-labelledby="coach-tools-title">
          <div className={styles.sectionHeading}>
            <div>
              <span className={styles.kicker}>TE4 COACH</span>
              <h2 id="coach-tools-title">Choose a way in</h2>
            </div>
            <a href="https://replays.knowthew.net/" target="_blank" rel="noopener noreferrer">
              Visit replays.knowthew.net <span aria-hidden="true">↗</span>
            </a>
          </div>

          <div className={styles.toolGrid}>
            {coachDestinations.map((destination) => (
              <a
                className={styles.toolCard}
                href={destination.href}
                key={destination.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className={styles.cardEyebrow}>{destination.eyebrow}</span>
                <h3>{destination.title}</h3>
                <p>{destination.description}</p>
                <span className={styles.cardAction}>
                  {destination.action} <span aria-hidden="true">↗</span>
                </span>
              </a>
            ))}
          </div>
        </section>

        <section className={styles.reports} id="forum-reports" aria-labelledby="forum-reports-title">
          <div className={styles.sectionHeading}>
            <div>
              <span className={styles.kicker}>WTSL FORUM</span>
              <h2 id="forum-reports-title">Coaching reports</h2>
            </div>
            <span className={styles.privateLabel}>DMO source files stay private</span>
          </div>

          <div className={styles.reportPanel}>
            {reportsUnavailable ? (
              <div className={styles.reportEmpty} role="status">
                Public coaching reports are temporarily unavailable. Please try again later.
              </div>
            ) : reports.length === 0 ? (
              <>
                <div className={styles.reportStatus}>
                  <span className={styles.statusDot} />
                  No public reports yet
                </div>
                <h3>Approved match breakdowns will appear here.</h3>
                <p>
                  The Forum analyzer can publish an interactive replay and ranked match moments
                  after staff review and consent checks. Source DMO files and the admin workspace
                  remain private.
                </p>
              </>
            ) : (
              <div className={styles.reportGrid}>
                {reports.map((report) => (
                  <article className={styles.reportCard} key={report.id}>
                    <span>{report.tournament} · {report.round_name}</span>
                    <h3>{report.player1} <i>vs</i> {report.player2}</h3>
                    <p className={styles.reportScore}>{report.score}</p>
                    <p className={styles.reportDate}>Published {reportDate(report.published_at)}</p>
                    <Link href={`/coaching-hub/${report.id}`}>
                      Open match breakdown <span aria-hidden="true">→</span>
                    </Link>
                  </article>
                ))}
              </div>
            )}

            <div className={styles.capabilityGrid} aria-label="Potential Forum report content">
              {reportCapabilities.map((capability) => (
                <div className={styles.capability} key={capability.title}>
                  <span aria-hidden="true">✓</span>
                  <div>
                    <strong>{capability.title}</strong>
                    <p>{capability.description}</p>
                  </div>
                </div>
              ))}
            </div>

            <p className={styles.consentNote}>
              Public DMO reports include only consent-cleared replay data. Uploaded DMO files and
              staff analysis remain private.
            </p>
          </div>
        </section>
      </main>
    </>
  );
}

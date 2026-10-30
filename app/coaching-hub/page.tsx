import type { Metadata } from 'next';
import PageHero from '@/components/PageHero';
import styles from './coaching-hub.module.css';

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

export default function CoachingHubPage() {
  return (
    <>
      <PageHero eyebrow="Tennis Elbow 4 · Analysis & learning" title="Coaching Hub">
        Explore TE4 Coach and find public coaching reports prepared by the WTSL Forum.
      </PageHero>

      <main className={`container ${styles.page}`}>
        <section className={styles.intro} aria-labelledby="coaching-intro-title">
          <div>
            <span className={styles.kicker}>ONE MATCH, MORE TO LEARN</span>
            <h2 id="coaching-intro-title">Replay it. Read it. Improve it.</h2>
            <p>
              TE4 Coach offers replay breakdowns, live broadcasts, and a shared shot library.
              Forum DMO reports will be listed here once they are ready for public sharing.
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
            <div className={styles.reportStatus}>
              <span className={styles.statusDot} />
              No public reports yet
            </div>
            <h3>Approved match breakdowns will appear here.</h3>
            <p>
              The Forum’s staff-only DMO analyzer can produce an interactive replay, ranked
              moments, and match or serve summaries. This page will show only reviewed reports
              cleared for public sharing—not uploaded DMO files or the private analysis workspace.
            </p>

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
              Public DMO reports require review and explicit sharing consent from the submitter
              and both players.
            </p>
          </div>
        </section>
      </main>
    </>
  );
}

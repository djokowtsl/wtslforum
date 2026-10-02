import type { Metadata } from 'next';
import PageHero from '@/components/PageHero';
import ScreenshotStatsExplorer from '@/components/ScreenshotStatsExplorer';
import {
  BOT_AGGREGATE_METRICS,
  botRatingComparisonPopulation,
} from '@/lib/botRatingLeaderboards';
import type {
  ScreenshotStatsPopulations,
  ScreenshotStatsTour,
} from '@/lib/screenshotStatsQuestions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Screenshot Statistics' };

const TOURS: ScreenshotStatsTour[] = ['TE4', 'TE4_(F)'];

export default async function ScreenshotStatsPage({
  searchParams,
}: {
  searchParams: Promise<{ tour?: string }>;
}) {
  const { tour: tourParam } = await searchParams;
  const initialTour: ScreenshotStatsTour = tourParam === 'TE4_(F)'
    ? 'TE4_(F)'
    : 'TE4';
  const loaded = await Promise.allSettled(
    TOURS.map((tour) => botRatingComparisonPopulation(tour)),
  );
  const populations = {
    TE4: loaded[0].status === 'fulfilled' ? loaded[0].value : [],
    'TE4_(F)': loaded[1].status === 'fulfilled' ? loaded[1].value : [],
  } satisfies ScreenshotStatsPopulations;
  const hasLoadFailure = loaded.some((result) => result.status === 'rejected');
  const metrics = BOT_AGGREGATE_METRICS.map((metric) => ({
    label: ['Fastest Serve', 'Avg 1st Serve Speed', 'Avg 2nd Serve Speed'].includes(metric.label)
      ? `${metric.label} (km/h)`
      : metric.label,
    sourceLabel: metric.sourceLabel,
    valueFormat: metric.valueFormat,
    direction: metric.direction,
  }));

  return (
    <>
      <PageHero eyebrow="WTSL · VERIFIED SCREENSHOT DATA" title="Screenshot Statistics">
        Explore reconciled ATP and WTA player statistics, filter the snapshot, or ask a question answered directly from the published data.
      </PageHero>
      <main className="container screenshot-stats-page">
        {hasLoadFailure ? (
          <div className="notice warn" role="status">
            Screenshot statistics could not be loaded. Please try again shortly.
          </div>
        ) : null}
        <ScreenshotStatsExplorer
          initialTour={initialTour}
          populations={populations}
          metrics={metrics}
        />
        <p className="screenshot-stats-source">
          Values come from reconciled screenshot statistics after evidence that did not match official results is excluded. This snapshot currently covers ATP and WTA singles; doubles are not included.
        </p>
      </main>
    </>
  );
}
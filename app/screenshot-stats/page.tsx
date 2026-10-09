import type { Metadata } from 'next';
import PageHero from '@/components/PageHero';
import ScreenshotStatsExplorer from '@/components/ScreenshotStatsExplorer';
import ScreenshotRecordsViewer from '@/components/ScreenshotRecordsViewer';
import {
  BOT_AGGREGATE_METRICS,
  botRatingComparisonPopulation,
} from '@/lib/botRatingLeaderboards';
import type {
  ScreenshotStatsPopulations,
  ScreenshotStatsTour,
} from '@/lib/screenshotStatsQuestions';
import {
  getScreenshotRecordFilterOptions,
  getScreenshotRecordPage,
  type ScreenshotRecordFilters,
} from '@/lib/screenshotRecords';

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
  const initialFilters: ScreenshotRecordFilters = {
    tour: initialTour,
    page: 1,
    player: '',
    opponent: '',
    tournament: '',
    search: '',
    year: null,
    status: 'any',
    metric: '',
    min: null,
    max: null,
    rankedOnly: true,
  };
  const [loaded, initialRecordPage, initialFilterOptions] = await Promise.all([
    Promise.allSettled(TOURS.map((tour) => botRatingComparisonPopulation(tour))),
    Promise.allSettled([getScreenshotRecordPage(initialFilters)]),
    Promise.allSettled([getScreenshotRecordFilterOptions(initialTour)]),
  ]);
  const populations = {
    TE4: loaded[0].status === 'fulfilled' ? loaded[0].value : [],
    'TE4_(F)': loaded[1].status === 'fulfilled' ? loaded[1].value : [],
  } satisfies ScreenshotStatsPopulations;
  const hasLoadFailure = loaded.some((result) => result.status === 'rejected');
  const initialRecords = initialRecordPage[0];
  const initialOptions = initialFilterOptions[0];
  const recordsLoadFailed = initialRecords.status === 'rejected';
  const optionsLoadFailed = initialOptions.status === 'rejected';
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
      <PageHero eyebrow="WTSL · SCREENSHOT MATCH DATA" title="Screenshot Statistics">
        Browse individual workbook rows, inspect their screenshot statistics, or ask a question answered from the reconciled player snapshot.
      </PageHero>
      <main className="container screenshot-stats-page">
        {hasLoadFailure ? (
          <div className="notice warn" role="status">
            Screenshot statistics could not be loaded. Please try again shortly.
          </div>
        ) : null}
        <ScreenshotRecordsViewer
          initialTour={initialTour}
          initialResult={initialRecords.status === 'fulfilled' ? initialRecords.value : undefined}
          initialFilterOptions={initialOptions.status === 'fulfilled' ? initialOptions.value : undefined}
          initialLoadError={recordsLoadFailed}
          initialOptionsError={optionsLoadFailed}
        />
        <ScreenshotStatsExplorer
          initialTour={initialTour}
          populations={populations}
          metrics={metrics}
        />
      </main>
    </>
  );
}
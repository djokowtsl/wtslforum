import type { Metadata } from 'next';
import PageHero from '@/components/PageHero';
import CharacterStatsExplorer from '@/components/CharacterStatsExplorer';
import { wtslCore } from '@/lib/wtsl-core';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Characters',
  description: 'Browse WTSL character profiles, attribute rankings, mechanics, and official match pick history.',
};

type Tour = 'all' | 'atp' | 'wta';

export default async function CharactersPage({
  searchParams,
}: {
  searchParams: Promise<{ tour?: string; character?: string }>;
}) {
  const params = await searchParams;
  const initialTour: Tour = ['all', 'atp', 'wta'].includes(params.tour || '')
    ? (params.tour as Tour)
    : 'all';
  let initialRoster: Record<string, unknown> | null = null;

  try {
    initialRoster = await wtslCore.characterStats({ tour: initialTour });
  } catch (error) {
    console.warn('[characters] Initial WTSL roster unavailable', {
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
  }

  return (
    <>
      <PageHero eyebrow="WTSL · CHARACTER DATA" title="Characters">
        Explore the full ATP, WTA, or combined roster. Compare character builds,
        inspect their mechanics and rankings, and see picks recorded in official
        WTSL results.
      </PageHero>
      <main className="container character-page-main">
        {initialRoster ? (
          <CharacterStatsExplorer
            initialTour={initialTour}
            initialRoster={initialRoster}
            initialCharacter={params.character || ''}
          />
        ) : (
          <div className="notice warn" role="status">
            Character data could not be loaded from WTSL. The page will be
            available when the character statistics service is reachable.
          </div>
        )}
      </main>
    </>
  );
}

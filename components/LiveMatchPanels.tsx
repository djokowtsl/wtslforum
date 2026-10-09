'use client';

import Link from 'next/link';
import { FixtureCard, ResultCard } from '@/components/MatchCards';
import { usePublicFixtures, usePublicResults } from '@/components/PublicLiveData';
import type { TourCode } from '@/lib/wtsl';
import { matchDateLabel } from '@/lib/format';
import FeedUpdatedAt from '@/components/FeedUpdatedAt';

const BETTING_TOURS: TourCode[] = ['TE4', 'TE4_(F)'];

function FeedStatus({ title, detail, unavailable = false }: {
  title: string;
  detail: string;
  unavailable?: boolean;
}) {
  return (
    <div className={`notice${unavailable ? ' warn' : ''}`} role="status" aria-live="polite">
      <strong>{title}</strong> {detail}
    </div>
  );
}

function FeedFreshness({ updatedAt }: {
  updatedAt?: string | null;
  source?: 'snapshot' | 'live' | null;
}) {
  return (
    <FeedUpdatedAt updatedAt={updatedAt} as="p" className="muted feed-freshness" />
  );
}

export function HomeLatestResultSpot() {
  const feed = usePublicResults();
  if (feed.status === 'loading') {
    return <Link className="spot" href="/matches"><small>Latest result</small><b>View match results →</b></Link>;
  }
  if (feed.status === 'unavailable') {
    return <Link className="spot" href="/matches"><small>Latest result</small><b>Open match centre</b><span>Recent results are temporarily unavailable.</span></Link>;
  }
  const lead = feed.results[0];
  if (!lead) {
    return <Link className="spot" href="/matches"><small>Latest result</small><b>No recent result available</b></Link>;
  }
  return (
    <Link className="spot" href="/matches">
      <small>Latest result</small>
      <b>{lead.player_one_name} vs {lead.player_two_name}</b>
      <span>{lead.score || '—'}{lead.played_at ? ` · ${matchDateLabel(lead.played_at)}` : ''}</span>
    </Link>
  );
}

export function HomeRecentResults() {
  const feed = usePublicResults();
  if (feed.status === 'loading') {
    return <FeedStatus title="Loading recent results…" detail="Results will appear here shortly." />;
  }
  if (feed.status === 'unavailable') {
    return <FeedStatus title="Recent results unavailable." detail="Please try again later." unavailable />;
  }
  if (feed.results.length === 0) {
    return (
      <>
        <FeedFreshness updatedAt={feed.updatedAt} source={feed.source} />
        {feed.refreshError && <FeedStatus title="Unable to refresh results." detail="Please try again later." unavailable />}
        <div className="notice">No recent WTSL results are available right now. See the <Link href="/matches" style={{ color: 'var(--lime)' }}>matches page</Link> for completed matches.</div>
      </>
    );
  }
  return (
    <>
      <FeedFreshness updatedAt={feed.updatedAt} source={feed.source} />
      {feed.refreshError && <FeedStatus title="Unable to refresh results." detail="Showing previously loaded results." unavailable />}
      <div className="live-grid">
        {feed.results.map((match: any) => <ResultCard key={match.id} m={match} tournamentNames={feed.tournamentNames} />)}
      </div>
    </>
  );
}

export function HomeOpenFixtures() {
  const feed = usePublicFixtures();
  if (feed.status === 'loading') {
    return <FeedStatus title="Loading open fixtures…" detail="Fixtures will appear here shortly." />;
  }
  if (feed.status === 'unavailable') {
    return <FeedStatus title="Open fixtures unavailable." detail="Please try again later." unavailable />;
  }
  const fixtures = feed.publicOpen.slice(0, 3);
  if (fixtures.length === 0) {
    return (
      <>
        <FeedFreshness updatedAt={feed.updatedAt} source={feed.source} />
        {feed.refreshError && <FeedStatus title="Unable to refresh fixtures." detail="Please try again later." unavailable />}
        <div className="notice">No open fixtures are available right now. See the <Link href="/tournaments" style={{ color: 'var(--lime)' }}>tournament calendar</Link> for scheduled events.</div>
      </>
    );
  }
  return (
    <>
      <FeedFreshness updatedAt={feed.updatedAt} source={feed.source} />
      {feed.refreshError && <FeedStatus title="Unable to refresh fixtures." detail="Showing previously loaded fixtures." unavailable />}
      <div className="live-grid">{fixtures.map((fixture: any) => <FixtureCard key={fixture.key} f={fixture} />)}</div>
    </>
  );
}

export function MatchesOpenFixtures({ tour }: { tour: TourCode }) {
  const feed = usePublicFixtures();
  if (!BETTING_TOURS.includes(tour)) {
    return <div className="forum-list"><div className="empty"><strong>No open fixtures right now</strong>The betting bot only runs markets for ATP and WTA singles — this tour has no fixtures.</div></div>;
  }
  if (feed.status === 'loading') {
    return <FeedStatus title="Loading open fixtures…" detail="Fixtures will appear here shortly." />;
  }
  if (feed.status === 'unavailable') {
    return <FeedStatus title="Open fixtures unavailable." detail="Please try again later." unavailable />;
  }
  const fixtures = feed.publicOpen.filter((fixture: any) => String(fixture.tour) === tour);
  if (fixtures.length === 0) {
    return (
      <>
        <FeedFreshness updatedAt={feed.updatedAt} source={feed.source} />
        {feed.refreshError && <FeedStatus title="Unable to refresh fixtures." detail="Please try again later." unavailable />}
        <div className="forum-list"><div className="empty"><strong>No open fixtures right now</strong>New fixtures appear here as soon as the next round is set.</div></div>
      </>
    );
  }
  return (
    <>
      <FeedFreshness updatedAt={feed.updatedAt} source={feed.source} />
      {feed.refreshError && <FeedStatus title="Unable to refresh fixtures." detail="Showing previously loaded fixtures." unavailable />}
      <div className="live-grid">{fixtures.map((fixture: any) => <FixtureCard key={fixture.key} f={fixture} />)}</div>
    </>
  );
}

export function MatchesRecentResults() {
  const feed = usePublicResults();
  if (feed.status === 'loading') {
    return <FeedStatus title="Loading recent results…" detail="Results will appear here shortly." />;
  }
  if (feed.status === 'unavailable') {
    return <FeedStatus title="Recent results unavailable." detail="The results feed could not be loaded." unavailable />;
  }
  if (feed.results.length === 0) {
    return (
      <>
        <FeedFreshness updatedAt={feed.updatedAt} source={feed.source} />
        {feed.refreshError && <FeedStatus title="Unable to refresh results." detail="Please try again later." unavailable />}
        <div className="forum-list"><div className="empty"><strong>No results yet</strong>Completed matches will be listed here.</div></div>
      </>
    );
  }
  return (
    <>
      <FeedFreshness updatedAt={feed.updatedAt} source={feed.source} />
      {feed.refreshError && <FeedStatus title="Unable to refresh results." detail="Showing previously loaded results." unavailable />}
      <div className="live-grid">
        {feed.results.map((match: any) => <ResultCard key={match.id} m={match} tournamentNames={feed.tournamentNames} />)}
      </div>
    </>
  );
}

'use client';

import Link from 'next/link';
import { FixtureCard, ResultCard } from '@/components/MatchCards';
import { usePublicFixtures, usePublicResults } from '@/components/PublicLiveData';
import type { TourCode } from '@/lib/wtsl';
import { matchDateLabel } from '@/lib/format';

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

function FeedFreshness({ checkedAt, source }: {
  checkedAt?: string;
  source?: 'snapshot' | 'live' | null;
}) {
  if (!checkedAt) return null;
  const checked = new Date(checkedAt);
  if (!Number.isFinite(checked.getTime())) return null;
  const label = checked.toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  return (
    <p className="muted feed-freshness">
      {source === 'snapshot' ? 'Last verified snapshot' : 'Source checked'} {label}
    </p>
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
    return <FeedStatus title="Loading recent results…" detail="Showing the latest saved official results as soon as they are available." />;
  }
  if (feed.status === 'unavailable') {
    return <FeedStatus title="Recent results unavailable." detail="The feed could not be loaded. This is not an empty results list." unavailable />;
  }
  if (feed.results.length === 0) {
    return (
      <>
        <FeedFreshness checkedAt={feed.checkedAt} source={feed.source} />
        {feed.refreshError && <FeedStatus title="Live refresh unavailable." detail="The last successful result snapshot is shown above." unavailable />}
        <div className="notice">No recent WTSL results are available right now. See the <Link href="/matches" style={{ color: 'var(--lime)' }}>matches page</Link> for completed matches.</div>
      </>
    );
  }
  return (
    <>
      <FeedFreshness checkedAt={feed.checkedAt} source={feed.source} />
      {feed.refreshError && <FeedStatus title="Live refresh unavailable." detail="Showing the last successful official results snapshot." unavailable />}
      <div className="live-grid">
        {feed.results.map((match: any) => <ResultCard key={match.id} m={match} tournamentNames={feed.tournamentNames} />)}
      </div>
    </>
  );
}

export function HomeOpenFixtures() {
  const feed = usePublicFixtures();
  if (feed.status === 'loading') {
    return <FeedStatus title="Checking open fixtures…" detail="The latest verified pairings will appear here." />;
  }
  if (feed.status === 'unavailable') {
    return <FeedStatus title="Open fixtures unavailable." detail="The official-draw check could not be completed, so no pairings are being shown as open." unavailable />;
  }
  const fixtures = feed.publicOpen.slice(0, 3);
  if (fixtures.length === 0) {
    return (
      <>
        <FeedFreshness checkedAt={feed.checkedAt} source={feed.source} />
        {feed.refreshError && <FeedStatus title="Live fixture refresh unavailable." detail="The saved snapshot did not contain an open fixture." unavailable />}
        <div className="notice">No open fixtures are available right now. See the <Link href="/tournaments" style={{ color: 'var(--lime)' }}>tournament calendar</Link> for scheduled events.</div>
      </>
    );
  }
  return (
    <>
      <FeedFreshness checkedAt={feed.checkedAt} source={feed.source} />
      {feed.refreshError && <FeedStatus title="Live fixture refresh unavailable." detail="These pairings are the last successfully checked snapshot, not a fresh eligibility check." unavailable />}
      {feed.source === 'snapshot' && <FeedStatus title="Last verified fixture snapshot." detail="Current betting eligibility is checked separately before a bet is accepted." />}
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
    return <FeedStatus title="Checking open fixtures…" detail="The latest verified pairings will appear here." />;
  }
  if (feed.status === 'unavailable') {
    return <FeedStatus title="Open fixtures unavailable." detail="The official-draw check could not be completed; this does not mean the tour has no matches." unavailable />;
  }
  const fixtures = feed.publicOpen.filter((fixture: any) => String(fixture.tour) === tour);
  if (fixtures.length === 0) {
    return (
      <>
        <FeedFreshness checkedAt={feed.checkedAt} source={feed.source} />
        {feed.refreshError && <FeedStatus title="Live fixture refresh unavailable." detail="The saved snapshot did not contain an open fixture." unavailable />}
        <div className="forum-list"><div className="empty"><strong>No open fixtures right now</strong>New fixtures appear here as soon as the next round is set.</div></div>
      </>
    );
  }
  return (
    <>
      <FeedFreshness checkedAt={feed.checkedAt} source={feed.source} />
      {feed.refreshError && <FeedStatus title="Live fixture refresh unavailable." detail="These pairings are the last successfully checked snapshot." unavailable />}
      {feed.source === 'snapshot' && <FeedStatus title="Last verified fixture snapshot." detail="Current fixture status is checked again in the background." />}
      <div className="live-grid">{fixtures.map((fixture: any) => <FixtureCard key={fixture.key} f={fixture} />)}</div>
    </>
  );
}

export function MatchesRecentResults() {
  const feed = usePublicResults();
  if (feed.status === 'loading') {
    return <FeedStatus title="Loading recent results…" detail="The latest saved official results will appear here as soon as they are available." />;
  }
  if (feed.status === 'unavailable') {
    return <FeedStatus title="Recent results unavailable." detail="The results feed could not be loaded." unavailable />;
  }
  if (feed.results.length === 0) {
    return (
      <>
        <FeedFreshness checkedAt={feed.checkedAt} source={feed.source} />
        {feed.refreshError && <FeedStatus title="Live refresh unavailable." detail="The saved snapshot did not contain a completed result." unavailable />}
        <div className="forum-list"><div className="empty"><strong>No results yet</strong>Completed matches will be listed here.</div></div>
      </>
    );
  }
  return (
    <>
      <FeedFreshness checkedAt={feed.checkedAt} source={feed.source} />
      {feed.refreshError && <FeedStatus title="Live refresh unavailable." detail="Showing the last successful official results snapshot." unavailable />}
      <div className="live-grid">
        {feed.results.map((match: any) => <ResultCard key={match.id} m={match} tournamentNames={feed.tournamentNames} />)}
      </div>
    </>
  );
}

'use client';

import { createContext, useContext, useEffect, useState } from 'react';

export type FeedStatus = 'loading' | 'ready' | 'unavailable';

export type PublicFixtureFeeds = {
  status: FeedStatus;
  errorStatus?: number;
  publicOpen: any[];
  bettingBoard: { open: any[]; recent_settled: any[] };
};

type FixturePayload = {
  publicOpen: any[];
  bettingBoard: { open: any[]; recent_settled: any[] };
};

export type PublicResultsFeed = {
  status: FeedStatus;
  errorStatus?: number;
  results: any[];
  tournamentNames: Record<string, string>;
};

const fixtureFallback: PublicFixtureFeeds = {
  status: 'loading',
  publicOpen: [],
  bettingBoard: { open: [], recent_settled: [] },
};
const resultsFallback: PublicResultsFeed = { status: 'loading', results: [], tournamentNames: {} };

const FixturesContext = createContext<PublicFixtureFeeds>(fixtureFallback);
const ResultsContext = createContext<PublicResultsFeed>(resultsFallback);

export function PublicFixturesProvider({
  children,
  enabled = true,
}: {
  children: React.ReactNode;
  enabled?: boolean;
}) {
  const [feed, setFeed] = useState<PublicFixtureFeeds>(
    enabled ? fixtureFallback : { ...fixtureFallback, status: 'ready' },
  );

  useEffect(() => {
    if (!enabled) {
      setFeed({ ...fixtureFallback, status: 'ready' });
      return;
    }
    const controller = new AbortController();
    let active = true;

    fetch('/api/live-fixtures', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!active) return null;
        if (!response.ok) {
          setFeed({ ...fixtureFallback, status: 'unavailable', errorStatus: response.status });
          return null;
        }
        return response.json() as Promise<FixturePayload>;
      })
      .then((data) => {
        if (!active || !data) return;
        if (!Array.isArray(data.publicOpen)
          || !Array.isArray(data.bettingBoard?.open)
          || !Array.isArray(data.bettingBoard?.recent_settled)) {
          setFeed({ ...fixtureFallback, status: 'unavailable' });
          return;
        }
        setFeed({ status: 'ready', publicOpen: data.publicOpen, bettingBoard: data.bettingBoard });
      })
      .catch(() => {
        if (active) setFeed({ ...fixtureFallback, status: 'unavailable' });
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [enabled]);

  return <FixturesContext.Provider value={feed}>{children}</FixturesContext.Provider>;
}

export function usePublicFixtures() {
  return useContext(FixturesContext);
}

export function PublicResultsProvider({
  children,
  limit,
  tour,
}: {
  children: React.ReactNode;
  limit: number;
  tour: string;
}) {
  const [feed, setFeed] = useState<PublicResultsFeed>(resultsFallback);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const query = new URLSearchParams({ limit: String(limit), tour });

    fetch(`/api/live-results?${query}`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!active) return null;
        if (!response.ok) {
          setFeed({ ...resultsFallback, status: 'unavailable', errorStatus: response.status });
          return null;
        }
        return response.json() as Promise<{ results: any[]; tournamentNames: Record<string, string> }>;
      })
      .then((data) => {
        if (!active || !data) return;
        if (!Array.isArray(data.results) || !data.tournamentNames || typeof data.tournamentNames !== 'object') {
          setFeed({ ...resultsFallback, status: 'unavailable' });
          return;
        }
        setFeed({ status: 'ready', results: data.results, tournamentNames: data.tournamentNames });
      })
      .catch(() => {
        if (active) setFeed({ ...resultsFallback, status: 'unavailable' });
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [limit, tour]);

  return <ResultsContext.Provider value={feed}>{children}</ResultsContext.Provider>;
}

export function usePublicResults() {
  return useContext(ResultsContext);
}

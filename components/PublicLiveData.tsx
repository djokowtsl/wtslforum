'use client';

import { createContext, useContext, useEffect, useState } from 'react';

export type FeedStatus = 'loading' | 'ready' | 'unavailable';

export type PublicFixtureFeeds = {
  status: FeedStatus;
  errorStatus?: number;
  publicOpen: any[];
  bettingBoard: { open: any[]; recent_settled: any[] };
  checkedAt?: string;
  updatedAt?: string | null;
  source?: 'snapshot' | 'live' | null;
  refreshing?: boolean;
  refreshError?: boolean;
};

type FixturePayload = {
  publicOpen: any[];
  bettingBoard: { open: any[]; recent_settled: any[] };
  checkedAt?: string;
  updatedAt?: string | null;
};

export type PublicResultsFeed = {
  status: FeedStatus;
  errorStatus?: number;
  results: any[];
  tournamentNames: Record<string, string>;
  checkedAt?: string;
  updatedAt?: string | null;
  source?: 'snapshot' | 'live' | null;
  refreshing?: boolean;
  refreshError?: boolean;
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
  initialFeed,
}: {
  children: React.ReactNode;
  enabled?: boolean;
  initialFeed?: PublicFixtureFeeds;
}) {
  const [feed, setFeed] = useState<PublicFixtureFeeds>(
    initialFeed ?? (enabled ? fixtureFallback : { ...fixtureFallback, status: 'ready' }),
  );

  useEffect(() => {
    if (!enabled) {
      setFeed({ ...fixtureFallback, status: 'ready' });
      return;
    }
    let active = true;
    let inFlight = false;
    let currentController: AbortController | null = null;

    const refresh = async () => {
      if (!active || inFlight || document.visibilityState === 'hidden') return;
      inFlight = true;
      setFeed((current) => ({ ...current, refreshing: true }));
      const controller = new AbortController();
      currentController = controller;
      try {
        const response = await fetch('/api/live-fixtures', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) {
          setFeed((current) => current.status === 'ready'
            ? { ...current, refreshing: false, refreshError: true, errorStatus: response.status }
            : { ...fixtureFallback, status: 'unavailable', refreshing: false, refreshError: true, errorStatus: response.status });
          return;
        }
        const data = await response.json() as FixturePayload;
        if (!active) return;
        if (!Array.isArray(data.publicOpen)
          || !Array.isArray(data.bettingBoard?.open)
          || !Array.isArray(data.bettingBoard?.recent_settled)) {
          setFeed((current) => current.status === 'ready'
            ? { ...current, refreshing: false, refreshError: true }
            : { ...fixtureFallback, status: 'unavailable', refreshing: false, refreshError: true });
          return;
        }
        setFeed({
          status: 'ready',
          publicOpen: data.publicOpen,
          bettingBoard: data.bettingBoard,
          checkedAt: data.checkedAt || new Date().toISOString(),
          updatedAt: data.updatedAt ?? null,
          source: 'live',
          refreshing: false,
          refreshError: false,
        });
      } catch {
        if (active) {
          setFeed((current) => current.status === 'ready'
            ? { ...current, refreshing: false, refreshError: true }
            : { ...fixtureFallback, status: 'unavailable', refreshing: false, refreshError: true });
        }
      } finally {
        inFlight = false;
        if (currentController === controller) currentController = null;
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      active = false;
      currentController?.abort();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.clearInterval(timer);
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
  initialFeed,
}: {
  children: React.ReactNode;
  limit: number;
  tour: string;
  initialFeed?: PublicResultsFeed;
}) {
  const [feed, setFeed] = useState<PublicResultsFeed>(initialFeed ?? resultsFallback);

  useEffect(() => {
    let active = true;
    let inFlight = false;
    let currentController: AbortController | null = null;
    const refresh = async () => {
      if (!active || inFlight || document.visibilityState === 'hidden') return;
      inFlight = true;
      setFeed((current) => ({ ...current, refreshing: true }));
      const controller = new AbortController();
      currentController = controller;
      const query = new URLSearchParams({ limit: String(limit), tour });
      try {
        const response = await fetch(`/api/live-results?${query}`, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) {
          setFeed((current) => current.status === 'ready'
            ? { ...current, refreshing: false, refreshError: true, errorStatus: response.status }
            : { ...resultsFallback, status: 'unavailable', refreshing: false, refreshError: true, errorStatus: response.status });
          return;
        }
        const data = await response.json() as { results: any[]; tournamentNames: Record<string, string>; checkedAt?: string; updatedAt?: string | null };
        if (!active) return;
        if (!Array.isArray(data.results) || !data.tournamentNames || typeof data.tournamentNames !== 'object') {
          setFeed((current) => current.status === 'ready'
            ? { ...current, refreshing: false, refreshError: true }
            : { ...resultsFallback, status: 'unavailable', refreshing: false, refreshError: true });
          return;
        }
        setFeed({
          status: 'ready',
          results: data.results,
          tournamentNames: data.tournamentNames,
          checkedAt: data.checkedAt || new Date().toISOString(),
          updatedAt: data.updatedAt ?? null,
          source: 'live',
          refreshing: false,
          refreshError: false,
        });
      } catch {
        if (active) {
          setFeed((current) => current.status === 'ready'
            ? { ...current, refreshing: false, refreshError: true }
            : { ...resultsFallback, status: 'unavailable', refreshing: false, refreshError: true });
        }
      } finally {
        inFlight = false;
        if (currentController === controller) currentController = null;
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60_000);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      active = false;
      currentController?.abort();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.clearInterval(timer);
    };
  }, [limit, tour]);

  return <ResultsContext.Provider value={feed}>{children}</ResultsContext.Provider>;
}

export function usePublicResults() {
  return useContext(ResultsContext);
}

import type { CoreFixture } from '@/lib/wtsl-core';

export type PublicFixturePayload = {
  bettingBoard: { open: CoreFixture[]; recent_settled: CoreFixture[] };
  publicOpen: CoreFixture[];
  checkedAt: string;
  updatedAt?: string | null;
};

export type PublicResultsPayload = {
  results: any[];
  tournamentNames: Record<string, string>;
  checkedAt: string;
  updatedAt?: string | null;
};

export type LiveScoresPayload = {
  matches: any[];
  checkedAt: string;
  updatedAt?: string | null;
};

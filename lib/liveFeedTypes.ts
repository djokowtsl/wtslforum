import type { CoreFixture } from '@/lib/wtsl-core';

export type PublicFixturePayload = {
  bettingBoard: { open: CoreFixture[]; recent_settled: CoreFixture[] };
  publicOpen: CoreFixture[];
  checkedAt: string;
};

export type PublicResultsPayload = {
  results: any[];
  tournamentNames: Record<string, string>;
  checkedAt: string;
};

export type LiveScoresPayload = {
  matches: any[];
  checkedAt: string;
};

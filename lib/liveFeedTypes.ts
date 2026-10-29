import type { CoreFixture } from '@/lib/wtsl-core';
import type { OngoingTournamentMatch } from '@/lib/liveBroadcastTournamentMatches';

export type PublicFixturePayload = {
  bettingBoard: { open: CoreFixture[]; recent_settled: CoreFixture[] };
  publicOpen: CoreFixture[];
  ongoingTournamentMatches?: OngoingTournamentMatch[];
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

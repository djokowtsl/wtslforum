import type { DmoCommentaryContext } from './dmoCommentary.mjs';

export const DMO_PHRASEBOOK_VERSION: number;

export type DmoLivePhrasebook = {
  version: number;
  lines: Array<{ voice: string; speed: number; text: string }>;
  vocabulary: string[];
};

export function dmoCommentaryWords(text: string): string[];
export function isDmoCommentaryLineAllowed(text: string, vocabulary: Iterable<string> | Set<string>): boolean;
export function buildDmoLivePhrasebook(input: {
  names: readonly [string, string];
  tournament?: string;
  surface?: string;
  round?: string;
  context?: DmoCommentaryContext | null;
  bestOf?: 1 | 3 | 5;
  simulations?: number;
  size?: number;
}): DmoLivePhrasebook;

import type { DmoCommentaryContext, DmoCommentaryPoint } from './dmoCommentary.mjs';

export const DMO_COMMENTARY_SCRIPT_VERSION: number;
export const DMO_COMMENTARY_VOICES: Readonly<{ female: 'af_heart'; male: 'am_michael' }>;
export const DMO_COMMENTARY_SPEED: number;

export type DmoCommentaryScriptCue = {
  /** Replay frame to speak at; null for the opening, which plays when commentary starts. */
  at: number | null;
  speaker: 'female' | 'male';
  voice: string;
  speed: number;
  text: string;
  /** `join`: where the match stands, for viewers who start part-way. */
  kind: 'opening' | 'facts' | 'point' | 'game' | 'stats' | 'join';
  /** Lines of one exchange (a call and its reply) share a group. */
  group: number;
  /** Game, set and match calls are never dropped for being late. */
  mustPlay: boolean;
};

export type DmoCommentaryScript = {
  version: number;
  fps: number;
  cues: DmoCommentaryScriptCue[];
};

export function estimateDmoSpeechSeconds(text: string): number;

export function buildDmoCommentaryScript(input: {
  names: readonly [string, string];
  points: readonly DmoCommentaryPoint[];
  fps?: number;
  tournament?: string;
  surface?: string;
  round?: string;
  context?: DmoCommentaryContext | null;
}): DmoCommentaryScript;

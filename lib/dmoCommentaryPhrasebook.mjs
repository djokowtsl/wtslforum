/**
 * Live-match commentary made in advance.
 *
 * A live match's points aren't known beforehand, but its players are, and
 * most of what the booth says depends only on them: the introduction, "Game,
 * gifu.", "Break point, Debuffy.", the set and match calls. The phrasebook is
 * the lines a pairing's matches are most likely to need, found by running the
 * real commentary rules over simulated matches between the two players.
 * Turned into stored clips before (and while) the match is on, they play
 * instantly. Measured on simulated matches, 600 lines cover about 80% of what
 * is said.
 *
 * Lines outside the phrasebook (a particular rally length or scoreline) are
 * made as needed. To keep that from becoming a general speech service, such a
 * line may only use the commentary's own words (DMO_COMMENTARY_VOCABULARY),
 * the players' and tournament's names, and numbers.
 */

import { buildDmoCommentaryFacts } from './dmoCommentary.mjs';
import {
  buildDmoCommentaryScript,
  DMO_COMMENTARY_SPEED,
  DMO_COMMENTARY_VOICES,
} from './dmoCommentaryScript.mjs';
import { simulateDmoCommentaryMatch } from './dmoCommentarySimulator.mjs';
import { normalizeDmoSpeechRequest } from './dmoCommentarySpeech.mjs';
import { DMO_COMMENTARY_VOCABULARY } from './dmoCommentaryVocabulary.mjs';

export const DMO_PHRASEBOOK_VERSION = 1;
const DEFAULT_SIMULATIONS = 60;
const DEFAULT_SIZE = 600;

const NUMBER_WORDS = [
  'love', 'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen',
  'nineteen', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety',
  'hundred', 'deuce', 'all',
];

/** The words of a line, lower-cased, without punctuation. */
export function dmoCommentaryWords(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[’']/g, "'")
    .split(/[^\p{L}\p{N}_']+/u)
    .map((word) => word.replace(/^'+|'+$/g, ''))
    .filter(Boolean);
}

/**
 * May this line be spoken for this match? It must be ordinary commentary text
 * (the same rules as the speech service), and every word must come from the
 * commentary's vocabulary, the players' names, or be a number.
 */
export function isDmoCommentaryLineAllowed(text, vocabulary) {
  if (!normalizeDmoSpeechRequest({ text, voice: 'af_heart' })) return false;
  const known = vocabulary instanceof Set ? vocabulary : new Set(vocabulary);
  return dmoCommentaryWords(text).every((word) => known.has(word) || /^\d{1,4}$/.test(word));
}

/**
 * @param {{
 *   names: readonly [string, string],
 *   tournament?: string,
 *   surface?: string,
 *   round?: string,
 *   context?: object | null,
 *   bestOf?: 1 | 3 | 5,
 *   simulations?: number,
 *   size?: number,
 * }} input
 * @returns {{ version: number, lines: Array<{ voice: string, speed: number, text: string }>, vocabulary: string[] }}
 */
export function buildDmoLivePhrasebook({
  names,
  tournament = '',
  surface = '',
  round = '',
  context = null,
  bestOf = 3,
  simulations = DEFAULT_SIMULATIONS,
  size = DEFAULT_SIZE,
}) {
  const counts = new Map();
  const priority = new Map(); // 0: opening, 1: game/set/match, 2: everything else
  const vocabulary = new Set([...NUMBER_WORDS, ...DMO_COMMENTARY_VOCABULARY]);
  const add = (cue, rank) => {
    const key = `${cue.voice}|${cue.text}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    priority.set(key, Math.min(priority.get(key) ?? 2, rank));
    for (const word of dmoCommentaryWords(cue.text)) vocabulary.add(word);
  };
  if (!names?.[0] || !names?.[1]) return { version: DMO_PHRASEBOOK_VERSION, lines: [], vocabulary: [] };

  for (let index = 0; index < simulations; index += 1) {
    // Vary how dominant the serve is so breaks, holds and long sets all appear.
    const serveWinRate = 0.52 + (index % 5) * 0.04;
    const points = simulateDmoCommentaryMatch(7_001 + index * 13, { bestOf, serveWinRate });
    const script = buildDmoCommentaryScript({ names, points, fps: 30, tournament, surface, round, context });
    for (const cue of script.cues) add(cue, cue.kind === 'opening' ? 0 : cue.kind === 'game' ? 1 : 2);
  }

  // The pre-match facts may be read by either voice in a live match.
  const facts = context ? buildDmoCommentaryFacts({ names, context }) : '';
  if (facts) {
    for (const voice of Object.values(DMO_COMMENTARY_VOICES)) add({ voice, text: facts }, 0);
  }

  const lines = [...counts.keys()]
    .sort((a, b) => (priority.get(a) - priority.get(b)) || (counts.get(b) - counts.get(a)) || (a < b ? -1 : 1))
    .slice(0, size)
    .map((key) => {
      const separator = key.indexOf('|');
      return { voice: key.slice(0, separator), speed: DMO_COMMENTARY_SPEED, text: key.slice(separator + 1) };
    });
  return { version: DMO_PHRASEBOOK_VERSION, lines, vocabulary: [...vocabulary].sort() };
}

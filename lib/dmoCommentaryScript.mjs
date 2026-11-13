/**
 * The full commentary script for a recorded replay.
 *
 * A replay never changes, so everything the booth will say can be decided
 * once: which line, which voice, and at which frame. The script is built on
 * the server, each line is turned into audio once and stored, and viewers
 * simply play the stored clips at their frames. Nothing is generated on the
 * viewer's device.
 *
 * The rules mirror the live booth (useDmoCommentary): the same lines, the
 * same speaker order, the same gaps between calls, game and set endings never
 * dropped, and replies only where the live booth would make them.
 */

import {
  buildDmoCommentaryFacts,
  buildDmoCommentaryFollowUp,
  buildDmoCommentaryIntroduction,
  buildDmoJoinCommentary,
  buildDmoCommentaryOpeningReply,
  buildDmoCommentaryScoreReply,
  buildDmoMatchCommentary,
  buildDmoPointCommentary,
  dmoPressureAfterPoint,
  isDmoGameEnding,
  summarizeDmoCommentaryStats,
  withDmoCommentaryHistory,
} from './dmoCommentary.mjs';

/** Bump when the rules change, so stored scripts are rebuilt. */
export const DMO_COMMENTARY_SCRIPT_VERSION = 3;
export const DMO_COMMENTARY_VOICES = Object.freeze({ female: 'af_heart', male: 'am_michael' });
export const DMO_COMMENTARY_SPEED = 1.03;

/** Kokoro at this speed speaks roughly 2.6 words a second. */
export function estimateDmoSpeechSeconds(text) {
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean).length;
  return words / 2.6 + 0.4;
}

/** Games in a score label such as "5-4(30-15)". */
function gamesIn(label) {
  const match = String(label ?? '').match(/^\s*(\d+)\s*[-–]\s*(\d+)/);
  return match ? [Number(match[1]), Number(match[2])] : null;
}

/** The score once this game-ending point is over: sets won and games. */
function scoreAfterGame(point) {
  const before = point.setsWonBefore;
  if (!Array.isArray(before) || before.length !== 2) return null;
  const setEnded = Number.isInteger(point.setBefore) && point.setAfter === point.setBefore + 1;
  const setsWon = [...before];
  if (setEnded) setsWon[point.winner - 1] += 1;
  const games = setEnded ? [0, 0] : gamesIn(point.scoreAfterLabel);
  return games ? { setsWon, games } : null;
}

function isPriorityCall(line) {
  return /\b(?:break|game|set|match|momentum)\b/i.test(line);
}

/**
 * @param {{
 *   names: readonly [string, string],
 *   points: readonly object[],          // from buildDmoReplayCommentaryPoints
 *   fps?: number,
 *   tournament?: string,
 *   surface?: string,
 *   round?: string,
 *   context?: object | null,            // WTSL rankings / head-to-head
 * }} input
 * @returns {{ version: number, fps: number, cues: Array<{
 *   at: number | null, speaker: 'female' | 'male', voice: string, speed: number,
 *   text: string, kind: string, group: number, mustPlay: boolean
 * }> }}
 */
export function buildDmoCommentaryScript({
  names,
  points,
  fps = 30,
  tournament = '',
  surface = '',
  round = '',
  context = null,
}) {
  const rate = Number.isFinite(fps) && fps > 0 ? fps : 30;
  const seconds = (frames) => frames / rate;
  const frames = (time) => Math.round(time * rate);
  const cues = [];
  const recent = [];
  let group = 0;
  let busyUntil = 0; // seconds of replay time
  let lastSpeechEnd = -Infinity;

  const say = (lines, { atSeconds, firstSpeaker, kind, mustPlay = false, timed = true }) => {
    group += 1;
    let time = atSeconds;
    lines.forEach((text, index) => {
      if (!text) return;
      const speaker = index % 2 === 0 ? firstSpeaker : (firstSpeaker === 'female' ? 'male' : 'female');
      cues.push({
        at: timed ? frames(time) : null,
        speaker,
        voice: DMO_COMMENTARY_VOICES[speaker],
        speed: DMO_COMMENTARY_SPEED,
        text,
        kind,
        group,
        mustPlay,
      });
      recent.unshift(text);
      time += estimateDmoSpeechSeconds(text) + 0.3;
    });
    busyUntil = time;
    lastSpeechEnd = time;
  };

  if (!names?.[0] || !names?.[1]) return { version: DMO_COMMENTARY_SCRIPT_VERSION, fps: rate, cues };

  // The opening plays whenever the viewer turns commentary on.
  const introduction = buildDmoCommentaryIntroduction({ names, tournament, surface, round });
  const openingReply = buildDmoCommentaryOpeningReply({ names, recentLines: recent });
  say([introduction, openingReply], { atSeconds: 0, firstSpeaker: 'female', kind: 'opening', timed: false });
  // During playback the opening takes no replay time; reset the clock.
  busyUntil = 0;
  lastSpeechEnd = -Infinity;
  const openingFacts = context ? buildDmoCommentaryFacts({ names, context }) : '';
  let factsPending = Boolean(openingFacts);
  let lastStatsPoint = 0;

  const ordered = [...points]
    .filter((point) => Number.isInteger(point?.frame) && point.frame >= 0)
    .sort((a, b) => a.frame - b.frame);

  ordered.forEach((point, index) => {
    const pointNumber = Number.isInteger(point.number) ? point.number : index + 1;
    const end = seconds(point.frame);
    const enriched = withDmoCommentaryHistory({ ...point, suppressRallyCommentary: false }, ordered);
    const mustDeliver = isDmoGameEnding(enriched);

    // Where the match stands after this game, for viewers who turn
    // commentary on later. Not part of the running commentary.
    const after = mustDeliver && point.matchOver !== true ? scoreAfterGame(point) : null;
    const join = after ? buildDmoJoinCommentary({ names, tournament, ...after, number: pointNumber }) : '';
    if (join) {
      group += 1;
      cues.push({
        at: point.frame,
        speaker: 'female',
        voice: DMO_COMMENTARY_VOICES.female,
        speed: DMO_COMMENTARY_SPEED,
        text: join,
        kind: 'join',
        group,
        mustPlay: false,
      });
    }
    const line = buildDmoPointCommentary(enriched, names, recent);
    const firstSpeaker = pointNumber % 2 === 0 ? 'male' : 'female';

    if (line) {
      const reply = mustDeliver
        ? buildDmoCommentaryScoreReply({ names, point: enriched, recentLines: recent })
        : dmoPressureAfterPoint(enriched)
          ? ''
          : buildDmoCommentaryFollowUp({ names, point: enriched, leadLine: line, recentLines: recent });
      const priority = isPriorityCall(line);
      const gap = priority ? 2 : pointNumber <= 8 ? 8 : 10;
      const maxWait = priority ? 8 : 9;
      const start = Math.max(end + 0.25, busyUntil, mustDeliver ? 0 : lastSpeechEnd + gap);
      if (mustDeliver || start - end <= maxWait) {
        say(reply ? [line, reply] : [line], {
          atSeconds: start,
          firstSpeaker,
          kind: mustDeliver ? 'game' : 'point',
          mustPlay: mustDeliver,
        });
        return;
      }
    }

    // A quiet moment between points: background facts first, then a
    // statistics update roughly every 30 points.
    const quietStart = end + 2;
    if (quietStart - lastSpeechEnd < 12 || quietStart < busyUntil) return;
    if (factsPending) {
      factsPending = false;
      say([openingFacts], { atSeconds: quietStart, firstSpeaker: 'female', kind: 'facts' });
      return;
    }
    if (pointNumber - lastStatsPoint >= 30 && quietStart - lastSpeechEnd >= 15) {
      lastStatsPoint = pointNumber;
      const stats = buildDmoMatchCommentary({
        names,
        stats: summarizeDmoCommentaryStats(ordered.slice(0, index + 1)),
      });
      if (stats) {
        say([stats], {
          atSeconds: quietStart,
          firstSpeaker: pointNumber % 2 === 0 ? 'female' : 'male',
          kind: 'stats',
        });
      }
    }
  });

  return { version: DMO_COMMENTARY_SCRIPT_VERSION, fps: rate, cues };
}

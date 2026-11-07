import type { LiveCourtMotionEvent, LiveCourtSample } from './liveCourtMotion';
import { cancelXktUmpireCalls, playXktUmpireCall } from './xktUmpireAudio';

let browserUmpireSpeechUnlocked = false;
const activeXktUmpireContexts = new Map<string, BaseAudioContext>();
let activeBrowserUmpireMatchKey: string | null = null;

export function liveUmpireMatchKey(players: [string, string], isWta: boolean) {
  const pair = players
    .map((name) => name.trim().normalize('NFKC').toLocaleLowerCase('en-GB'))
    .sort();
  return `${isWta ? 'wta' : 'atp'}:${pair.join('|')}`;
}

export type UmpireCallEvent = {
  frame: number;
  kind: 'score' | 'point-end' | 'out';
  text: string;
};

export type UmpireScore = {
  sets: [number, number][];
  games: [number, number];
  pointText: [string, string];
  tiebreak: boolean;
  server: 1 | 2 | null;
} | null;

export type LiveUmpireScoreTether = {
  previousScore: UmpireScore;
  hasObservedScore: boolean;
  pendingScoreCalls: string[];
  waitingForDmoPointEnd: boolean;
};

// Keep the current score change and at most the one immediately before it.
export const MAX_LIVE_UMPIRE_SCORE_LAG_POINTS = 1;
const MAX_PENDING_LIVE_UMPIRE_SCORE_CALLS = MAX_LIVE_UMPIRE_SCORE_LAG_POINTS + 1;

type UmpireSoundEvent = { frame: number; kind: string };

function scorePair(scoreLabel: string): [string, string] | null {
  const pointScore = scoreLabel.match(/\(([^()]*)\)\s*$/)?.[1] ?? scoreLabel;
  const normalized = pointScore.trim().toUpperCase();
  if (normalized === 'DEUCE') return ['40', '40'];
  const advantage = normalized.match(/^AD\s*([12])$/);
  if (advantage) return advantage[1] === '1' ? ['AD', '40'] : ['40', 'AD'];
  const match = normalized.match(/^(AD|ADV|A|\d+)\s*[-–]\s*(AD|ADV|A|\d+)$/);
  return match ? [match[1].toUpperCase(), match[2].toUpperCase()] : null;
}

function numberWord(value: number): string {
  const words = [
    'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
    'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen',
    'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty',
  ];
  return Number.isInteger(value) && value >= 0 && value < words.length
    ? words[value]
    : String(value);
}

function pointWord(value: string, tiebreak: boolean): string {
  if (value === 'AD' || value === 'ADV' || value === 'A') return 'advantage';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '';
  if (tiebreak) return numberWord(numeric);
  if (numeric === 0) return 'love';
  if (numeric === 15) return 'fifteen';
  if (numeric === 30) return 'thirty';
  if (numeric === 40) return 'forty';
  return numberWord(numeric);
}

export function formatTennisPointScoreCall(
  scoreLabel: string | undefined,
  server: 1 | 2 | null,
  players: [string, string],
  tiebreak?: boolean,
): string | null {
  if (!scoreLabel || scoreLabel.length > 120) return null;
  const pair = scorePair(scoreLabel);
  if (!pair) return null;
  const isTiebreak = tiebreak
    ?? pair.some((value) => !['0', '15', '30', '40', 'AD', 'ADV', 'A'].includes(value));

  if (!isTiebreak && pair[0] === '40' && pair[1] === '40') return 'Deuce';
  if (pair[0] === 'AD' || pair[0] === 'ADV' || pair[0] === 'A') {
    return `Advantage, ${players[0]}`;
  }
  if (pair[1] === 'AD' || pair[1] === 'ADV' || pair[1] === 'A') {
    return `Advantage, ${players[1]}`;
  }

  const ordered = !isTiebreak && server === 2 ? [pair[1], pair[0]] : pair;
  const first = pointWord(ordered[0], isTiebreak);
  const second = pointWord(ordered[1], isTiebreak);
  if (!first || !second) return null;
  return ordered[0] === ordered[1] ? `${first}-all` : `${first}-${second}`;
}

export function formatLiveUmpireScoreCall(
  current: UmpireScore,
  previous: UmpireScore,
  players: [string, string],
): string | null {
  if (!current) return null;
  if (previous) {
    if (current.sets.length > previous.sets.length) {
      const completedSet = current.sets.at(-1);
      const winner = completedSet
        ? completedSet[0] > completedSet[1] ? 0 : completedSet[1] > completedSet[0] ? 1 : null
        : null;
      if (winner !== null) return formatUmpireSetCall(current.sets.length, players[winner]);
    }
    if (current.games[0] > previous.games[0]) return `Game, ${players[0]}`;
    if (current.games[1] > previous.games[1]) return `Game, ${players[1]}`;
  }
  return formatTennisPointScoreCall(
    current.pointText.join('-'),
    current.server,
    players,
    current.tiebreak,
  );
}

const SET_ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth'] as const;

export function formatUmpireSetCall(setNumber: number, winnerName: string): string {
  const ordinal = SET_ORDINALS[setNumber - 1];
  return ordinal
    ? `Game and ${ordinal} set, ${winnerName}`
    : `Game and set, ${winnerName}`;
}

export function sameUmpireScore(first: UmpireScore, second: UmpireScore): boolean {
  if (!first || !second) return first === second;
  return first.sets.length === second.sets.length
    && first.sets.every((set, index) =>
      set[0] === second.sets[index][0] && set[1] === second.sets[index][1])
    && first.games[0] === second.games[0]
    && first.games[1] === second.games[1]
    && first.pointText[0] === second.pointText[0]
    && first.pointText[1] === second.pointText[1]
    && first.tiebreak === second.tiebreak
    && first.server === second.server;
}

export function createLiveUmpireScoreTether(): LiveUmpireScoreTether {
  return {
    previousScore: null,
    hasObservedScore: false,
    pendingScoreCalls: [],
    waitingForDmoPointEnd: false,
  };
}

export function resetLiveUmpireScoreTether(tether: LiveUmpireScoreTether): void {
  tether.previousScore = null;
  tether.hasObservedScore = false;
  tether.pendingScoreCalls = [];
  tether.waitingForDmoPointEnd = false;
}

export function observeLiveUmpireScore(
  tether: LiveUmpireScoreTether,
  current: UmpireScore,
  players: [string, string],
  shouldSpeak: boolean,
): string | null {
  if (!shouldSpeak) {
    tether.previousScore = current;
    tether.hasObservedScore = Boolean(current);
    tether.pendingScoreCalls = [];
    tether.waitingForDmoPointEnd = false;
    return null;
  }
  if (!current) {
    resetLiveUmpireScoreTether(tether);
    return null;
  }

  const previous = tether.previousScore;
  const firstObservation = !tether.hasObservedScore;
  tether.previousScore = current;
  tether.hasObservedScore = true;
  if (firstObservation || !previous || sameUmpireScore(current, previous)) {
    if (firstObservation) {
      tether.pendingScoreCalls = [];
      tether.waitingForDmoPointEnd = false;
    }
    return null;
  }

  const call = formatLiveUmpireScoreCall(current, previous, players);
  if (!call) {
    tether.waitingForDmoPointEnd = false;
    return null;
  }
  if (tether.waitingForDmoPointEnd) {
    tether.waitingForDmoPointEnd = false;
    return call;
  }

  tether.pendingScoreCalls.push(call);
  if (tether.pendingScoreCalls.length > MAX_PENDING_LIVE_UMPIRE_SCORE_CALLS) {
    // Drop stale speech instead of letting a delayed DMO feed create a long backlog.
    tether.pendingScoreCalls.splice(
      0,
      tether.pendingScoreCalls.length - MAX_PENDING_LIVE_UMPIRE_SCORE_CALLS,
    );
  }
  return null;
}

export function matchLiveUmpireScoreToDmoPointEnd(
  tether: LiveUmpireScoreTether,
  shouldSpeak: boolean,
): string | null {
  if (!shouldSpeak) {
    tether.pendingScoreCalls = [];
    tether.waitingForDmoPointEnd = false;
    return null;
  }
  const call = tether.pendingScoreCalls.shift();
  if (call) return call;
  // Keep only the latest unmatched DMO event; never replay a long audio backlog.
  tether.waitingForDmoPointEnd = true;
  return null;
}

function lowerBoundFrame<T extends { frame: number }>(events: T[], frame: number): number {
  let low = 0;
  let high = events.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (events[middle].frame < frame) low = middle + 1;
    else high = middle;
  }
  return low;
}

function nearestSample(
  samples: LiveCourtSample[],
  frame: number,
  maxDistance: number,
): LiveCourtSample | null {
  const index = lowerBoundFrame(samples, frame);
  const after = samples[index];
  const before = samples[index - 1];
  const nearest = !before ? after
    : !after ? before
      : frame - before.frame <= after.frame - frame ? before : after;
  return nearest && Math.abs(nearest.frame - frame) <= maxDistance ? nearest : null;
}

export function deriveUmpireCallEvents(
  trajectoryEvents: LiveCourtMotionEvent[],
  soundEvents: UmpireSoundEvent[],
  samples: LiveCourtSample[],
): UmpireCallEvent[] {
  const calls: UmpireCallEvent[] = [];
  for (const event of trajectoryEvents) {
    if (event.kind === 'point-end') {
      const scoreCall = event.scoreCall?.trim();
      calls.push({
        frame: event.frame,
        kind: scoreCall ? 'score' : 'point-end',
        text: scoreCall ?? '',
      });
    }
  }

  const checkedPointEnds = new Set<number>();
  const bounces = soundEvents
    .filter((event) => event.kind === 'bounce')
    .sort((first, second) => first.frame - second.frame);
  for (const bounce of bounces) {
    const eventIndex = lowerBoundFrame(trajectoryEvents, bounce.frame);
    let previousShot: LiveCourtMotionEvent | undefined;
    for (let index = eventIndex - 1; index >= 0; index -= 1) {
      if (trajectoryEvents[index].kind === 'shot') {
        previousShot = trajectoryEvents[index];
        break;
      }
    }
    if (!previousShot || previousShot.shotType !== 'rally') continue;

    let pointEnd: LiveCourtMotionEvent | undefined;
    let laterShot = false;
    for (let index = eventIndex; index < trajectoryEvents.length; index += 1) {
      const event = trajectoryEvents[index];
      if (event.kind === 'shot') {
        laterShot = true;
        break;
      }
      if (event.kind === 'point-end') {
        pointEnd = event;
        break;
      }
    }
    if (
      laterShot
      || !pointEnd
      || pointEnd.frame < bounce.frame
      || pointEnd.frame - bounce.frame > 120
    ) continue;

    // Multiple reconstructed bounces can follow the point-ending contact.
    // Only the first bounce associated with a point may determine an out call.
    if (checkedPointEnds.has(pointEnd.frame)) continue;
    checkedPointEnds.add(pointEnd.frame);

    const sample = nearestSample(samples, bounce.frame, 4);
    if (!sample || sample.values[2] > 30) continue;
    // Use the outer doubles sideline as the shared bound: the live snapshot
    // does not always identify whether the match is singles or doubles.
    const outsideCourt = Math.abs(sample.values[0]) > 1_201
      || Math.abs(sample.values[1]) > 560;
    if (outsideCourt) calls.push({ frame: bounce.frame, kind: 'out', text: 'Out' });
  }

  const unique = new Map<string, UmpireCallEvent>();
  for (const call of calls) unique.set(`${call.frame}:${call.kind}`, call);
  const priority = { out: 0, 'point-end': 1, score: 2 };
  return [...unique.values()].sort((first, second) =>
    first.frame - second.frame || priority[first.kind] - priority[second.kind],
  );
}

export function umpireCallsBetween(
  events: UmpireCallEvent[],
  afterFrame: number,
  throughFrame: number,
): UmpireCallEvent[] {
  if (throughFrame <= afterFrame) return [];
  const start = lowerBoundFrame(events, Math.floor(afterFrame) + 1);
  const result: UmpireCallEvent[] = [];
  for (let index = start; index < events.length && events[index].frame <= throughFrame; index += 1) {
    result.push(events[index]);
  }
  return result;
}

export function speakBrowserUmpireCall(text: string): boolean {
  if (
    !text.trim()
    || typeof window === 'undefined'
    || typeof window.speechSynthesis?.speak !== 'function'
    || typeof SpeechSynthesisUtterance === 'undefined'
  ) {
    return false;
  }
  try {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-GB';
    utterance.rate = 1;
    utterance.pitch = 0.95;
    utterance.volume = 0.9;
    window.speechSynthesis.speak(utterance);
    return true;
  } catch {
    return false;
  }
}

export function unlockBrowserUmpireSpeech(): boolean {
  if (
    typeof window === 'undefined'
    || typeof window.speechSynthesis?.speak !== 'function'
    || typeof SpeechSynthesisUtterance === 'undefined'
  ) {
    return false;
  }
  try {
    // iOS Safari requires speechSynthesis.speak() to run within a user gesture.
    // A silent, whitespace utterance unlocks later DMO-timed calls without commentary.
    const utterance = new SpeechSynthesisUtterance('\u00a0');
    utterance.lang = 'en-GB';
    utterance.volume = 0;
    window.speechSynthesis.speak(utterance);
    browserUmpireSpeechUnlocked = true;
    return true;
  } catch {
    return false;
  }
}

export async function resumeUmpireAudioContext(
  context: Pick<AudioContext, 'state' | 'resume'>,
): Promise<boolean> {
  if (context.state === 'running') return true;
  try {
    await context.resume();
  } catch {
    return false;
  }
  const resumedState = context.state as AudioContextState;
  return resumedState === 'running';
}

export async function speakUmpireCall(
  text: string,
  context: BaseAudioContext | null | undefined,
  isWta: boolean,
  shouldSpeak: () => boolean = () => true,
  matchKey = 'default',
): Promise<boolean> {
  const activeContext = activeXktUmpireContexts.get(matchKey);
  if (activeContext && activeContext !== context) {
    cancelXktUmpireCalls(activeContext);
    activeXktUmpireContexts.delete(matchKey);
  }
  if (activeBrowserUmpireMatchKey === matchKey) cancelBrowserUmpireCall(matchKey);

  if (!context || !shouldSpeak()) return false;
  activeXktUmpireContexts.set(matchKey, context);
  const spoken = await playXktUmpireCall(context, text, isWta);
  if (!spoken && activeXktUmpireContexts.get(matchKey) === context) {
    cancelXktUmpireCalls(context);
    activeXktUmpireContexts.delete(matchKey);
  }
  return spoken;
}

export function isBrowserUmpireSpeechUnlocked(): boolean {
  return browserUmpireSpeechUnlocked;
}

export function cancelBrowserUmpireCall(matchKey?: string): void {
  if (matchKey && activeBrowserUmpireMatchKey !== matchKey) return;
  if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
  activeBrowserUmpireMatchKey = null;
}

export function cancelUmpireCall(
  context: BaseAudioContext | null | undefined,
  matchKey?: string,
): void {
  if (matchKey) {
    const activeContext = activeXktUmpireContexts.get(matchKey);
    if (activeContext && (!context || context === activeContext)) {
      cancelXktUmpireCalls(activeContext);
      activeXktUmpireContexts.delete(matchKey);
    }
    cancelBrowserUmpireCall(matchKey);
    if (context && activeContext !== context) cancelXktUmpireCalls(context);
    return;
  }
  cancelBrowserUmpireCall();
  cancelXktUmpireCalls(context);
  for (const [key, active] of activeXktUmpireContexts) {
    if (!context || active === context) activeXktUmpireContexts.delete(key);
  }
}

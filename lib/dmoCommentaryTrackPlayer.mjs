/**
 * Plays a replay's stored commentary track.
 *
 * Every line already exists as a stored clip, so this only has to download
 * clips a little ahead of the replay position and start each one at its
 * frame. Lines that would arrive late are dropped (a call about a point the
 * viewer has moved past is worse than silence), except game, set and match
 * calls, which get a longer allowance. A call and its reply share a group, so
 * a dropped call never leaves an orphaned reply.
 */

const DEFAULT_LOOK_AHEAD = 6;
const STALE_SECONDS = 4;
const MUST_PLAY_STALE_SECONDS = 15;
const MAX_CONSECUTIVE_FAILURES = 3;
/** A clip that failed to download is not requested again for this long. */
const RETRY_AFTER_MS = 5_000;
/** The bot asks callers to retry a busy speech worker after three seconds. */
const BOT_BUSY_RETRY_AFTER_MS = 3_000;
/** How long an opening or score summary may keep later calls waiting. */
const UNTIMED_WAIT_MS = 6_000;
/** On start or after a seek, clips this far ahead are requested at once. */
const WINDOW_SECONDS = 90;
const WINDOW_MAX_CLIPS = 12;

/**
 * @param {{
 *   cues: Array<{ at: number | null, clip: string, group: number, mustPlay?: boolean, kind?: string }>,
 *   fps?: number,
 *   loadClip: (clip: string) => Promise<unknown>,
 *   playClip: (audio: unknown) => Promise<void>,
 *   onState?: (state: 'starting' | 'on' | 'unavailable') => void,
 *   onPosition?: (frame: number) => void,
 *   lookAhead?: number,
 * }} options
 */
export function createDmoCommentaryTrackPlayer({
  cues,
  fps = 30,
  loadClip,
  playClip,
  onState,
  onPosition,
  lookAhead = DEFAULT_LOOK_AHEAD,
  now = () => Date.now(),
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const rate = Number.isFinite(fps) && fps > 0 ? fps : 30;
  const opening = cues.filter((cue) => cue.at === null);
  // Score summaries for joining part-way; never part of the running commentary.
  const joins = cues.filter((cue) => cue.kind === 'join' && Number.isFinite(cue.at))
    .sort((a, b) => a.at - b.at);
  const timed = cues.filter((cue) => Number.isFinite(cue.at) && cue.kind !== 'join')
    .sort((a, b) => a.at - b.at);
  /** The latest score summary at or before this frame, if a game has finished. */
  const joinAt = (position) => {
    let found = null;
    for (const cue of joins) {
      if (cue.at > position) break;
      found = cue;
    }
    return found;
  };
  const loaded = new Map();
  const failedAt = new Map();
  let queue = [];
  let pointer = 0;
  let frame = 0;
  let playing = false;
  let busy = false;
  let stopped = false;
  let state = '';
  let failures = 0;

  const setState = (next) => {
    if (state === next || stopped) return;
    state = next;
    onState?.(next);
  };

  const recentlyFailed = (clip) => {
    const failure = failedAt.get(clip);
    if (!failure) return false;
    const cooldown = failure.busy ? BOT_BUSY_RETRY_AFTER_MS : RETRY_AFTER_MS;
    return now() - failure.at < cooldown;
  };

  const load = (cue) => {
    let pending = loaded.get(cue.clip);
    if (!pending) {
      // Never hammer the server: a clip that just failed fails again at once.
      if (recentlyFailed(cue.clip)) {
        const error = new Error('Recently unavailable');
        if (failedAt.get(cue.clip)?.busy) error.busy = true;
        return Promise.reject(error);
      }
      pending = Promise.resolve().then(() => loadClip(cue.clip));
      loaded.set(cue.clip, pending);
      pending.then(() => failedAt.delete(cue.clip), (error) => {
        failedAt.set(cue.clip, { at: now(), busy: Boolean(error?.busy) });
        if (loaded.get(cue.clip) === pending) loaded.delete(cue.clip);
      });
      // Keep memory bounded: decoded audio for clips well behind us goes.
      while (loaded.size > lookAhead * 4) loaded.delete(loaded.keys().next().value);
    }
    return pending;
  };

  /**
   * Ask for every clip in the next stretch of the replay at once, so lines
   * the server hasn't stored yet are being made before they're due.
   */
  const prefetchWindow = () => {
    let count = 0;
    for (let index = pointer; index < timed.length && count < WINDOW_MAX_CLIPS; index += 1) {
      const cue = timed[index];
      if ((cue.at - frame) / rate > WINDOW_SECONDS) break;
      if (!recentlyFailed(cue.clip)) load(cue).catch(() => {});
      count += 1;
    }
    onPosition?.(frame);
  };

  /**
   * How long the head of the queue may hold up the rest. A timed call waits
   * only until it would be too late to say; an opening or score summary
   * waits a few seconds. Either way the download carries on, so the clip is
   * ready if it comes round again.
   */
  const waitLimitMs = (cue) => {
    if (cue.at === null) return UNTIMED_WAIT_MS;
    const allowance = cue.mustPlay ? MUST_PLAY_STALE_SECONDS : STALE_SECONDS;
    const behind = playing ? (frame - cue.at) / rate : 0;
    return Math.max(500, (allowance - behind) * 1000);
  };

  const TIMED_OUT = Symbol('timed out');
  const loadWithin = async (cue) => {
    const limit = Promise.resolve(wait(waitLimitMs(cue))).then(() => TIMED_OUT);
    return Promise.race([load(cue), limit]);
  };

  const isStale = (cue) => cue.at !== null
    && (frame - cue.at) / rate > (cue.mustPlay ? MUST_PLAY_STALE_SECONDS : STALE_SECONDS);

  const dropGroup = (group) => {
    queue = queue.filter((cue) => cue.group !== group);
  };

  const prefetch = () => {
    const upcoming = [...queue, ...timed.slice(pointer, pointer + lookAhead)];
    for (const cue of upcoming.slice(0, lookAhead)) {
      if (!recentlyFailed(cue.clip)) load(cue).catch(() => {});
    }
  };

  const reposition = () => {
    pointer = timed.findIndex((cue) => cue.at > frame);
    if (pointer === -1) pointer = timed.length;
    queue = queue.filter((cue) => cue.at === null);
  };

  async function pump() {
    if (busy || stopped) return;
    while (queue.length && isStale(queue[0])) dropGroup(queue[0].group);
    const cue = queue[0];
    // The opening plays as soon as commentary starts, even while paused;
    // timed calls wait for playback.
    const mayPlay = (candidate) => playing || candidate.at === null;
    if (!cue || !mayPlay(cue)) return;
    busy = true;
    try {
      let audio;
      try {
        audio = await loadWithin(cue);
      } catch (error) {
        if (error?.busy) {
          // The bot is making another line: skip this one quietly, like a
          // clip that is still on its way. Not a sign commentary is broken.
          if (cue.at === null || isStale(cue)) dropGroup(cue.group);
          return;
        }
        failures += 1;
        dropGroup(cue.group);
        // Before anything has played, a failure means commentary isn't
        // reachable: say so at once rather than leaving "starting" showing.
        if (failures >= MAX_CONSECUTIVE_FAILURES || state !== 'on') setState('unavailable');
        return;
      }
      if (stopped || queue[0] !== cue) return;
      if (audio === TIMED_OUT) {
        // Still being made: skip it rather than hold up the calls behind it.
        // Not a failure, so the button doesn't flip to unavailable.
        // Paused, or not yet late: leave it queued for the next update.
        if (cue.at === null || isStale(cue)) dropGroup(cue.group);
        return;
      }
      if (isStale(cue)) {
        dropGroup(cue.group);
        return;
      }
      if (!mayPlay(cue)) return; // Resumes from update() when playback continues.
      queue.shift();
      failures = 0;
      setState('on');
      try {
        await playClip(audio);
      } catch {
        failures += 1;
        if (failures >= MAX_CONSECUTIVE_FAILURES) setState('unavailable');
      }
    } finally {
      busy = false;
    }
    void pump();
  }

  return {
    /** Begin at the current replay position: the opening first, then upcoming calls. */
    start(currentFrame, isPlaying = true) {
      frame = currentFrame;
      playing = isPlaying;
      reposition();
      // Starting after the first game: where the match stands, not an
      // opening that says play is just beginning.
      const join = joinAt(frame);
      queue = join ? [{ ...join, at: null }] : [...opening];
      setState('starting');
      prefetchWindow();
      prefetch();
      void pump();
    },
    /** Call whenever the replay frame or play state changes. */
    update(currentFrame, isPlaying) {
      if (stopped) return;
      const jumped = currentFrame < frame - rate || currentFrame > frame + rate * 10;
      const bigJump = Math.abs(currentFrame - frame) > rate * 10;
      frame = currentFrame;
      playing = isPlaying;
      if (jumped) {
        reposition();
        // After a real seek, say where the match now stands.
        const join = bigJump ? joinAt(frame) : null;
        if (join) queue = [{ ...join, at: null }];
        prefetchWindow();
      }
      while (pointer < timed.length && timed[pointer].at <= frame) queue.push(timed[pointer++]);
      prefetch();
      void pump();
    },
    stop() {
      stopped = true;
      queue = [];
      loaded.clear();
    },
    get state() {
      return state;
    },
  };
}

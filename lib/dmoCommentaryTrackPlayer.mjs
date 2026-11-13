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

/**
 * @param {{
 *   cues: Array<{ at: number | null, clip: string, group: number, mustPlay?: boolean, kind?: string }>,
 *   fps?: number,
 *   loadClip: (clip: string) => Promise<unknown>,
 *   playClip: (audio: unknown) => Promise<void>,
 *   onState?: (state: 'starting' | 'on' | 'unavailable') => void,
 *   lookAhead?: number,
 * }} options
 */
export function createDmoCommentaryTrackPlayer({
  cues,
  fps = 30,
  loadClip,
  playClip,
  onState,
  lookAhead = DEFAULT_LOOK_AHEAD,
  now = () => Date.now(),
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

  const recentlyFailed = (clip) => now() - (failedAt.get(clip) ?? -Infinity) < RETRY_AFTER_MS;

  const load = (cue) => {
    let pending = loaded.get(cue.clip);
    if (!pending) {
      // Never hammer the server: a clip that just failed fails again at once.
      if (recentlyFailed(cue.clip)) return Promise.reject(new Error('Recently unavailable'));
      pending = Promise.resolve().then(() => loadClip(cue.clip));
      loaded.set(cue.clip, pending);
      pending.then(() => failedAt.delete(cue.clip), () => {
        failedAt.set(cue.clip, now());
        if (loaded.get(cue.clip) === pending) loaded.delete(cue.clip);
      });
      // Keep memory bounded: decoded audio for clips well behind us goes.
      while (loaded.size > lookAhead * 4) loaded.delete(loaded.keys().next().value);
    }
    return pending;
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
        audio = await load(cue);
      } catch {
        failures += 1;
        dropGroup(cue.group);
        // Before anything has played, a failure means commentary isn't
        // reachable: say so at once rather than leaving "starting" showing.
        if (failures >= MAX_CONSECUTIVE_FAILURES || state !== 'on') setState('unavailable');
        return;
      }
      if (stopped || queue[0] !== cue) return;
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

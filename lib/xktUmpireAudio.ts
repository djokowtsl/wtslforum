export type XktUmpireAudioIndex = {
  pointScores: Record<string, string[]>;
  tiebreakScores: Record<string, string[]>;
  gameCalls: string[];
  setCalls: string[];
};

export type XktPlayerNameAudioIndex = {
  atp: Record<string, string>;
  wta: Record<string, string>;
};

type VoiceQueue = {
  generation: number;
  calls: AudioBuffer[][];
  active: AudioBufferSourceNode | null;
};

const UMPIRE_INDEX_URL = '/audio/xkt/umpire-index.json';
const PLAYER_NAME_INDEX_URL = '/audio/xkt/name-index.json';
const AUTOMATED_LINE_CALLS: Record<string, string> = {
  fault: '/audio/xkt/line-calls/fault.mp3',
  out: '/audio/xkt/line-calls/out.mp3',
};
const ATP_OUT_CALLS = [
  '/audio/xkt/line-calls/atp-out-01.mp3',
  '/audio/xkt/line-calls/atp-out-02.mp3',
  '/audio/xkt/line-calls/atp-out-03.mp3',
  '/audio/xkt/line-calls/atp-out-04.mp3',
  '/audio/xkt/line-calls/atp-out-05.mp3',
  '/audio/xkt/line-calls/atp-out-06.mp3',
  '/audio/xkt/line-calls/atp-out-07.mp3',
  '/audio/xkt/line-calls/atp-out-08.mp3',
  '/audio/xkt/line-calls/atp-out-09.mp3',
];
const voiceQueues = new WeakMap<BaseAudioContext, VoiceQueue>();
const audioBuffers = new WeakMap<BaseAudioContext, Map<string, Promise<AudioBuffer>>>();
const manifestPromises = new Map<string, Promise<unknown>>();

function voiceQueue(context: BaseAudioContext) {
  let state = voiceQueues.get(context);
  if (!state) {
    state = { generation: 0, calls: [], active: null };
    voiceQueues.set(context, state);
  }
  return state;
}

function pick<T>(items: T[] | undefined, random: () => number): T | null {
  if (!items?.length) return null;
  const index = Math.min(items.length - 1, Math.floor(Math.max(0, random()) * items.length));
  return items[index] ?? null;
}

export function resolveAutomatedLineCallPath(
  text: string,
  isWta: boolean,
  random: () => number = Math.random,
): string | null {
  const call = text.trim().toLowerCase();
  if (call === 'out' && !isWta) return pick(ATP_OUT_CALLS, random);
  return AUTOMATED_LINE_CALLS[call] ?? null;
}

function normalizeName(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function resolvePlayerNameAudio(
  playerName: string,
  names: XktPlayerNameAudioIndex,
  isWta: boolean,
) {
  const normalized = normalizeName(playerName);
  const words = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  const candidates = [...new Set([
    normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    ...words.slice().reverse(),
  ])];
  const tours: Array<'atp' | 'wta'> = isWta ? ['wta', 'atp'] : ['atp', 'wta'];
  for (const tour of tours) {
    for (const key of candidates) {
      const url = names[tour][key];
      if (url) return url;
    }
  }
  return null;
}

/** Resolve the existing score-only call into matching XKT voice clips. */
export function resolveXktUmpireCallPaths(
  text: string,
  umpire: XktUmpireAudioIndex,
  names: XktPlayerNameAudioIndex,
  isWta: boolean,
  random: () => number = Math.random,
): string[] | null {
  const call = text.trim();
  if (!call) return null;

  const gameAndSet = call.match(/^Game and (first|second|third|fourth|fifth) set,\s*(.+)$/i);
  if (gameAndSet) {
    const setIndex = ['first', 'second', 'third', 'fourth', 'fifth'].indexOf(gameAndSet[1].toLowerCase());
    const name = resolvePlayerNameAudio(gameAndSet[2], names, isWta);
    const game = pick(umpire.gameCalls, random);
    const set = umpire.setCalls[setIndex];
    return game && set ? (name ? [game, set, name] : [game, set]) : null;
  }

  const game = call.match(/^Game,\s*(.+)$/i);
  if (game) {
    const name = resolvePlayerNameAudio(game[1], names, isWta);
    const gameClip = pick(umpire.gameCalls, random);
    return gameClip ? (name ? [gameClip, name] : [gameClip]) : null;
  }

  const advantage = call.match(/^Advantage,\s*(.+)$/i);
  if (advantage) {
    const name = resolvePlayerNameAudio(advantage[1], names, isWta);
    const scoreClip = pick(umpire.pointScores.advantage, random);
    return scoreClip ? (name ? [scoreClip, name] : [scoreClip]) : null;
  }

  if (/^deuce$/i.test(call)) {
    const clip = pick(umpire.pointScores.deuce, random);
    return clip ? [clip] : null;
  }

  const score = call.toLowerCase().match(/^([a-z]+|\d+)-([a-z]+|all|\d+)$/);
  if (!score) return null;
  const scoreWords: Record<string, string> = {
    love: '0',
    fifteen: '15',
    thirty: '30',
    forty: '40',
  };
  let left = scoreWords[score[1]] ?? score[1];
  let right = score[2] === 'all' ? left : scoreWords[score[2]] ?? score[2];

  if (/^\d+$/.test(score[1]) && /^\d+$/.test(score[2])) {
    const clip = pick(umpire.tiebreakScores[`${Number(left)}_${Number(right)}`], random);
    return clip ? [clip] : null;
  }

  if (!['0', '15', '30', '40'].includes(left) || !['0', '15', '30', '40'].includes(right)) {
    return null;
  }
  const clip = pick(umpire.pointScores[`${left}_${right}`], random);
  return clip ? [clip] : null;
}

async function loadManifest<T>(
  url: string,
  fetcher: (url: string) => Promise<Response>,
): Promise<T> {
  let pending = manifestPromises.get(url) as Promise<T> | undefined;
  if (!pending) {
    pending = fetcher(url).then(async response => {
      if (!response.ok) throw new Error(`Voice manifest unavailable: ${url}`);
      return await response.json() as T;
    });
    manifestPromises.set(url, pending);
    pending.catch(() => manifestPromises.delete(url));
  }
  return pending;
}

async function loadAudioBuffer(
  context: BaseAudioContext,
  url: string,
  fetcher: (url: string) => Promise<Response>,
) {
  let cache = audioBuffers.get(context);
  if (!cache) {
    cache = new Map();
    audioBuffers.set(context, cache);
  }
  let pending = cache.get(url);
  if (!pending) {
    pending = fetcher(url).then(async response => {
      if (!response.ok) throw new Error(`Voice sample unavailable: ${url}`);
      return context.decodeAudioData(await response.arrayBuffer());
    });
    cache.set(url, pending);
    pending.catch(() => cache?.delete(url));
  }
  return pending;
}

export async function preloadAutomatedLineCalls(
  context: BaseAudioContext,
  fetcher: (url: string) => Promise<Response> = url => fetch(url),
): Promise<void> {
  await Promise.all(Object.values(AUTOMATED_LINE_CALLS)
    .map(url => loadAudioBuffer(context, url, fetcher)));
}

function playCallSequence(
  context: BaseAudioContext,
  state: VoiceQueue,
  buffers: AudioBuffer[],
  index: number,
  generation: number,
) {
  if (generation !== state.generation) return;
  const buffer = buffers[index];
  if (!buffer) {
    const next = state.calls.shift();
    if (next) playCallSequence(context, state, next, 0, generation);
    return;
  }

  const source = context.createBufferSource();
  const gain = context.createGain();
  source.buffer = buffer;
  gain.gain.value = 0.88;
  source.connect(gain).connect(context.destination);
  state.active = source;
  source.onended = () => {
    source.disconnect();
    gain.disconnect();
    if (generation !== state.generation) return;
    state.active = null;
    if (index + 1 < buffers.length) {
      playCallSequence(context, state, buffers, index + 1, generation);
      return;
    }
    const next = state.calls.shift();
    if (next) playCallSequence(context, state, next, 0, generation);
  };
  source.start();
}

/** Play recorded XKT umpire clips; do not substitute a different browser voice. */
export async function playXktUmpireCall(
  context: BaseAudioContext,
  text: string,
  isWta: boolean,
  fetcher: (url: string) => Promise<Response> = url => fetch(url),
): Promise<boolean> {
  if (context.state !== 'running') return false;
  const state = voiceQueue(context);
  const generation = state.generation;
  try {
    // Electronic line calls are a separate voice, not an umpire or a
    // browser-speech fallback. They share the queue and master mute control.
    const lineCall = resolveAutomatedLineCallPath(text, isWta);
    let urls: string[] | null;
    if (lineCall) {
      urls = [lineCall];
    } else {
      const [umpire, names] = await Promise.all([
        loadManifest<XktUmpireAudioIndex>(UMPIRE_INDEX_URL, fetcher),
        loadManifest<XktPlayerNameAudioIndex>(PLAYER_NAME_INDEX_URL, fetcher),
      ]);
      urls = resolveXktUmpireCallPaths(text, umpire, names, isWta);
    }
    if (!urls || generation !== state.generation || context.state !== 'running') return false;
    const buffers = await Promise.all(urls.map(url => loadAudioBuffer(context, url, fetcher)));
    if (generation !== state.generation || context.state !== 'running') return false;
    if (state.active) state.calls.push(buffers);
    else playCallSequence(context, state, buffers, 0, generation);
    return true;
  } catch {
    return false;
  }
}

export function cancelXktUmpireCalls(context: BaseAudioContext | null | undefined) {
  if (!context) return;
  const state = voiceQueues.get(context);
  if (!state) return;
  state.generation += 1;
  state.calls = [];
  const active = state.active;
  state.active = null;
  if (!active) return;
  active.onended = null;
  try {
    active.stop();
  } catch {
    // The clip may have ended just before a rewind or toggle.
  }
  active.disconnect();
}

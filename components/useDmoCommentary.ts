'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildDmoCommentaryOpeningReply,
  buildDmoCommentaryFacts,
  buildDmoCommentaryIntroduction,
  buildDmoPointCommentary,
  buildDmoRallyCommentary,
  chooseDmoCommentaryVoices,
  rankDmoBrowserVoices,
  withDmoCommentaryHistory,
} from '@/lib/dmoCommentary.mjs';
import {
  canUseDmoLocalVoice,
  loadDmoLocalVoiceModel,
} from '@/lib/dmoLocalVoice.mjs';
import type { DmoCommentaryPoint } from '@/lib/dmoCommentary.mjs';
import type { Te4LiveSnapshot } from '@/lib/te4DmoLive';

type LocalVoiceModel = import('kokoro-js').KokoroTTS;

type CommentaryPoint = DmoCommentaryPoint & {
  frame: number;
  number: number;
  server: 1 | 2;
  winner: 1 | 2;
  rallyHits: number;
  rallyShotCount?: number;
  highlightReasons?: string;
  inferred?: boolean;
  isTiebreak?: boolean;
  winningStreak?: number;
  scoreBeforeLabel?: string;
};

type CommentaryContext = {
  tour: 'ATP' | 'WTA';
  players: Array<{ name: string; rank: number | null; tourElo: number | null }>;
  headToHead: { firstWins: number; secondWins: number; matches: number } | null;
};

type CommentarySpeaker = 'female' | 'male';
type CommentarySpeech = string | readonly [string, string];

function withVoiceDeadline<T>(work: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Commentary voice timed out')), milliseconds);
    work.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

function isPriorityPointCall(line: string) {
  return /\b(?:break|game|set|momentum|match-win)\b/i.test(line);
}

type Options = {
  snapshot: Te4LiveSnapshot;
  commentaryNames?: readonly [string, string] | null;
  fullReplay: boolean;
  commentaryPoints?: readonly CommentaryPoint[];
  replayFrame: number;
  tournamentName?: string | null;
  surface: string;
  tournamentRound?: string | null;
  isWta: boolean;
  soundEnabled: boolean;
  soundReady: boolean;
  getAudioContext?: () => AudioContext | null;
  playbackState: () => {
    frame: number;
    playing: boolean;
    rallyActive: boolean;
    rallyShotCount?: number;
  };
};

export function useDmoCommentary({
  snapshot,
  commentaryNames,
  fullReplay,
  commentaryPoints = [],
  replayFrame,
  tournamentName,
  surface,
  tournamentRound,
  isWta,
  soundEnabled,
  soundReady,
  getAudioContext,
  playbackState,
}: Options) {
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState('');
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState('');
  const [localVoiceSupported, setLocalVoiceSupported] = useState(false);
  const [browserVoices, setBrowserVoices] = useState<SpeechSynthesisVoice[]>([]);
  const requestRef = useRef(0);
  const lastRallyCommentaryPointRef = useRef<number | null>(null);
  const rallyCommentedPointsRef = useRef(new Set<number>());
  const recentCommentaryLinesRef = useRef<string[]>([]);
  const contextFactsRef = useRef('');
  const enabledRef = useRef(false);
  const soundEnabledRef = useRef(soundEnabled);
  const utteranceRef = useRef<SpeechSynthesisUtterance[]>([]);
  const localModelRef = useRef<LocalVoiceModel | null>(null);
  const localModelPromiseRef = useRef<Promise<LocalVoiceModel | null> | null>(null);
  const localVoiceLoadingRef = useRef(false);
  const localAudioContextRef = useRef<AudioContext | null>(null);
  const localSpeechSessionRef = useRef(0);
  const localSpeechBusyRef = useRef(false);
  const localAudioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const localSpeechIdleRef = useRef(Promise.resolve());
  const lastPointNumberRef = useRef(snapshot.pointCount);
  const lastReplayFrameRef = useRef(replayFrame);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSpeechAtRef = useRef(0);
  const matchKeyRef = useRef('');
  soundEnabledRef.current = soundEnabled && soundReady;

  const names = useMemo(
    () => commentaryNames
      ? [commentaryNames[0].trim(), commentaryNames[1].trim()] as const
      : ['', ''] as const,
    [commentaryNames],
  );
  const hasVerifiedNames = Boolean(names[0] && names[1]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const synthesis = window.speechSynthesis;
    const refreshVoices = () => {
      setBrowserVoices(rankDmoBrowserVoices(synthesis.getVoices()));
    };
    refreshVoices();
    synthesis.addEventListener('voiceschanged', refreshVoices);
    return () => synthesis.removeEventListener('voiceschanged', refreshVoices);
  }, []);

  useEffect(() => {
    const supported = canUseDmoLocalVoice({ allowMobile: true });
    setLocalVoiceSupported(supported);
    if (!supported) {
      setVoiceStatus('Using this device’s speech voice.');
    }
  }, []);

  const clearPendingCommentary = useCallback(() => {
    if (pendingTimerRef.current !== null) {
      clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
  }, []);

  const prepareLocalAudioContext = useCallback(() => {
    if (typeof window === 'undefined') return null;
    let audioContext = getAudioContext?.() ?? localAudioContextRef.current;
    if (!audioContext || audioContext.state === 'closed') {
      const AudioContextConstructor = window.AudioContext
        ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextConstructor) return null;
      audioContext = new AudioContextConstructor();
      localAudioContextRef.current = audioContext;
    }
    if (audioContext.state !== 'running') {
      void audioContext.resume().catch(() => {});
    }
    return audioContext;
  }, [getAudioContext]);

  const ensureLocalVoiceModel = useCallback(() => {
    if (localModelRef.current) return Promise.resolve(localModelRef.current);
    if (localModelPromiseRef.current) return localModelPromiseRef.current;
    if (!localVoiceSupported) {
      setVoiceStatus('Using this device’s speech voice.');
      return Promise.resolve(null);
    }

    localVoiceLoadingRef.current = true;
    setVoiceLoading(true);
    setVoiceStatus('Loading the local voice model; first use downloads about 92 MB.');
    const pending = withVoiceDeadline(loadDmoLocalVoiceModel((progress) => {
      if (progress.status === 'progress' && typeof progress.progress === 'number') {
        setVoiceStatus(
          `Loading local voice model: ${Math.round(progress.progress)}% (first use downloads about 92 MB).`,
        );
      }
    }), 60_000)
      .then((model) => {
        localModelRef.current = model;
        if (model) {
          setVoiceStatus('Local Kokoro voices are ready; speech is generated on this device.');
        } else {
          setVoiceStatus('Local Kokoro voices are unavailable; using this device’s speech voice.');
        }
        return model;
      })
      .catch(() => {
        localModelPromiseRef.current = null;
        setVoiceStatus('Kokoro could not load; using this device’s speech voice.');
        setError('Kokoro could not load. Using this device’s speech voice instead.');
        return null;
      })
      .finally(() => {
        localVoiceLoadingRef.current = false;
        setVoiceLoading(false);
      });
    localModelPromiseRef.current = pending;
    return pending;
  }, [localVoiceSupported]);

  const speakWithBrowser = useCallback((
    lines: readonly string[],
    firstSpeaker: CommentarySpeaker,
  ) => {
    if (
      typeof window === 'undefined'
      || typeof window.speechSynthesis?.speak !== 'function'
      || typeof SpeechSynthesisUtterance === 'undefined'
    ) return false;

    const synthesis = window.speechSynthesis;
    if (synthesis.paused) synthesis.resume();
    if (synthesis.speaking || synthesis.pending) return false;

    try {
      const voices = browserVoices.length
        ? browserVoices
        : rankDmoBrowserVoices(synthesis.getVoices());
      const selectedVoices = chooseDmoCommentaryVoices(voices);
      const femaleVoice = selectedVoices.female;
      const maleVoice = selectedVoices.male;
      if (!femaleVoice || !maleVoice) return false;
      const utterances = lines.map((line, index) => {
        const speaker = index === 0
          ? firstSpeaker
          : firstSpeaker === 'female' ? 'male' : 'female';
        const voice = speaker === 'female' ? femaleVoice : maleVoice;
        const utterance = new SpeechSynthesisUtterance(line);
        utterance.voice = voice;
        utterance.lang = voice.lang || 'en-US';
        utterance.rate = 1.03;
        utterance.pitch = selectedVoices.distinct ? 1 : speaker === 'female' ? 1.06 : 0.94;
        utterance.volume = 1;
        utterance.onend = () => {
          utteranceRef.current = utteranceRef.current.filter((item) => item !== utterance);
        };
        utterance.onerror = () => {
          if (!utteranceRef.current.includes(utterance)) return;
          utteranceRef.current = utteranceRef.current.filter((item) => item !== utterance);
          setError('Commentary could not play. Turn commentary off and on to retry.');
        };
        return utterance;
      });
      utteranceRef.current = utterances;
      for (const utterance of utterances) synthesis.speak(utterance);
      recentCommentaryLinesRef.current = [
        ...lines,
        ...recentCommentaryLinesRef.current,
      ].slice(0, 16);
      lastSpeechAtRef.current = Date.now();
      return true;
    } catch {
      utteranceRef.current = [];
      return false;
    }
  }, [browserVoices]);

  const playLocalSpeech = useCallback((
    lines: readonly string[],
    firstSpeaker: CommentarySpeaker,
  ) => {
    const model = localModelRef.current;
    const audioContext = prepareLocalAudioContext();
    if (!model || !audioContext || localSpeechBusyRef.current) return false;

    const session = ++localSpeechSessionRef.current;
    localSpeechBusyRef.current = true;
    let finishSpeech = () => {};
    localSpeechIdleRef.current = new Promise<void>((resolve) => {
      finishSpeech = resolve;
    });
    void (async () => {
      try {
        await withVoiceDeadline(audioContext.resume(), 3_000);
        if (audioContext.state !== 'running') throw new Error('Commentary audio is not running');
        for (let index = 0; index < lines.length; index += 1) {
          if (session !== localSpeechSessionRef.current || !soundEnabledRef.current) return;
          const speaker = index === 0
            ? firstSpeaker
            : firstSpeaker === 'female' ? 'male' : 'female';
          const audio = await withVoiceDeadline(model.generate(lines[index], {
            voice: speaker === 'female' ? 'af_heart' : 'am_michael',
            speed: 1.03,
          }), 15_000);
          if (session !== localSpeechSessionRef.current || !soundEnabledRef.current) return;
          if (!audio.audio.length || !(audio.sampling_rate > 0)) {
            throw new Error('Commentary generated no playable audio');
          }

          const buffer = audioContext.createBuffer(1, audio.audio.length, audio.sampling_rate);
          buffer.copyToChannel(new Float32Array(audio.audio), 0);
          const source = audioContext.createBufferSource();
          source.buffer = buffer;
          source.connect(audioContext.destination);
          localAudioSourceRef.current = source;
          await withVoiceDeadline(new Promise<void>((resolve) => {
            source.onended = () => {
              if (localAudioSourceRef.current === source) localAudioSourceRef.current = null;
              resolve();
            };
            source.start();
            if (index === 0) {
              recentCommentaryLinesRef.current = [
                ...lines,
                ...recentCommentaryLinesRef.current,
              ].slice(0, 16);
              lastSpeechAtRef.current = Date.now();
            }
          }), Math.ceil(buffer.duration * 1_000 || 0) + 3_000);
        }
      } catch {
        if (session === localSpeechSessionRef.current) {
          try { localAudioSourceRef.current?.stop(); } catch { /* Already stopped. */ }
          localModelRef.current = null;
          localModelPromiseRef.current = null;
          setVoiceStatus('Kokoro playback failed; switched to this device’s speech voice.');
          if (!speakWithBrowser(lines, firstSpeaker)) {
            setError('Kokoro playback failed and the device speech voice could not start.');
          }
        }
      } finally {
        localAudioSourceRef.current = null;
        localSpeechBusyRef.current = false;
        finishSpeech();
      }
    })();

    return true;
  }, [prepareLocalAudioContext, speakWithBrowser]);

  const speak = useCallback((content: CommentarySpeech, firstSpeaker: CommentarySpeaker = 'female') => {
    const lines = typeof content === 'string' ? [content] : content;
    if (
      lines.some((line) => !line.trim())
      || !soundEnabledRef.current
      || typeof window === 'undefined'
    ) return false;

    if (localModelRef.current) {
      const audioContext = prepareLocalAudioContext();
      if (audioContext) {
        if (playLocalSpeech(lines, firstSpeaker)) return true;
        if (localSpeechBusyRef.current) return false;
      } else {
        setVoiceStatus('Local audio is unavailable; using this device’s speech voice.');
      }
    }

    return speakWithBrowser(lines, firstSpeaker);
  }, [playLocalSpeech, prepareLocalAudioContext, speakWithBrowser]);

  const isVoiceBusy = useCallback(() => {
    const synthesis = typeof window !== 'undefined' ? window.speechSynthesis : null;
    return localSpeechBusyRef.current || Boolean(synthesis?.speaking || synthesis?.pending);
  }, []);

  const cancelCommentarySpeech = useCallback(() => {
    localSpeechSessionRef.current += 1;
    const source = localAudioSourceRef.current;
    localAudioSourceRef.current = null;
    if (source) {
      try {
        source.stop();
      } catch {
        // A source that has already ended cannot be stopped again.
      }
    }
    if (utteranceRef.current.length) {
      utteranceRef.current = [];
      if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
    }
    return localSpeechIdleRef.current;
  }, []);

  const scheduleSpeech = useCallback((
    line: CommentarySpeech,
    { delayMs, minimumGapMs, maxWaitMs, pointFrame, minimumQuietMs = 0, firstSpeaker = 'female' }: {
      delayMs: number;
      minimumGapMs: number;
      maxWaitMs: number;
      pointFrame?: number;
      minimumQuietMs?: number;
      firstSpeaker?: CommentarySpeaker;
    },
  ) => {
    clearPendingCommentary();
    const queuedAt = Date.now();
    let quietSince: number | null = null;
    const attempt = () => {
      pendingTimerRef.current = null;
      if (!enabledRef.current || !soundEnabledRef.current) return;
      const waited = Date.now() - queuedAt;
      if (waited > maxWaitMs) return;
      const playback = playbackState();
      // Never announce a live result before its recorded end reaches the court.
      if (!playback.playing || (pointFrame !== undefined && playback.frame < pointFrame)) {
        quietSince = null;
        pendingTimerRef.current = setTimeout(attempt, 250);
        return;
      }
      if (playback.rallyActive) {
        quietSince = null;
        // Point reactions describe the completed point and must not vanish
        // just because the next serve has started. Longer facts still wait
        // for a quiet gap.
        if (pointFrame === undefined) {
          pendingTimerRef.current = setTimeout(attempt, 250);
          return;
        }
      }

      quietSince ??= Date.now();
      if (Date.now() - quietSince < minimumQuietMs) {
        pendingTimerRef.current = setTimeout(attempt, 250);
        return;
      }

      const voiceBusy = isVoiceBusy();
      const gapRemaining = minimumGapMs - (Date.now() - lastSpeechAtRef.current);
      if (voiceBusy || gapRemaining > 0) {
        const retryAfter = voiceBusy ? 500 : Math.min(gapRemaining, 1_000);
        if (waited + retryAfter <= maxWaitMs) {
          pendingTimerRef.current = setTimeout(attempt, retryAfter);
        }
        return;
      }
      if (!speak(line, firstSpeaker)) {
        setError('Commentary could not start. Turn commentary off and on to retry.');
      }
    };
    pendingTimerRef.current = setTimeout(attempt, delayMs);
  }, [clearPendingCommentary, isVoiceBusy, speak, playbackState]);

  const toggle = useCallback(async () => {
    // Unlock audio synchronously in the user's tap, before cancellation or the
    // first model download crosses an async boundary (especially on iOS).
    const preparedAudioContext = !enabledRef.current && soundEnabled && soundReady
      ? prepareLocalAudioContext() : null;
    const request = ++requestRef.current;
    contextFactsRef.current = '';
    if (enabledRef.current) {
      enabledRef.current = false;
      setEnabled(false);
      clearPendingCommentary();
      cancelCommentarySpeech();
      lastRallyCommentaryPointRef.current = null;
      rallyCommentedPointsRef.current.clear();
      setError('');
      return;
    }
    if (localVoiceLoadingRef.current) return;
    if (!soundEnabled || !soundReady) {
      setError('Enable broadcast sound first, then turn on commentary.');
      return;
    }
    if (!hasVerifiedNames) {
      setError('Verified WTSL player names are unavailable; character names will not be used.');
      return;
    }
    if (typeof window === 'undefined') {
      setError('Spoken commentary is not supported by this browser.');
      return;
    }
    await cancelCommentarySpeech();
    if (request !== requestRef.current || !soundEnabledRef.current) return;
    const audioContext = preparedAudioContext;
    const nativeSpeechAvailable = typeof window.speechSynthesis?.speak === 'function'
      && typeof SpeechSynthesisUtterance !== 'undefined';
    if (!audioContext && !nativeSpeechAvailable) {
      setError('Spoken commentary is not supported by this browser.');
      return;
    }

    setError('');
    if (audioContext && localVoiceSupported) await ensureLocalVoiceModel();
    if (request !== requestRef.current || !soundEnabledRef.current) return;

    const voices = browserVoices.length
      ? browserVoices
      : nativeSpeechAvailable ? rankDmoBrowserVoices(window.speechSynthesis.getVoices()) : [];
    const selectedVoices = chooseDmoCommentaryVoices(voices);
    if (!localModelRef.current && !selectedVoices.female) {
      setError('No English speech voice is available in this browser.');
      return;
    }

    enabledRef.current = true;
    setEnabled(true);
    lastRallyCommentaryPointRef.current = null;
    rallyCommentedPointsRef.current.clear();
    clearPendingCommentary();
    lastPointNumberRef.current = Math.max(
      snapshot.pointCount,
      ...snapshot.recentPoints.map((point) => point.number),
    );
    lastReplayFrameRef.current = replayFrame;
    const matchKey = names.join('\u0000');
    matchKeyRef.current = matchKey;

    const introduction = buildDmoCommentaryIntroduction({
      names,
      tournament: tournamentName ?? '',
      surface,
      round: tournamentRound ?? '',
    });
    const coHostOpening = buildDmoCommentaryOpeningReply({
      names,
      recentLines: recentCommentaryLinesRef.current,
    });
    // Speak from the button gesture itself; some browsers block speech queued
    // by a timer until the user interacts with a voice picker or preview.
    const opened = coHostOpening
      ? speak([introduction, coHostOpening] as const, 'female')
      : speak(introduction, 'female');
    if (!opened) setError('Commentary could not start. Turn commentary off and on to retry.');
    else if (!localModelRef.current && !selectedVoices.distinct) {
      setError('This browser has one English voice; the co-host will use a different pitch.');
    }

    const query = new URLSearchParams({
      first: names[0],
      second: names[1],
      tour: isWta ? 'WTA' : 'ATP',
    });
    void fetch(`/api/dmo-commentary/context?${query.toString()}`)
      .then(async (response) => {
        if (!response.ok) throw new Error('WTSL context request failed');
        return response.json() as Promise<{ context?: CommentaryContext | null }>;
      })
      .then(({ context }) => {
        if (!enabledRef.current || requestRef.current !== request || !context) return;
        const facts = buildDmoCommentaryFacts({ names, context });
        if (!facts) return;
        // The playback observer delivers this in a later quiet interval.
        // Fetch completion must not overwrite the opening or a point reaction.
        contextFactsRef.current = facts;
      })
      .catch(() => {
        if (enabledRef.current && requestRef.current === request) setError('WTSL facts are unavailable; point commentary can still continue.');
      });
  }, [
    clearPendingCommentary,
    cancelCommentarySpeech,
    ensureLocalVoiceModel,
    localVoiceSupported,
    isWta,
    names,
    prepareLocalAudioContext,
    replayFrame,
    soundEnabled,
    soundReady,
    hasVerifiedNames,
    browserVoices,
    snapshot.pointCount,
    snapshot.recentPoints,
    surface,
    speak,
    tournamentName,
    tournamentRound,
  ]);

  useEffect(() => {
    enabledRef.current = enabled;
    if (!enabled) clearPendingCommentary();
  }, [clearPendingCommentary, enabled]);

  useEffect(() => {
    if (soundEnabled && soundReady) return;
    requestRef.current += 1;
    contextFactsRef.current = '';
    enabledRef.current = false;
    setEnabled(false);
    clearPendingCommentary();
    cancelCommentarySpeech();
    setError('');
  }, [cancelCommentarySpeech, clearPendingCommentary, soundEnabled, soundReady]);

  useEffect(() => {
    const matchKey = names.join('\u0000');
    if (matchKeyRef.current === matchKey) return;
    requestRef.current += 1;
    contextFactsRef.current = '';
    matchKeyRef.current = matchKey;
    lastPointNumberRef.current = snapshot.pointCount;
    lastReplayFrameRef.current = replayFrame;
    rallyCommentedPointsRef.current.clear();
    clearPendingCommentary();
    cancelCommentarySpeech();
    enabledRef.current = false;
    setEnabled(false);
  }, [cancelCommentarySpeech, clearPendingCommentary, names, replayFrame, snapshot.pointCount]);

  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => {
      const playback = playbackState();
      // Pause stops speech, but a call that has already begun may finish when
      // the next rally starts. Otherwise ordinary gaps cut every sentence off.
      if (!playback.playing) {
        cancelCommentarySpeech();
        lastRallyCommentaryPointRef.current = null;
        return;
      }

      if (!playback.rallyActive) {
        lastRallyCommentaryPointRef.current = null;
      } else {
        let pointNumber = snapshot.pointCount;
        if (fullReplay) {
          pointNumber = 0;
          for (const point of commentaryPoints) {
            if (point.frame > playback.frame) break;
            pointNumber = point.number;
          }
        }
        const minimumGapMs = pointNumber <= 8 ? 8_000 : 10_000;
        const voiceBusy = isVoiceBusy();
        if (
          (playback.rallyShotCount ?? 0) >= 8
          && lastRallyCommentaryPointRef.current !== pointNumber
          && pendingTimerRef.current === null
          && !voiceBusy
          && Date.now() - lastSpeechAtRef.current >= minimumGapMs
        ) {
          const line = buildDmoRallyCommentary({
            names,
            rallyShotCount: playback.rallyShotCount ?? 0,
            pointNumber,
            recentLines: recentCommentaryLinesRef.current,
          });
          if (line) {
            const speaker = pointNumber % 2 === 0 ? 'male' : 'female';
            if (!speak(line, speaker)) {
              setError('Commentary could not start. Turn commentary off and on to retry.');
            } else {
              rallyCommentedPointsRef.current.add(pointNumber);
              if (rallyCommentedPointsRef.current.size > 12) {
                const oldest = rallyCommentedPointsRef.current.values().next().value;
                if (oldest !== undefined) rallyCommentedPointsRef.current.delete(oldest);
              }
            }
            lastRallyCommentaryPointRef.current = pointNumber;
          }
        }
      }

      if (!playback.rallyActive && contextFactsRef.current && pendingTimerRef.current === null
        && !isVoiceBusy() && Date.now() - lastSpeechAtRef.current >= 12_000) {
        const facts = contextFactsRef.current;
        contextFactsRef.current = '';
        scheduleSpeech(facts, {
          delayMs: 0,
          minimumGapMs: 12_000,
          minimumQuietMs: 3_000,
          maxWaitMs: 15_000,
        });
      }
    }, 200);
    return () => clearInterval(timer);
  }, [
    enabled,
    playbackState,
    isVoiceBusy,
    cancelCommentarySpeech,
    scheduleSpeech,
    commentaryPoints,
    fullReplay,
    names,
    snapshot.pointCount,
    speak,
  ]);

  useEffect(() => {
    if (!enabled) return;
    if (fullReplay) {
      const previousFrame = lastReplayFrameRef.current;
      if (replayFrame < previousFrame) {
        lastReplayFrameRef.current = replayFrame;
        rallyCommentedPointsRef.current.clear();
        clearPendingCommentary();
        cancelCommentarySpeech();
        return;
      }
      const duePoints = commentaryPoints.filter(
        (point) => point.frame > previousFrame && point.frame <= replayFrame,
      );
      lastReplayFrameRef.current = replayFrame;
      const point = duePoints.at(-1);
      if (point) {
        const recentLines = recentCommentaryLinesRef.current;
        const suppressRallyCommentary = rallyCommentedPointsRef.current.delete(point.number);
        const line = buildDmoPointCommentary(
          withDmoCommentaryHistory({
            ...point,
            suppressRallyCommentary,
          }, commentaryPoints),
          names,
          recentLines,
        );
        if (line) {
          const priorityCall = isPriorityPointCall(line);
          scheduleSpeech(line, {
            delayMs: 250,
            minimumGapMs: priorityCall ? 2_000 : point.number <= 8 ? 8_000 : 10_000,
            maxWaitMs: priorityCall ? 8_000 : 9_000,
            pointFrame: point.frame,
            firstSpeaker: point.number % 2 === 0 ? 'male' : 'female',
          });
        }
      }
      return;
    }

    const lastSeen = lastPointNumberRef.current;
    const newPoints = snapshot.recentPoints.filter((point) => point.number > lastSeen);
    const point = newPoints.at(-1);
    if (!point) return;
    lastPointNumberRef.current = point.number;
    const previousPoint = snapshot.recentPoints.find(
      (candidate) => candidate.number === point.number - 1,
    );
    const recentLines = recentCommentaryLinesRef.current;
    const suppressRallyCommentary = rallyCommentedPointsRef.current.delete(point.number);
    const line = buildDmoPointCommentary(withDmoCommentaryHistory({
      ...point,
      scoreBeforeLabel: previousPoint?.scoreLabel,
      scoreAfterLabel: point.scoreLabel,
      suppressRallyCommentary,
    }, snapshot.recentPoints), names, recentLines);
    if (line) {
      const priorityCall = isPriorityPointCall(line);
      scheduleSpeech(line, {
        delayMs: 250,
        minimumGapMs: priorityCall ? 2_000 : point.number <= 8 ? 8_000 : 10_000,
        maxWaitMs: priorityCall ? 8_000 : 9_000,
        pointFrame: point.frame,
        firstSpeaker: point.number % 2 === 0 ? 'male' : 'female',
      });
    }
  }, [
    commentaryPoints,
    enabled,
    fullReplay,
    names,
    replayFrame,
    scheduleSpeech,
    cancelCommentarySpeech,
    snapshot.recentPoints,
  ]);

  useEffect(() => () => {
    requestRef.current += 1;
    clearPendingCommentary();
    cancelCommentarySpeech();
  }, [cancelCommentarySpeech, clearPendingCommentary]);

  return {
    enabled, error, voiceLoading, voiceStatus, toggle,
    localVoiceSupported,
  };
}

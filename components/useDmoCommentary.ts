'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildDmoCommentaryFacts,
  buildDmoCommentaryIntroduction,
  buildDmoPointCommentary,
  chooseDmoCommentaryVoice,
  rankDmoBrowserVoices,
  withDmoCommentaryHistory,
} from '@/lib/dmoCommentary.mjs';
import type { DmoCommentaryPoint } from '@/lib/dmoCommentary.mjs';
import type { Te4LiveSnapshot } from '@/lib/te4DmoLive';

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
  playbackState: () => { frame: number; playing: boolean; rallyActive: boolean };
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
  playbackState,
}: Options) {
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState('');
  const [browserVoices, setBrowserVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState('');
  const requestRef = useRef(0);
  const contextFactsRef = useRef('');
  const enabledRef = useRef(false);
  const soundEnabledRef = useRef(soundEnabled);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
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
      setBrowserVoices(rankDmoBrowserVoices(synthesis.getVoices())
        .filter((voice) => chooseDmoCommentaryVoice([voice]) !== null));
    };
    try { setSelectedVoiceURI(window.localStorage.getItem('wtsl-commentary-natural-voice') ?? ''); } catch {}
    refreshVoices();
    synthesis.addEventListener('voiceschanged', refreshVoices);
    return () => synthesis.removeEventListener('voiceschanged', refreshVoices);
  }, []);

  const clearPendingCommentary = useCallback(() => {
    if (pendingTimerRef.current !== null) {
      clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
  }, []);

  const speak = useCallback((text: string) => {
    if (
      !text.trim()
      || !soundEnabledRef.current
      || typeof window === 'undefined'
      || typeof window.speechSynthesis?.speak !== 'function'
      || typeof SpeechSynthesisUtterance === 'undefined'
    ) return false;

    const synthesis = window.speechSynthesis;
    // Yield to any in-progress browser speech, including the umpire fallback.
    if (synthesis.speaking || synthesis.pending) return false;

    try {
      const utterance = new SpeechSynthesisUtterance(text);
      const voices = browserVoices.length
        ? browserVoices
        : rankDmoBrowserVoices(synthesis.getVoices());
      utterance.voice = chooseDmoCommentaryVoice(voices, selectedVoiceURI);
      if (!utterance.voice) return false;
      utterance.lang = utterance.voice?.lang || 'en-GB';
      utterance.rate = 1;
      utterance.pitch = 1;
      utterance.volume = 1;
      utterance.onend = () => {
        if (utteranceRef.current === utterance) utteranceRef.current = null;
      };
      utterance.onerror = () => {
        if (utteranceRef.current === utterance) utteranceRef.current = null;
        setError('The browser could not play the commentary voice. Try another voice or preview it again.');
      };
      utteranceRef.current = utterance;
      synthesis.speak(utterance);
      lastSpeechAtRef.current = Date.now();
      return true;
    } catch {
      return false;
    }
  }, [browserVoices, selectedVoiceURI]);

  const cancelCommentarySpeech = useCallback(() => {
    if (!utteranceRef.current) return;
    utteranceRef.current = null;
    if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
  }, []);

  const scheduleSpeech = useCallback((
    line: string,
    { delayMs, minimumGapMs, maxWaitMs, pointFrame }: {
      delayMs: number;
      minimumGapMs: number;
      maxWaitMs: number;
      pointFrame?: number;
    },
  ) => {
    clearPendingCommentary();
    const queuedAt = Date.now();
    const attempt = () => {
      pendingTimerRef.current = null;
      if (!enabledRef.current || !soundEnabledRef.current) return;
      const waited = Date.now() - queuedAt;
      if (waited > maxWaitMs) return;
      const playback = playbackState();
      // Never announce a live result before its recorded end reaches the court.
      if (!playback.playing || (pointFrame !== undefined && playback.frame < pointFrame)) {
        pendingTimerRef.current = setTimeout(attempt, 250);
        return;
      }
      if (playback.rallyActive) {
        // A point reaction is stale once the next rally starts.
        if (pointFrame !== undefined) return;
        pendingTimerRef.current = setTimeout(attempt, 250);
        return;
      }

      const synthesis = typeof window !== 'undefined' ? window.speechSynthesis : null;
      const voiceBusy = Boolean(synthesis?.speaking || synthesis?.pending);
      const gapRemaining = minimumGapMs - (Date.now() - lastSpeechAtRef.current);
      if (voiceBusy || gapRemaining > 0) {
        const retryAfter = voiceBusy ? 500 : Math.min(gapRemaining, 1_000);
        if (waited + retryAfter <= maxWaitMs) {
          pendingTimerRef.current = setTimeout(attempt, retryAfter);
        }
        return;
      }
      speak(line);
    };
    pendingTimerRef.current = setTimeout(attempt, delayMs);
  }, [clearPendingCommentary, speak, playbackState]);

  const changeVoice = useCallback((uri: string) => {
    cancelCommentarySpeech();
    clearPendingCommentary();
    setSelectedVoiceURI(uri);
    setError('');
    try { window.localStorage.setItem('wtsl-commentary-natural-voice', uri); } catch {}
  }, [cancelCommentarySpeech, clearPendingCommentary]);

  const previewVoice = useCallback(() => {
    if (!soundEnabled || !soundReady) {
      setError('Enable broadcast sound before previewing the voice.');
      return;
    }
    cancelCommentarySpeech();
    if (!speak('Welcome to WTSL tennis. A big point coming up. Let us see who takes the initiative.')) {
      setError('No suitable English voice is ready, or the browser is already speaking. Try again when it is quiet.');
    } else setError('');
  }, [soundEnabled, soundReady, cancelCommentarySpeech, speak]);

  const toggle = useCallback(() => {
    const request = ++requestRef.current;
    contextFactsRef.current = '';
    if (enabledRef.current) {
      enabledRef.current = false;
      setEnabled(false);
      clearPendingCommentary();
      cancelCommentarySpeech();
      setError('');
      return;
    }
    if (!soundEnabled || !soundReady) {
      setError('Enable broadcast sound first, then turn on commentary.');
      return;
    }
    if (!hasVerifiedNames) {
      setError('Verified WTSL player names are unavailable; character names will not be used.');
      return;
    }
    if (
      typeof window === 'undefined'
      || typeof window.speechSynthesis?.speak !== 'function'
      || typeof SpeechSynthesisUtterance === 'undefined'
    ) {
      setError('Spoken commentary is not supported by this browser.');
      return;
    }
    const voices = browserVoices.length
      ? browserVoices
      : rankDmoBrowserVoices(window.speechSynthesis.getVoices());
    if (!chooseDmoCommentaryVoice(voices)) {
      setError('No natural, enhanced or Google English voice is available. Commentary stays off rather than use a basic system voice.');
      return;
    }

    enabledRef.current = true;
    setEnabled(true);
    setError('');
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
    scheduleSpeech(introduction, { delayMs: 0, minimumGapMs: 0, maxWaitMs: 15_000 });

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
    isWta,
    names,
    replayFrame,
    scheduleSpeech,
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
    clearPendingCommentary();
    cancelCommentarySpeech();
    enabledRef.current = false;
    setEnabled(false);
  }, [cancelCommentarySpeech, clearPendingCommentary, names, replayFrame, snapshot.pointCount]);

  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => {
      const playback = playbackState();
      if (!playback.playing || playback.rallyActive) cancelCommentarySpeech();
      else if (contextFactsRef.current && pendingTimerRef.current === null
        && !window.speechSynthesis.speaking && Date.now() - lastSpeechAtRef.current >= 12_000) {
        const facts = contextFactsRef.current;
        contextFactsRef.current = '';
        scheduleSpeech(facts, { delayMs: 0, minimumGapMs: 12_000, maxWaitMs: 15_000 });
      }
    }, 200);
    return () => clearInterval(timer);
  }, [enabled, playbackState, cancelCommentarySpeech, scheduleSpeech]);

  useEffect(() => {
    if (!enabled) return;
    if (fullReplay) {
      const previousFrame = lastReplayFrameRef.current;
      if (replayFrame < previousFrame) {
        lastReplayFrameRef.current = replayFrame;
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
        const line = buildDmoPointCommentary(withDmoCommentaryHistory(point, commentaryPoints), names);
        if (line) scheduleSpeech(line, {
          delayMs: 1_400,
          minimumGapMs: 10_000,
          maxWaitMs: 9_000,
          pointFrame: point.frame,
        });
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
    const line = buildDmoPointCommentary(withDmoCommentaryHistory({
      ...point,
      scoreBeforeLabel: previousPoint?.scoreLabel,
    }, snapshot.recentPoints), names);
    if (line) scheduleSpeech(line, {
      delayMs: 1_400,
      minimumGapMs: 10_000,
      maxWaitMs: 9_000,
      pointFrame: point.frame,
    });
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

  const selectedVoice = chooseDmoCommentaryVoice(browserVoices, selectedVoiceURI);
  return {
    enabled, error, toggle, browserVoices,
    selectedVoiceURI: selectedVoice?.voiceURI ?? '',
    changeVoice, previewVoice,
  };
}

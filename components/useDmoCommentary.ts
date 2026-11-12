'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildDmoCommentaryFacts,
  buildDmoCommentaryIntroduction,
  buildDmoPointCommentary,
} from '@/lib/dmoCommentary.mjs';
import type { Te4LiveSnapshot } from '@/lib/te4DmoLive';

type CommentaryPoint = {
  frame: number;
  number: number;
  server: 1 | 2;
  winner: 1 | 2;
  rallyHits: number;
  scoreLabel?: string;
};

type CommentaryContext = {
  tour: 'ATP' | 'WTA';
  players: Array<{ name: string; rank: number | null; tourElo: number | null }>;
  headToHead: { firstWins: number; secondWins: number; matches: number } | null;
};

type Options = {
  snapshot: Te4LiveSnapshot;
  playerCharacters: readonly [string | null, string | null];
  fullReplay: boolean;
  commentaryPoints?: readonly CommentaryPoint[];
  replayFrame: number;
  tournamentName?: string | null;
  surface: string;
  tournamentRound?: string | null;
  isWta: boolean;
  soundEnabled: boolean;
  soundReady: boolean;
};

function appendTranscript(current: string, line: string) {
  return [...current.split('\n').filter(Boolean), line].slice(-8).join('\n');
}

export function useDmoCommentary({
  snapshot,
  playerCharacters,
  fullReplay,
  commentaryPoints = [],
  replayFrame,
  tournamentName,
  surface,
  tournamentRound,
  isWta,
  soundEnabled,
  soundReady,
}: Options) {
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
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
    () => [
      playerCharacters[0] || snapshot.players[0],
      playerCharacters[1] || snapshot.players[1],
    ] as const,
    [playerCharacters, snapshot.players],
  );

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
      const voices = synthesis.getVoices();
      utterance.voice = voices.find((voice) => /^en-(GB|AU)\b/i.test(voice.lang))
        ?? voices.find((voice) => /^en\b/i.test(voice.lang))
        ?? null;
      utterance.lang = 'en-GB';
      utterance.rate = 0.94;
      utterance.pitch = 0.88;
      utterance.volume = 0.92;
      utterance.onend = () => {
        if (utteranceRef.current === utterance) utteranceRef.current = null;
      };
      utterance.onerror = () => {
        if (utteranceRef.current === utterance) utteranceRef.current = null;
      };
      utteranceRef.current = utterance;
      synthesis.speak(utterance);
      lastSpeechAtRef.current = Date.now();
      return true;
    } catch {
      return false;
    }
  }, []);

  const cancelCommentarySpeech = useCallback(() => {
    if (!utteranceRef.current) return;
    utteranceRef.current = null;
    if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
  }, []);

  const schedulePointLine = useCallback((line: string) => {
    clearPendingCommentary();
    pendingTimerRef.current = setTimeout(() => {
      pendingTimerRef.current = null;
      if (!enabledRef.current || Date.now() - lastSpeechAtRef.current < 3_800) return;
      speak(line);
    }, 1_400);
  }, [clearPendingCommentary, speak]);

  const toggle = useCallback(() => {
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
    if (
      typeof window === 'undefined'
      || typeof window.speechSynthesis?.speak !== 'function'
      || typeof SpeechSynthesisUtterance === 'undefined'
    ) {
      setError('Spoken commentary is not supported by this browser.');
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
    setMessage(introduction);
    speak(introduction);

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
        if (!enabledRef.current || !context) return;
        const facts = buildDmoCommentaryFacts({ names, context });
        if (!facts) return;
        setMessage((current) => appendTranscript(current, facts));
        clearPendingCommentary();
        pendingTimerRef.current = setTimeout(() => {
          pendingTimerRef.current = null;
          if (enabledRef.current && Date.now() - lastSpeechAtRef.current >= 3_800) speak(facts);
        }, 3_500);
      })
      .catch(() => {
        if (enabledRef.current) setError('WTSL facts are unavailable; point commentary can still continue.');
      });
  }, [
    clearPendingCommentary,
    cancelCommentarySpeech,
    isWta,
    names,
    replayFrame,
    soundEnabled,
    soundReady,
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
    if ((soundEnabled && soundReady) || !enabledRef.current) return;
    enabledRef.current = false;
    setEnabled(false);
    clearPendingCommentary();
    cancelCommentarySpeech();
    setError('');
  }, [cancelCommentarySpeech, clearPendingCommentary, soundEnabled, soundReady]);

  useEffect(() => {
    const matchKey = names.join('\u0000');
    if (matchKeyRef.current === matchKey) return;
    matchKeyRef.current = matchKey;
    lastPointNumberRef.current = snapshot.pointCount;
    lastReplayFrameRef.current = replayFrame;
    clearPendingCommentary();
  }, [clearPendingCommentary, names, replayFrame, snapshot.pointCount]);

  useEffect(() => {
    if (!enabled) return;
    if (fullReplay) {
      const previousFrame = lastReplayFrameRef.current;
      if (replayFrame < previousFrame) {
        lastReplayFrameRef.current = replayFrame;
        clearPendingCommentary();
        return;
      }
      const duePoints = commentaryPoints.filter(
        (point) => point.frame > previousFrame && point.frame <= replayFrame,
      );
      lastReplayFrameRef.current = replayFrame;
      const point = duePoints.at(-1);
      if (point) {
        const line = buildDmoPointCommentary(point, names);
        if (line) {
          setMessage((current) => appendTranscript(current, line));
          schedulePointLine(line);
        }
      }
      return;
    }

    const lastSeen = lastPointNumberRef.current;
    const newPoints = snapshot.recentPoints.filter((point) => point.number > lastSeen);
    const point = newPoints.at(-1);
    if (!point) return;
    lastPointNumberRef.current = point.number;
    const line = buildDmoPointCommentary(point, names);
    if (line) {
      setMessage((current) => appendTranscript(current, line));
      schedulePointLine(line);
    }
  }, [
    clearPendingCommentary,
    commentaryPoints,
    enabled,
    fullReplay,
    names,
    replayFrame,
    schedulePointLine,
    snapshot.recentPoints,
  ]);

  useEffect(() => () => {
    clearPendingCommentary();
    cancelCommentarySpeech();
  }, [cancelCommentarySpeech, clearPendingCommentary]);

  return { enabled, message, error, toggle };
}

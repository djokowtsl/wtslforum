'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  NATIVE_MOTION_STROKES,
  nativeMotionClipSupportsStroke,
  nativeMotionStrokeLabel,
  type NativeMotionCatalog,
  type NativeMotionGesturePick,
  type NativeMotionGesturePicks,
  type NativeMotionHand,
  type NativeMotionPicks,
  type NativeMotionStroke,
} from '@/lib/nativeMotionCatalogData';
import { getDmoCharacterGruntGroups } from '@/lib/dmoCharacterAppearance.mjs';
import {
  NATIVE_MOTION_CATALOG_SHA256,
  NATIVE_MOTION_GESTURE_CATALOG_SHA256,
} from '@/lib/nativeMotionCatalog';
import { fetchNativeMotionAsset } from '@/lib/nativeMotionFetch';
import SearchableClipSelect from './SearchableClipSelect';
import GestureClipSetPicker from './GestureClipSetPicker';
import styles from './DmoLiveHost.module.css';

type Draft = Partial<Record<NativeMotionStroke, { clipId: string; sourceHandedness: NativeMotionHand | '' }>>;
type GestureDraft = NativeMotionGesturePicks;
type GruntOverride = null | { gruntGroup: string | null };
export type LiveStreamAnimationDraft = {
  playerClips: [NativeMotionPicks, NativeMotionPicks];
  playerGestures: [GestureDraft, GestureDraft];
  playerGruntOverrides: [GruntOverride, GruntOverride];
  missingSourceHandedness: boolean;
};
type Props = {
  broadcastId?: string | null;
  open: readonly [boolean, boolean];
  labels: readonly [string, string];
  disabled?: boolean;
  suppressRememberedRestore?: boolean;
  onDraftChange?: (draft: LiveStreamAnimationDraft) => void;
};

const NONE = '__profile_default__';
const NO_GRUNT = '__no_grunt__';

function rememberKey(owner: string, index: 0 | 1) {
  return `wtsl-live-animations:${owner}:${index}`;
}

function remembered(owner: string, index: 0 | 1): Draft {
  try {
    const value = JSON.parse(window.localStorage.getItem(rememberKey(owner, index)) ?? '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Draft : {};
  } catch {
    return {};
  }
}

function remember(owner: string, index: 0 | 1, draft: Draft) {
  try {
    window.localStorage.setItem(rememberKey(owner, index), JSON.stringify(draft));
  } catch {
    // Private browsing or storage full: choices still apply to this stream.
  }
}

const complete = (draft: Draft): NativeMotionPicks => Object.fromEntries(
  NATIVE_MOTION_STROKES.flatMap((stroke) => {
    const pick = draft[stroke];
    return pick?.clipId && ['left', 'right'].includes(pick.sourceHandedness) ? [[stroke, pick]] : [];
  }),
) as NativeMotionPicks;

/** Per-stream motion and sound choices; draft controls are available before a stream starts. */
export default function LiveStreamAnimationPicker({
  broadcastId, open, labels, disabled = false, suppressRememberedRestore = false, onDraftChange,
}: Props) {
  const [catalog, setCatalog] = useState<NativeMotionCatalog | null>(null);
  const [gestureCatalog, setGestureCatalog] = useState<NativeMotionCatalog | null>(null);
  const [gestureCatalogStatus, setGestureCatalogStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [drafts, setDrafts] = useState<[Draft, Draft]>([{}, {}]);
  const [gestureDrafts, setGestureDrafts] = useState<[GestureDraft, GestureDraft]>([{}, {}]);
  const [gruntDrafts, setGruntDrafts] = useState<[string, string]>([NONE, NONE]);
  const [owner, setOwner] = useState('');
  const [loadedStream, setLoadedStream] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [expanded, setExpanded] = useState(false);
  const anyOpen = open[0] || open[1];
  const gruntGroups = useMemo(() => getDmoCharacterGruntGroups(), []);
  const onDraftChangeRef = useRef(onDraftChange);
  onDraftChangeRef.current = onDraftChange;

  function reportDraft(
    nextDrafts = drafts,
    nextGestures = gestureDrafts,
    nextGrunts = gruntDrafts,
  ) {
    onDraftChangeRef.current?.({
      playerClips: [complete(nextDrafts[0]), complete(nextDrafts[1])],
      playerGestures: [{ ...nextGestures[0] }, { ...nextGestures[1] }],
      playerGruntOverrides: nextGrunts.map((value) => (
        value === NONE ? null : { gruntGroup: value === NO_GRUNT ? null : value }
      )) as [GruntOverride, GruntOverride],
      missingSourceHandedness: nextDrafts.some((draft) => NATIVE_MOTION_STROKES.some((stroke) => (
        Boolean(draft[stroke]?.clipId)
        && !['left', 'right'].includes(draft[stroke]?.sourceHandedness ?? '')
      ))),
    });
  }

  useEffect(() => {
    if (!anyOpen) return;
    let active = true;
    fetchNativeMotionAsset(`/api/native-motion/${NATIVE_MOTION_CATALOG_SHA256}/catalog.json`)
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const body = await response.json() as NativeMotionCatalog;
        if (!Array.isArray(body?.clips)) throw new Error();
        if (active) setCatalog(body);
      })
      .catch(() => { if (active) setError('The animation list could not be loaded. Existing motion is unchanged.'); });
    return () => { active = false; };
  }, [anyOpen]);

  useEffect(() => {
    if (!anyOpen) return;
    let active = true;
    setGestureCatalogStatus('loading');
    fetchNativeMotionAsset(`/api/native-motion/${NATIVE_MOTION_GESTURE_CATALOG_SHA256}/catalog.json`)
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const body = await response.json() as NativeMotionCatalog;
        if (!Array.isArray(body?.clips)) throw new Error();
        if (active) {
          setGestureCatalog(body);
          setGestureCatalogStatus('ready');
        }
      })
      .catch(() => {
        if (active) setGestureCatalogStatus('unavailable');
      });
    return () => { active = false; };
  }, [anyOpen]);

  useEffect(() => {
    const streamId = broadcastId;
    if (!anyOpen || !streamId) {
      setLoadedStream('');
      return;
    }
    let active = true;
    const controller = new AbortController();
    let savedLoaded = false;
    setLoadedStream('');
    setError('');
    setMessage('');
    (async () => {
      try {
        const endpoint = `/api/live-dmo/${encodeURIComponent(streamId)}/animations`;
        const response = await fetch(endpoint, { cache: 'no-store', signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Stream animations could not be loaded.');
        const saved = body.playerClips as [NativeMotionPicks, NativeMotionPicks];
        const savedGestures = (body.playerGestures ?? [{}, {}]) as [GestureDraft, GestureDraft];
        const savedGrunts = (body.playerGruntOverrides ?? [null, null]) as [GruntOverride, GruntOverride];
        if (!Array.isArray(saved) || saved.length !== 2 || !body.ownerDiscordId) throw new Error('Invalid stream animation response.');
        const streamer = String(body.ownerDiscordId);
        const next: [Draft, Draft] = [{ ...saved[0] }, { ...saved[1] }];
        const nextGrunts = savedGrunts.map((override) => (
          override === null ? NONE : override.gruntGroup ?? NO_GRUNT
        )) as [string, string];
        const apply: [NativeMotionPicks | null, NativeMotionPicks | null] = [null, null];
        ([0, 1] as const).forEach((index) => {
          if (suppressRememberedRestore || !open[index] || Object.keys(saved[index] ?? {}).length) return;
          const picks = complete(remembered(streamer, index));
          if (!Object.keys(picks).length) return;
          apply[index] = picks;
        });
        if (!active) return;
        setOwner(streamer);
        setDrafts(next);
        setGestureDrafts([{ ...savedGestures[0] }, { ...savedGestures[1] }]);
        setGruntDrafts(nextGrunts);
        reportDraft(next, savedGestures, nextGrunts);
        ([0, 1] as const).forEach((index) => {
          if (open[index] && Object.keys(saved[index] ?? {}).length) {
            remember(streamer, index, next[index]);
          }
        });
        savedLoaded = true;
        if (apply.some(Boolean)) {
          const restore = await fetch(endpoint, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ playerClips: apply, onlyIfEmpty: true }),
            signal: controller.signal,
          });
          const result = await restore.json();
          if (!restore.ok) throw new Error(result.error || 'Remembered animations could not be applied. Existing motion is unchanged.');
          // Read back the actual winners if an admin saved choices concurrently.
          const refreshed = await fetch(endpoint, { cache: 'no-store', signal: controller.signal });
          const actual = await refreshed.json();
          if (!refreshed.ok) throw new Error(actual.error || 'Restored animations could not be loaded.');
          if (active) {
            setDrafts(actual.playerClips);
            const actualGestures = actual.playerGestures ?? [{}, {}];
            const actualGrunts = actual.playerGruntOverrides ?? [null, null];
            const actualGruntDrafts = actualGrunts.map((override: GruntOverride) => (
              override === null ? NONE : override.gruntGroup ?? NO_GRUNT
            )) as [string, string];
            setGestureDrafts(actualGestures);
            setGruntDrafts(actualGruntDrafts);
            reportDraft(actual.playerClips, actualGestures, actualGruntDrafts);
            setMessage('Your saved animations are applied to this stream.');
          }
        }
        if (active) setLoadedStream(streamId);
      } catch (cause) {
        if (active) {
          setError(cause instanceof Error ? cause.message : 'Stream animations could not be loaded.');
          if (savedLoaded) setLoadedStream(streamId);
        }
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [broadcastId, anyOpen, open[0], open[1], suppressRememberedRestore]);

  if (!anyOpen) return null;

  function change(index: 0 | 1, stroke: NativeMotionStroke, clipId: string, hand?: NativeMotionHand | '') {
    const next: [Draft, Draft] = [{ ...drafts[0] }, { ...drafts[1] }];
    if (!clipId) delete next[index][stroke];
    else next[index][stroke] = {
      clipId,
      sourceHandedness: hand ?? catalog?.clips.find((clip) => clip.id === clipId)?.sourceHandedness ?? '',
    };
    setDrafts(next);
    reportDraft(next);
    setMessage('');
  }

  function changeGesture(index: 0 | 1, type: string, pick: NativeMotionGesturePick | null) {
    const next: [GestureDraft, GestureDraft] = [{ ...gestureDrafts[0] }, { ...gestureDrafts[1] }];
    if (!pick) delete next[index][type];
    else next[index][type] = pick;
    setGestureDrafts(next);
    reportDraft(drafts, next);
    setMessage('');
  }

  function changeGrunt(index: 0 | 1, value: string) {
    const next = [...gruntDrafts] as [string, string];
    next[index] = value;
    setGruntDrafts(next);
    reportDraft(drafts, gestureDrafts, next);
    setMessage('');
  }

  async function save() {
    if (!broadcastId || loadedStream !== broadcastId || !owner) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      for (const index of [0, 1] as const) {
        if (!open[index]) continue;
        for (const stroke of NATIVE_MOTION_STROKES) {
          const pick = drafts[index][stroke];
          if (pick && !pick.sourceHandedness) {
            throw new Error(`Confirm which hand the original ${nativeMotionStrokeLabel(stroke).toLowerCase()} clip uses.`);
          }
        }
      }
      const playerClips = ([0, 1] as const).map((index) => (open[index] ? complete(drafts[index]) : null));
      const playerGestures = ([0, 1] as const).map((index) => (open[index] ? gestureDrafts[index] : null));
      const playerGruntOverrides = gruntDrafts.map((value) => (
        value === NONE ? null : { gruntGroup: value === NO_GRUNT ? null : value }
      )) as [GruntOverride, GruntOverride];
      const response = await fetch(`/api/live-dmo/${encodeURIComponent(broadcastId)}/animations`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          playerClips,
          ...(gestureCatalog ? { playerGestures } : {}),
          playerGruntOverrides,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Stream animations could not be saved.');
      ([0, 1] as const).forEach((index) => { if (open[index]) remember(owner, index, complete(drafts[index])); });
      setMessage('Saved. Viewers see the new animations within about 10 seconds.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Stream animations could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.animationPicker} aria-labelledby="stream-animation-title">
      <button type="button" className={styles.secondaryButton} aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)} id="stream-animation-title">
        {expanded ? 'Hide animations' : 'Choose animations'}
      </button>
      {expanded && (
        <>
          <small className={styles.characterRosterStatus}>
            Choose motion, gesture, and grunt overrides for either player, including players with a WTSL character.
            Stroke choices are remembered on this device; other choices are saved to this stream.
          </small>
          {!catalog && !error && <small role="status">Loading animations…</small>}
          {catalog && ([0, 1] as const).filter((index) => open[index]).map((index) => (
            <fieldset className={styles.animationPlayer} key={index}
              disabled={disabled || busy || Boolean(broadcastId && loadedStream !== broadcastId)}>
              <legend>{labels[index]}</legend>
              <label className={styles.bestOf}>
                <span>Grunt bank</span>
                <select value={gruntDrafts[index]} onChange={(event) => changeGrunt(index, event.currentTarget.value)}>
                  <option value={NONE}>Use character profile</option>
                  <option value={NO_GRUNT}>No grunt</option>
                  {gruntGroups.map((group) => <option key={group.id} value={group.id}>{group.label}</option>)}
                </select>
              </label>
              {NATIVE_MOTION_STROKES.map((stroke) => {
                const pick = drafts[index][stroke];
                const labelId = `stream-${index}-${stroke}-label`;
                return (
                  <div className={styles.animationStroke} key={stroke}>
                    <label className={styles.bestOf}>
                      <span id={labelId}>{nativeMotionStrokeLabel(stroke)}</span>
                      <SearchableClipSelect
                        id={`stream-${index}-${stroke}-clip`} labelledBy={labelId}
                        value={pick?.clipId ?? ''}
                        options={[
                          { value: '', label: 'Standard motion' },
                          ...catalog.clips.filter((clip) => nativeMotionClipSupportsStroke(clip, stroke)).map((clip) => ({
                            value: clip.id,
                            label: [clip.sourceBundle, clip.originalClipName].filter(Boolean).join(' · ') || clip.id,
                          })),
                        ]}
                        onChange={(clipId) => change(index, stroke, clipId)}
                      />
                    </label>
                    {pick && !catalog.clips.find((clip) => clip.id === pick.clipId)?.sourceHandedness && (
                      <label className={styles.bestOf}>
                        <span>Hand used in the original clip</span>
                        <select value={pick.sourceHandedness}
                          onChange={(event) => change(index, stroke, pick.clipId, event.target.value as NativeMotionHand | '')}>
                          <option value="">Choose</option>
                          <option value="right">Right-handed</option>
                          <option value="left">Left-handed</option>
                        </select>
                      </label>
                    )}
                  </div>
                );
              })}
              <div className={styles.animationStroke}>
                <strong>Gesture clips</strong>
                <small>Used for selected long-rally and match reactions.</small>
                {!gestureCatalog && (
                  <small role="status">
                    {gestureCatalogStatus === 'loading'
                      ? 'Loading gesture clips…'
                      : 'Gesture clips are not available from Core yet; existing motion is unchanged.'}
                  </small>
                )}
                {gestureCatalog && [...new Set(gestureCatalog.clips
                  .filter((clip) => clip.events?.kind === 'gesture' && clip.events.gesture)
                  .map((clip) => clip.events!.gesture!))].map((type) => (
                  <GestureClipSetPicker
                    key={type}
                    id={`stream-${index}-gesture-${type}`}
                    type={type}
                    catalog={gestureCatalog}
                    value={gestureDrafts[index][type]}
                    emptyLabel="No gesture clip"
                    onChange={(pick) => changeGesture(index, type, pick)}
                    className={styles.bestOf}
                    buttonClassName={styles.secondaryButton}
                  />
                ))}
              </div>
            </fieldset>
          ))}
          {broadcastId && catalog && (
            <button type="button" className={styles.secondaryButton}
              disabled={disabled || busy || loadedStream !== broadcastId} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save live settings'}
            </button>
          )}
        </>
      )}
      {error && <p className={styles.characterRosterStatus} role="alert">{error}</p>}
      {message && <p className={styles.characterRosterStatus} role="status">{message}</p>}
    </section>
  );
}

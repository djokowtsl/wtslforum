'use client';

import { useEffect, useState } from 'react';
import {
  NATIVE_MOTION_STROKES,
  nativeMotionClipSupportsStroke,
  nativeMotionStrokeLabel,
  type NativeMotionCatalog,
  type NativeMotionHand,
  type NativeMotionPicks,
  type NativeMotionStroke,
} from '@/lib/nativeMotionCatalogData';
import { NATIVE_MOTION_CATALOG_SHA256 } from '@/lib/nativeMotionCatalog';
import SearchableClipSelect from './SearchableClipSelect';
import styles from './DmoLiveHost.module.css';

type Draft = Partial<Record<NativeMotionStroke, { clipId: string; sourceHandedness: NativeMotionHand | '' }>>;
type Props = {
  broadcastId: string;
  open: readonly [boolean, boolean];
  labels: readonly [string, string];
};

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

/** Per-stream choices for no-character players, remembered per streamer/device. */
export default function LiveStreamAnimationPicker({ broadcastId, open, labels }: Props) {
  const [catalog, setCatalog] = useState<NativeMotionCatalog | null>(null);
  const [drafts, setDrafts] = useState<[Draft, Draft]>([{}, {}]);
  const [owner, setOwner] = useState('');
  const [loadedStream, setLoadedStream] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [expanded, setExpanded] = useState(false);
  const anyOpen = open[0] || open[1];

  useEffect(() => {
    if (!anyOpen) return;
    let active = true;
    fetch(`/api/native-motion/${NATIVE_MOTION_CATALOG_SHA256}/catalog.json`, { cache: 'force-cache' })
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
    const controller = new AbortController();
    let savedLoaded = false;
    setLoadedStream('');
    setError('');
    setMessage('');
    (async () => {
      try {
        const endpoint = `/api/live-dmo/${encodeURIComponent(broadcastId)}/animations`;
        const response = await fetch(endpoint, { cache: 'no-store', signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Stream animations could not be loaded.');
        const saved = body.playerClips as [NativeMotionPicks, NativeMotionPicks];
        if (!Array.isArray(saved) || saved.length !== 2 || !body.ownerDiscordId) throw new Error('Invalid stream animation response.');
        const streamer = String(body.ownerDiscordId);
        const next: [Draft, Draft] = [{ ...saved[0] }, { ...saved[1] }];
        const apply: [NativeMotionPicks | null, NativeMotionPicks | null] = [null, null];
        ([0, 1] as const).forEach((index) => {
          if (!open[index] || Object.keys(saved[index] ?? {}).length) return;
          const picks = complete(remembered(streamer, index));
          if (!Object.keys(picks).length) return;
          apply[index] = picks;
        });
        if (!active) return;
        setOwner(streamer);
        setDrafts(next);
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
            setMessage('Your saved animations are applied to this stream.');
          }
        }
        if (active) setLoadedStream(broadcastId);
      } catch (cause) {
        if (active) {
          setError(cause instanceof Error ? cause.message : 'Stream animations could not be loaded.');
          if (savedLoaded) setLoadedStream(broadcastId);
        }
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [broadcastId, anyOpen, open[0], open[1]]);

  if (!anyOpen) return null;

  function change(index: 0 | 1, stroke: NativeMotionStroke, clipId: string, hand?: NativeMotionHand | '') {
    setDrafts((current) => {
      const next: [Draft, Draft] = [{ ...current[0] }, { ...current[1] }];
      if (!clipId) delete next[index][stroke];
      else next[index][stroke] = {
        clipId,
        sourceHandedness: hand ?? catalog?.clips.find((clip) => clip.id === clipId)?.sourceHandedness ?? '',
      };
      return next;
    });
    setMessage('');
  }

  async function save() {
    if (loadedStream !== broadcastId || !owner) return;
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
      const response = await fetch(`/api/live-dmo/${encodeURIComponent(broadcastId)}/animations`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ playerClips }),
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
            For players with no WTSL character, such as a created character. One clip per stroke;
            leave a stroke empty for standard motion. Remembered on this device for your next stream.
          </small>
          {!catalog && !error && <small role="status">Loading animations…</small>}
          {catalog && ([0, 1] as const).filter((index) => open[index]).map((index) => (
            <fieldset className={styles.animationPlayer} key={index} disabled={busy || loadedStream !== broadcastId}>
              <legend>{labels[index]}</legend>
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
            </fieldset>
          ))}
          {catalog && (
            <button type="button" className={styles.secondaryButton}
              disabled={busy || loadedStream !== broadcastId} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save animations'}
            </button>
          )}
        </>
      )}
      {error && <p className={styles.characterRosterStatus} role="alert">{error}</p>}
      {message && <p className={styles.characterRosterStatus} role="status">{message}</p>}
    </section>
  );
}

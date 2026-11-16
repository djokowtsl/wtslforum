'use client';

import { useEffect, useState, type FormEvent } from 'react';
import {
  NATIVE_MOTION_STROKES,
  nativeMotionGestureClips,
  nativeMotionGestureClipIds,
  nativeMotionStrokeLabel,
  nativeMotionClipSupportsStroke,
  type NativeMotionCatalog,
  type NativeMotionGesturePick,
  type NativeMotionGesturePicks,
  type NativeMotionHand,
  type NativeMotionPicks,
  type NativeMotionStroke,
} from '@/lib/nativeMotionCatalogData';
import { NATIVE_MOTION_GESTURE_CATALOG_SHA256 } from '@/lib/nativeMotionCatalog';
import { getDmoCharacterGruntGroups } from '@/lib/dmoCharacterAppearance.mjs';
import styles from './NativeMotionAdmin.module.css';
import SearchableClipSelect from './SearchableClipSelect';
import GestureClipSetPicker from './GestureClipSetPicker';

type Draft = Partial<Record<NativeMotionStroke, { clipId: string; sourceHandedness: NativeMotionHand | '' }>>;
type Target = {
  id: string;
  type: 'replay' | 'manual';
  players: [string, string];
  characters: [string | null, string | null];
  label: string;
  playerClips: [NativeMotionPicks, NativeMotionPicks];
  playerGestures: [NativeMotionGesturePicks, NativeMotionGesturePicks];
  playerGruntOverrides: [null | { gruntGroup: string | null }, null | { gruntGroup: string | null }];
};
const keyFor = (target: Target) => `${target.type}:${target.id}`;
const USE_PROFILE = '__profile__';
const NO_GRUNT = '__no_grunt__';

export default function NativeMotionMatchOverrides({ catalog }: { catalog?: NativeMotionCatalog }) {
  const [query, setQuery] = useState('');
  const [targets, setTargets] = useState<Target[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [drafts, setDrafts] = useState<Record<string, [Draft, Draft]>>({});
  const [gestureCatalog, setGestureCatalog] = useState<NativeMotionCatalog | null>(null);
  const [gestureCatalogStatus, setGestureCatalogStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [gestureDrafts, setGestureDrafts] = useState<
    Record<string, [NativeMotionGesturePicks, NativeMotionGesturePicks]>
  >({});
  const [gruntDrafts, setGruntDrafts] = useState<Record<string, [string, string]>>({});
  const gruntGroups = getDmoCharacterGruntGroups();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const selected = targets.find((target) => keyFor(target) === selectedKey) ?? null;
  const picks = drafts[selectedKey] ?? [{}, {}];
  const gesturePicks = gestureDrafts[selectedKey] ?? [{}, {}];
  const gruntPicks = gruntDrafts[selectedKey] ?? [USE_PROFILE, USE_PROFILE];
  const gestureTypes = gestureCatalog
    ? [...new Set(gestureCatalog.clips
      .filter((clip) => clip.events?.kind === 'gesture' && clip.events.gesture)
      .map((clip) => clip.events!.gesture!))]
    : [];

  useEffect(() => {
    let active = true;
    fetch(`/api/native-motion/${NATIVE_MOTION_GESTURE_CATALOG_SHA256}/catalog.json`, { cache: 'force-cache' })
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
  }, []);

  async function load(search: string, signal?: AbortSignal) {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/admin/native-motion/player-overrides?q=${encodeURIComponent(search)}`, {
        cache: 'no-store', signal,
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Match choices could not be loaded.');
      const next = body.targets as Target[];
      setTargets(next);
      setDrafts(Object.fromEntries(next.map((target) => [keyFor(target), target.playerClips])));
      setGestureDrafts(Object.fromEntries(next.map((target) => [
        keyFor(target),
        target.playerGestures ?? [{}, {}],
      ])));
      setGruntDrafts(Object.fromEntries(next.map((target) => [
        keyFor(target),
        target.playerGruntOverrides.map((override) => (
          override === null ? USE_PROFILE : override.gruntGroup ?? NO_GRUNT
        )) as [string, string],
      ])) as Record<string, [string, string]>);
      setSelectedKey(next.length === 1 ? keyFor(next[0]) : '');
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
        setError(cause instanceof Error ? cause.message : 'Match choices could not be loaded.');
      }
    } finally { if (!signal?.aborted) setLoading(false); }
  }

  useEffect(() => {
    const controller = new AbortController();
    void load('', controller.signal);
    return () => controller.abort();
  }, []);

  function change(player: 0 | 1, stroke: NativeMotionStroke, clipId: string, hand?: NativeMotionHand | '') {
    setDrafts((current) => {
      const pair = current[selectedKey] ?? [{}, {}];
      const next: [Draft, Draft] = [{ ...pair[0] }, { ...pair[1] }];
      if (!clipId) delete next[player][stroke];
      else next[player][stroke] = {
        clipId,
        sourceHandedness: hand ?? catalog?.clips.find((clip) => clip.id === clipId)?.sourceHandedness ?? '',
      };
      return { ...current, [selectedKey]: next };
    });
    setMessage('');
  }

  function changeGesture(player: 0 | 1, type: string, pick: NativeMotionGesturePick | null) {
    setGestureDrafts((current) => {
      const pair = current[selectedKey] ?? [{}, {}];
      const next: [NativeMotionGesturePicks, NativeMotionGesturePicks] = [
        { ...pair[0] },
        { ...pair[1] },
      ];
      if (!pick) delete next[player][type];
      else next[player][type] = pick;
      return { ...current, [selectedKey]: next };
    });
    setMessage('');
  }

  async function save() {
    if (!selected) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (catalog) {
        for (const player of picks) {
          for (const stroke of NATIVE_MOTION_STROKES) {
            if (player[stroke] && !player[stroke]?.sourceHandedness) {
              throw new Error(`Confirm the original handedness for each selected ${stroke} clip.`);
            }
          }
        }
      }
      if (gestureCatalog) {
        for (const player of gesturePicks) {
          for (const [type, pick] of Object.entries(player)) {
            const available = new Set(nativeMotionGestureClips(gestureCatalog, type).map((clip) => clip.id));
            const ids = nativeMotionGestureClipIds(pick);
            if (!ids.length || !ids.every((id) => available.has(id))) {
              throw new Error(`Choose a valid clip for the ${type} gesture.`);
            }
          }
        }
      }
      const response = await fetch('/api/admin/native-motion/player-overrides', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          targetType: selected.type,
          targetId: selected.id,
          ...(catalog ? { playerClips: picks } : {}),
          ...(gestureCatalog ? { playerGestures: gesturePicks } : {}),
          playerGruntOverrides: gruntPicks.map((value) => (
            value === USE_PROFILE ? null : { gruntGroup: value === NO_GRUNT ? null : value }
          )),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Match choices could not be saved.');
      setMessage(catalog || gestureCatalog
        ? 'Saved for this match only. Reopen the replay to load selected clips and gestures; live streams update automatically.'
        : 'Grunt choices saved for this match only.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Match choices could not be saved.');
    } finally { setBusy(false); }
  }

  function search(event: FormEvent) {
    event.preventDefault();
    setMessage('');
    void load(query);
  }

  return (
    <section className={styles.card} aria-labelledby="match-animation-title">
      <h2 id="match-animation-title">Choose animations and grunts for a specific match</h2>
      <p>
        Select a submitted replay or an active manual stream. Search by player, tournament, or replay ID.
        Match-specific grunt choices work independently of the animation catalog.
      </p>
      {(catalog || gestureCatalog) && (
        <p className={styles.notice}>
          One selected clip plays for each stroke. A gesture type can hold several animations, which play in turn.
          All stroke variants, including hidden and acceleration variants, remain available; gesture lists show compatible visible clips.
          These choices override character profiles only for the selected match.
        </p>
      )}
      <form className={styles.searchRow} onSubmit={search}>
        <label className={styles.field}>
          <span>Find a replay by player, tournament, or ID</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)}
            placeholder="Player name, Shenzhen, or 25" maxLength={100} />
        </label>
        <button type="submit" className="btn btn-sm" disabled={loading}>Search matches</button>
      </form>
      <label className={styles.field}>
        <span>Replay or active manual stream</span>
        <select value={selectedKey} disabled={loading} onChange={(event) => {
          setSelectedKey(event.target.value); setMessage(''); setError('');
        }}>
          <option value="">{loading ? 'Loading matches…' : 'Choose a match'}</option>
          {targets.map((target) => (
            <option key={keyFor(target)} value={keyFor(target)}>
              {target.type === 'manual' ? 'LIVE · ' : ''}{target.players.join(' vs ')} · {target.label}
            </option>
          ))}
        </select>
      </label>
      {!loading && !targets.length && <p>No matching rendered replays or active manual streams were found.</p>}
      {selected && (
        <>
          <div className={styles.playerChoices}>
            {([0, 1] as const).map((index) => (
              <fieldset className={styles.stroke} key={index}>
                <legend>{selected.players[index]}{selected.characters[index] ? ` (${selected.characters[index]})` : ''}</legend>
                <label className={styles.field}>
                  <span>Grunt bank</span>
                  <select value={gruntPicks[index]} disabled={busy} onChange={(event) => {
                    const next = [...gruntPicks] as [string, string];
                    next[index] = event.currentTarget.value;
                    setGruntDrafts((current) => ({ ...current, [selectedKey]: next }));
                    setMessage('');
                  }}>
                    <option value={USE_PROFILE}>Use character profile</option>
                    <option value={NO_GRUNT}>No grunt</option>
                    {gruntGroups.map((group) => <option value={group.id} key={group.id}>{group.label}</option>)}
                  </select>
                </label>
                {catalog && NATIVE_MOTION_STROKES.map((stroke) => {
                  const pick = picks[index][stroke];
                  return (
                    <div className={styles.matchStroke} key={stroke}>
                      <label className={styles.field}>
                        <span id={`match-${index}-${stroke}-label`}>
                          {nativeMotionStrokeLabel(stroke)} version
                        </span>
                        <SearchableClipSelect
                          id={`match-${index}-${stroke}-clip`}
                          labelledBy={`match-${index}-${stroke}-label`}
                          value={pick?.clipId ?? ''}
                          options={[
                            { value: '', label: 'Use saved profile or standard motion' },
                            ...catalog.clips
                              .filter((clip) => nativeMotionClipSupportsStroke(clip, stroke))
                              .map((clip) => ({
                                value: clip.id,
                                label: [
                                  clip.sourceBundle,
                                  clip.originalClipName,
                                  clip.hidden ? 'hidden' : '',
                                  clip.accelerationVariant ? 'acceleration variant' : '',
                                ].filter(Boolean).join(' · '),
                              })),
                          ]}
                          onChange={(clipId) => change(index, stroke, clipId)}
                        />
                      </label>
                      {pick && (
                        <label className={styles.field}>
                          <span>Hand used in the original {stroke} clip</span>
                          <select value={pick.sourceHandedness} onChange={(event) => change(index, stroke, pick.clipId, event.target.value as NativeMotionHand | '')}>
                            <option value="">Confirm original handedness</option>
                            <option value="right">Right-handed source</option>
                            <option value="left">Left-handed source</option>
                          </select>
                        </label>
                      )}
                    </div>
                  );
                })}
                <div className={styles.matchStroke}>
                  <strong>Gesture clips</strong>
                  <small>Optional per-player choices for match reactions.</small>
                  {!gestureCatalog && (
                    <small role="status">
                      {gestureCatalogStatus === 'loading'
                        ? 'Loading gesture clips…'
                        : 'Gesture clips are unavailable. Existing choices will be preserved.'}
                    </small>
                  )}
                  {gestureCatalog && gestureTypes.map((type) => (
                    <GestureClipSetPicker
                      key={type}
                      id={`match-${index}-gesture-${type}`}
                      type={type}
                      catalog={gestureCatalog}
                      value={gesturePicks[index][type]}
                      emptyLabel="Use character/default gesture"
                      onChange={(pick) => changeGesture(index, type, pick)}
                      className={styles.field}
                      buttonClassName="btn btn-ghost"
                    />
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
          <div className={styles.actions}>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save this match’s animations'}
            </button>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => {
              setDrafts((current) => ({ ...current, [selectedKey]: [{}, {}] }));
              if (gestureCatalog) setGestureDrafts((current) => ({ ...current, [selectedKey]: [{}, {}] }));
              setGruntDrafts((current) => ({ ...current, [selectedKey]: [USE_PROFILE, USE_PROFILE] }));
              setMessage(catalog || gestureCatalog
                ? gestureCatalog
                  ? 'Overrides cleared in the form. Save to restore character gestures, profile grunts, and standard motion.'
                  : 'Stroke and grunt overrides cleared in the form. Saved gesture choices were preserved because the gesture catalog is unavailable.'
                : 'Grunt overrides cleared in the form. Save to restore character profile grunts.');
            }}>{catalog || gestureCatalog ? 'Clear match overrides' : 'Use character profile grunts'}</button>
          </div>
        </>
      )}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {message && <p className={styles.success} role="status">{message}</p>}
    </section>
  );
}

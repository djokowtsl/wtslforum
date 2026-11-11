'use client';

import { useEffect, useState, type FormEvent } from 'react';
import {
  NATIVE_MOTION_STROKES,
  nativeMotionClipSupportsStroke,
  type NativeMotionCatalog,
  type NativeMotionHand,
  type NativeMotionPicks,
  type NativeMotionStroke,
} from '@/lib/nativeMotionCatalogData';
import { getDmoCharacterGruntGroups } from '@/lib/dmoCharacterAppearance.mjs';
import styles from './NativeMotionAdmin.module.css';
import SearchableClipSelect from './SearchableClipSelect';

type Draft = Partial<Record<NativeMotionStroke, { clipId: string; sourceHandedness: NativeMotionHand | '' }>>;
type Target = {
  id: string;
  type: 'replay' | 'manual';
  players: [string, string];
  characters: [string | null, string | null];
  label: string;
  playerClips: [NativeMotionPicks, NativeMotionPicks];
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
  const [gruntDrafts, setGruntDrafts] = useState<Record<string, [string, string]>>({});
  const gruntGroups = getDmoCharacterGruntGroups();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const selected = targets.find((target) => keyFor(target) === selectedKey) ?? null;
  const picks = drafts[selectedKey] ?? [{}, {}];
  const gruntPicks = gruntDrafts[selectedKey] ?? [USE_PROFILE, USE_PROFILE];

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
      const response = await fetch('/api/admin/native-motion/player-overrides', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          targetType: selected.type,
          targetId: selected.id,
          ...(catalog ? { playerClips: picks } : {}),
          playerGruntOverrides: gruntPicks.map((value) => (
            value === USE_PROFILE ? null : { gruntGroup: value === NO_GRUNT ? null : value }
          )),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Match choices could not be saved.');
      setMessage(catalog
        ? 'Saved for this match only. Reopen the replay to load the selected clips; live streams update automatically.'
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
      {catalog && (
        <p className={styles.notice}>
          One selected clip plays for each stroke—no cycling or random versions.
          All versions, including hidden and acceleration variants, are available. These choices override character profiles only for the selected match.
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
                          {stroke[0].toUpperCase() + stroke.slice(1)} version
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
              </fieldset>
            ))}
          </div>
          <div className={styles.actions}>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save this match’s animations'}
            </button>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => {
              setDrafts((current) => ({ ...current, [selectedKey]: [{}, {}] }));
              setGruntDrafts((current) => ({ ...current, [selectedKey]: [USE_PROFILE, USE_PROFILE] }));
              setMessage(catalog
                ? 'Overrides cleared in the form. Save to restore profile grunts and standard motion.'
                : 'Grunt overrides cleared in the form. Save to restore character profile grunts.');
            }}>{catalog ? 'Clear match overrides' : 'Use character profile grunts'}</button>
          </div>
        </>
      )}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {message && <p className={styles.success} role="status">{message}</p>}
    </section>
  );
}

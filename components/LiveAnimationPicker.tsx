'use client';

import { useEffect, useMemo, useState } from 'react';
import { NATIVE_MOTION_CATALOG_SHA256 } from '@/lib/nativeMotionCatalog';
import {
  NATIVE_MOTION_STROKES,
  nativeMotionStrokeLabel,
  nativeMotionClipSupportsStroke,
  type NativeMotionCatalog,
  type NativeMotionHand,
  type NativeMotionPicks,
  type NativeMotionStroke,
} from '@/lib/nativeMotionCatalogData';
import { getDmoCharacterGruntGroups } from '@/lib/dmoCharacterAppearance.mjs';
import NativeMotionStyles from './NativeMotionAdmin.module.css';
import SearchableClipSelect from './SearchableClipSelect';
import styles from './LiveAnimationPicker.module.css';

type DraftPick = { clipId: string; sourceHandedness: NativeMotionHand | '' };
type PlayerDraft = Record<NativeMotionStroke, DraftPick>;
type Props = {
  broadcastId: string;
  players: readonly [string, string];
  playerCharacters: readonly [string | null, string | null];
};

const NONE = '__profile_default__';
const NO_GRUNT = '__no_grunt__';
const EMPTY_PICK: DraftPick = { clipId: '', sourceHandedness: '' };

function emptyPlayer(): PlayerDraft {
  return {
    forehand: { ...EMPTY_PICK },
    backhand: { ...EMPTY_PICK },
    serve: { ...EMPTY_PICK },
    'slice-forehand': { ...EMPTY_PICK },
    'slice-backhand': { ...EMPTY_PICK },
  };
}

function draftFromPicks(picks: [NativeMotionPicks, NativeMotionPicks]): [PlayerDraft, PlayerDraft] {
  return picks.map((player) => Object.fromEntries(NATIVE_MOTION_STROKES.map((stroke) => {
    const pick = player[stroke];
    return [stroke, pick
      ? { clipId: pick.clipId, sourceHandedness: pick.sourceHandedness }
      : { ...EMPTY_PICK }];
  }))) as [PlayerDraft, PlayerDraft];
}

function parseError(value: unknown, fallback: string) {
  return value && typeof value === 'object'
    && 'error' in value && typeof value.error === 'string'
    ? value.error
    : fallback;
}

function clipLabel(clip: NativeMotionCatalog['clips'][number]) {
  return [
    clip.sourceBundle,
    clip.originalClipName,
    clip.accelerationVariant ? 'acceleration variant' : '',
  ].filter(Boolean).join(' · ');
}

export default function LiveAnimationPicker({ broadcastId, players, playerCharacters }: Props) {
  const [catalog, setCatalog] = useState<NativeMotionCatalog | null>(null);
  const [draft, setDraft] = useState<[PlayerDraft, PlayerDraft]>([emptyPlayer(), emptyPlayer()]);
  const [gruntOverrides, setGruntOverrides] = useState<[string, string]>([NONE, NONE]);
  const gruntGroups = useMemo(() => getDmoCharacterGruntGroups(), []);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const [catalogResponse, overridesResponse] = await Promise.all([
          fetch(`/api/native-motion/${NATIVE_MOTION_CATALOG_SHA256}/catalog.json`, { cache: 'force-cache' }),
          fetch(`/api/native-motion/live-overrides?broadcastId=${encodeURIComponent(broadcastId)}`, { cache: 'no-store' }),
        ]);
        const [catalogPayload, overridesPayload] = await Promise.all([
          catalogResponse.json().catch(() => null),
          overridesResponse.json().catch(() => null),
        ]);
        if (!catalogResponse.ok) throw new Error(parseError(catalogPayload, 'Animation clips could not be loaded.'));
        if (!overridesResponse.ok) throw new Error(parseError(overridesPayload, 'Saved live choices could not be loaded.'));
        if (!catalogPayload || catalogPayload.format !== 'WTMC1' || !Array.isArray(catalogPayload.clips)) {
          throw new Error('The animation catalog is invalid.');
        }
        const saved = Array.isArray(overridesPayload?.playerClips)
          ? overridesPayload.playerClips as [NativeMotionPicks, NativeMotionPicks]
          : [{}, {}] as [NativeMotionPicks, NativeMotionPicks];
        const savedGrunts = Array.isArray(overridesPayload?.playerGruntOverrides)
          ? overridesPayload.playerGruntOverrides
          : [null, null];
        if (active) {
          setCatalog(catalogPayload as NativeMotionCatalog);
          setDraft(draftFromPicks(saved));
          setGruntOverrides(savedGrunts.map((override: { gruntGroup: string | null } | null) => (
            override === null ? NONE : override.gruntGroup ?? NO_GRUNT
          )) as [string, string]);
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Live animation choices could not be loaded.');
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [broadcastId]);

  const clipOptions = useMemo(() => Object.fromEntries(NATIVE_MOTION_STROKES.map((stroke) => [
    stroke,
    [
      { value: NONE, label: 'Use character profile or default' },
      ...(catalog?.clips ?? [])
        .filter((clip) => !clip.hidden && nativeMotionClipSupportsStroke(clip, stroke))
        .map((clip) => ({ value: clip.id, label: clipLabel(clip) })),
    ],
  ])) as Record<NativeMotionStroke, { value: string; label: string }[]>, [catalog]);

  const updatePick = (
    playerIndex: 0 | 1,
    stroke: NativeMotionStroke,
    key: keyof DraftPick,
    value: string,
  ) => {
    setNotice('');
    setDraft((current) => {
      const next = current.map((player) => ({ ...player })) as [PlayerDraft, PlayerDraft];
      if (key === 'clipId') {
        const clip = catalog?.clips.find((candidate) => candidate.id === value);
        next[playerIndex][stroke] = value === NONE
          ? { ...EMPTY_PICK }
          : {
            clipId: value,
            sourceHandedness: clip?.sourceHandedness ?? '',
          };
      } else {
        next[playerIndex][stroke] = {
          ...next[playerIndex][stroke],
          sourceHandedness: value as NativeMotionHand | '',
        };
      }
      return next;
    });
  };

  const save = async () => {
    if (saving || loading || !catalog) return;
    for (const player of draft) {
      for (const stroke of NATIVE_MOTION_STROKES) {
        if (player[stroke].clipId && !player[stroke].sourceHandedness) {
          setError(`Choose source handedness for the ${stroke} clip before saving.`);
          return;
        }
      }
    }
    setSaving(true);
    setError('');
    setNotice('');
    const playerClips = draft.map((player) => Object.fromEntries(NATIVE_MOTION_STROKES.flatMap((stroke) => {
      const pick = player[stroke];
      return pick.clipId
        ? [[stroke, { clipId: pick.clipId, sourceHandedness: pick.sourceHandedness }]]
        : [];
    }))) as [NativeMotionPicks, NativeMotionPicks];
    const playerGruntOverrides = gruntOverrides.map((value) => (
      value === NONE
        ? null
        : { gruntGroup: value === NO_GRUNT ? null : value }
    )) as [null | { gruntGroup: string | null }, null | { gruntGroup: string | null }];
    try {
      const response = await fetch('/api/native-motion/live-overrides', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ broadcastId, playerClips, playerGruntOverrides }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(parseError(payload, 'Live animation choices could not be saved.'));
      setNotice('Live animations saved. Viewers will use them on the next court refresh.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Live animation choices could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={styles.picker} aria-labelledby={`live-animation-title-${broadcastId}`}>
      <div className={styles.heading}>
        <div>
          <h3 id={`live-animation-title-${broadcastId}`}>Live animation choices</h3>
          <p>Override a player’s character profile for this stream, or use the profile defaults.</p>
        </div>
        <button type="button" className={NativeMotionStyles.secondaryButton} onClick={() => void save()} disabled={saving || loading || !catalog}>
          {saving ? 'Saving…' : 'Save choices'}
        </button>
      </div>
      {loading && <p role="status">Loading animation clips and saved choices…</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      {!loading && catalog && (
        <div className={styles.players}>
          {([0, 1] as const).map((playerIndex) => (
            <fieldset className={styles.player} key={playerIndex}>
              <legend>
                <strong>{players[playerIndex]}</strong>
                {playerCharacters[playerIndex] && <span> · {playerCharacters[playerIndex]}</span>}
              </legend>
              <label className={NativeMotionStyles.field}>
                <span>Grunt bank</span>
                <select
                  value={gruntOverrides[playerIndex]}
                  disabled={saving}
                  onChange={(event) => {
                    const next = [...gruntOverrides] as [string, string];
                    next[playerIndex] = event.currentTarget.value;
                    setGruntOverrides(next);
                    setNotice('');
                  }}
                >
                  <option value={NONE}>Use character profile</option>
                  <option value={NO_GRUNT}>No grunt</option>
                  {gruntGroups.map((group) => <option key={group.id} value={group.id}>{group.label}</option>)}
                </select>
              </label>
              {NATIVE_MOTION_STROKES.map((stroke) => {
                const labelId = `live-motion-${broadcastId}-${playerIndex}-${stroke}`;
                const pick = draft[playerIndex][stroke];
                return (
                  <div className={styles.stroke} key={stroke}>
                    <label className={NativeMotionStyles.field}>
                      <span id={labelId}>{nativeMotionStrokeLabel(stroke)} clip</span>
                      <SearchableClipSelect
                        id={`${labelId}-clip`}
                        labelledBy={labelId}
                        value={pick.clipId || NONE}
                        options={clipOptions[stroke]}
                        disabled={saving}
                        onChange={(value) => updatePick(playerIndex, stroke, 'clipId', value)}
                        placeholder="Search clips"
                      />
                    </label>
                    {pick.clipId && (
                      <label className={NativeMotionStyles.field}>
                        <span>Source handedness</span>
                        <select
                          value={pick.sourceHandedness}
                          disabled={saving}
                          onChange={(event) => updatePick(
                            playerIndex,
                            stroke,
                            'sourceHandedness',
                            event.currentTarget.value,
                          )}
                        >
                          <option value="">Choose handedness</option>
                          <option value="right">Right-handed clip</option>
                          <option value="left">Left-handed clip</option>
                        </select>
                      </label>
                    )}
                  </div>
                );
              })}
            </fieldset>
          ))}
        </div>
      )}
    </section>
  );
}

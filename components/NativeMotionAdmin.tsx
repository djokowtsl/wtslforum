'use client';

import { useEffect, useMemo, useState } from 'react';
import { NATIVE_MOTION_CATALOG_SHA256 } from '@/lib/nativeMotionCatalog';
import {
  firstValidNativeMotionClip,
  NATIVE_MOTION_AUTOMATIC_PROFILE_KEY,
  NATIVE_MOTION_STROKES,
  nativeMotionCharacterDefaults,
  nativeMotionClipSupportsStroke,
  nativeMotionProfileKey,
  type NativeMotionCatalog,
  type NativeMotionCatalogClip,
  type NativeMotionHand,
  type NativeMotionPicks,
  type NativeMotionProfile,
  type NativeMotionStroke,
} from '@/lib/nativeMotionCatalogData';
import styles from './NativeMotionAdmin.module.css';
import NativeMotionMatchOverrides from './NativeMotionMatchOverrides';
import SearchableClipSelect from './SearchableClipSelect';

type DraftPick = { clipId: string; sourceHandedness: NativeMotionHand | '' };
type Broadcast = {
  id: string;
  players: [string, string];
  startedAt: string;
  profileKeys: [string | null, string | null];
};

const EMPTY_PICK: DraftPick = { clipId: '', sourceHandedness: '' };
const NONE_PROFILE = '__use_character_profile__';

function emptyPicks(): Record<NativeMotionStroke, DraftPick> {
  return {
    forehand: { ...EMPTY_PICK },
    backhand: { ...EMPTY_PICK },
    serve: { ...EMPTY_PICK },
  };
}

function fallbackPicks(catalog: NativeMotionCatalog): Record<NativeMotionStroke, DraftPick> {
  return Object.fromEntries(NATIVE_MOTION_STROKES.map((stroke) => {
    const first = firstValidNativeMotionClip(catalog, stroke);
    return [stroke, {
      clipId: first?.id ?? '',
      // The source bundles do not record handedness. An admin must confirm it.
      sourceHandedness: first?.sourceHandedness ?? '',
    }];
  })) as Record<NativeMotionStroke, DraftPick>;
}

function labelForClip(clip: NativeMotionCatalogClip) {
  return [
    clip.sourceBundle,
    clip.originalClipName,
    clip.hidden ? 'hidden' : '',
    clip.accelerationVariant ? 'acceleration variant' : '',
  ].filter(Boolean).join(' · ');
}

function parseError(payload: unknown, fallback: string) {
  return payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
    ? payload.error
    : fallback;
}

export default function NativeMotionAdmin() {
  const [catalog, setCatalog] = useState<NativeMotionCatalog | null>(null);
  const [profiles, setProfiles] = useState<NativeMotionProfile[]>([]);
  const [knownCharacters, setKnownCharacters] = useState<string[]>([]);
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [selectedKey, setSelectedKey] = useState('__new__');
  const [characterName, setCharacterName] = useState('');
  const [automaticFallback, setAutomaticFallback] = useState(false);
  const [picks, setPicks] = useState<Record<NativeMotionStroke, DraftPick>>(emptyPicks);
  const [showVariants, setShowVariants] = useState(true);
  const [overrides, setOverrides] = useState<Record<string, [string, string]>>({});
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loadingError, setLoadingError] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const selectedProfile = profiles.find((profile) => profile.profileKey === selectedKey) ?? null;
  const selectedKnownCharacter = knownCharacters.find((name) => (
    nativeMotionProfileKey(name) === nativeMotionProfileKey(characterName)
  )) ?? '';
  const filteredClips = useMemo(() => {
    return Object.fromEntries(NATIVE_MOTION_STROKES.map((stroke) => {
      const currentId = picks[stroke].clipId;
      return [stroke, catalog?.clips.filter((clip) => (
        nativeMotionClipSupportsStroke(clip, stroke)
        && (showVariants || clip.id === currentId || (!clip.hidden && !clip.accelerationVariant))
      )) ?? []];
    })) as Record<NativeMotionStroke, NativeMotionCatalogClip[]>;
  }, [catalog, picks, showVariants]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [catalogResponse, profileResponse, broadcastResponse] = await Promise.all([
          fetch(`/api/native-motion/${NATIVE_MOTION_CATALOG_SHA256}/catalog.json`, { cache: 'force-cache' }),
          fetch('/api/admin/native-motion/profiles', { cache: 'no-store' }),
          fetch('/api/admin/native-motion/broadcasts', { cache: 'no-store' }),
        ]);
        const catalogPayload = await catalogResponse.json().catch(() => null);
        if (catalogResponse.status === 404) {
          throw new Error('The animation catalog is not available on the published Bot/Core service. Republish the updated Bot/Core service, then reload this page.');
        }
        if (!catalogResponse.ok) throw new Error(parseError(catalogPayload, 'The animation catalog could not be loaded.'));
        if (!catalogPayload || catalogPayload.format !== 'WTMC1' || !Array.isArray(catalogPayload.clips)) {
          throw new Error('The animation catalog is invalid.');
        }
        if (!profileResponse.ok) {
          throw new Error(parseError(await profileResponse.json().catch(() => null), 'Motion profiles could not be loaded.'));
        }
        if (!broadcastResponse.ok) {
          throw new Error(parseError(await broadcastResponse.json().catch(() => null), 'Manual streams could not be loaded.'));
        }
        const [profilePayload, broadcastPayload] = await Promise.all([
          profileResponse.json(),
          broadcastResponse.json(),
        ]);
        if (!active) return;
        const loadedProfiles = Array.isArray(profilePayload.profiles) ? profilePayload.profiles as NativeMotionProfile[] : [];
        const loadedCharacters: string[] = Array.isArray(profilePayload.characters)
          ? profilePayload.characters.filter((name: unknown): name is string => (
            typeof name === 'string' && Boolean(name.trim())
          ))
          : [];
        const loadedBroadcasts = Array.isArray(broadcastPayload.broadcasts) ? broadcastPayload.broadcasts as Broadcast[] : [];
        setCatalog(catalogPayload as NativeMotionCatalog);
        setProfiles(loadedProfiles);
        setKnownCharacters(loadedCharacters);
        setBroadcasts(loadedBroadcasts);
        setOverrides(Object.fromEntries(loadedBroadcasts.map((broadcast) => [
          broadcast.id,
          [broadcast.profileKeys[0] ?? '', broadcast.profileKeys[1] ?? ''],
        ])));
        const savedKeys = new Set(loadedProfiles.map((profile) => profile.profileKey));
        if (loadedCharacters.some((name) => !savedKeys.has(nativeMotionProfileKey(name)))) {
          try {
            const autoResponse = await fetch('/api/admin/native-motion/profiles/auto', { method: 'POST' });
            const autoPayload = await autoResponse.json().catch(() => null);
            if (!autoResponse.ok || !autoPayload || typeof autoPayload !== 'object') {
              setMessage(parseError(autoPayload, 'Automatic character defaults could not be created.'));
            } else {
              const autoResult = autoPayload as {
                created?: unknown;
                skippedHandedness?: unknown;
                skippedClips?: unknown;
              };
              const created = Array.isArray(autoResult.created)
                ? autoResult.created as NativeMotionProfile[]
                : [];
              if (created.length) {
                const merged = [
                  ...loadedProfiles.filter((profile) => !created.some((newProfile) => newProfile.profileKey === profile.profileKey)),
                  ...created,
                ].sort((a, b) => Number(b.automaticFallback) - Number(a.automaticFallback)
                  || a.characterName.localeCompare(b.characterName));
                setProfiles(merged);
              }
              const skipped = Number(autoResult.skippedHandedness || 0) + Number(autoResult.skippedClips || 0);
              if (created.length || skipped) {
                setMessage(
                  `Created defaults for ${created.length} characters.`
                  + (skipped ? ` ${skipped} need consistent handedness data or matching clips.` : '')
                  + ' You can edit any saved profile below.',
                );
              }
            }
          } catch {
            setMessage('Automatic character defaults could not be created; you can still configure profiles below.');
          }
        }
        setLoadingError('');
      } catch (cause) {
        if (active) setLoadingError(cause instanceof Error ? cause.message : 'Animation settings could not be loaded.');
      }
    };
    void load();
    return () => { active = false; };
  }, []);

  function startNewCharacterProfile() {
    setSelectedKey('__new__');
    setCharacterName('');
    setAutomaticFallback(false);
    setPicks(emptyPicks());
    setDeleting(false);
    setMessage('');
    setError('');
  }

  function selectProfile(key: string) {
    setSelectedKey(key);
    setDeleting(false);
    setMessage('');
    setError('');
    const profile = profiles.find((candidate) => candidate.profileKey === key);
    if (profile) {
      setCharacterName(profile.characterName);
      setAutomaticFallback(profile.automaticFallback);
      const next = emptyPicks();
      for (const stroke of NATIVE_MOTION_STROKES) {
        const pick = profile.clips[stroke];
        if (pick) next[stroke] = { clipId: pick.clipId, sourceHandedness: pick.sourceHandedness };
      }
      setPicks(next);
      return;
    }
    if (key === NATIVE_MOTION_AUTOMATIC_PROFILE_KEY && catalog) {
      setCharacterName('Automatic stream fallback');
      setAutomaticFallback(true);
      setPicks(fallbackPicks(catalog));
      return;
    }
    startNewCharacterProfile();
  }

  function selectKnownCharacter(name: string) {
    if (!name) return;
    const key = nativeMotionProfileKey(name);
    const existing = profiles.find((profile) => (
      !profile.automaticFallback && profile.profileKey === key
    ));
    if (existing) {
      selectProfile(existing.profileKey);
      return;
    }
    setSelectedKey('__new__');
    setCharacterName(name);
    setAutomaticFallback(false);
    const defaults = catalog ? nativeMotionCharacterDefaults(catalog, name) : {};
    const next = emptyPicks();
    for (const stroke of NATIVE_MOTION_STROKES) {
      const clip = defaults[stroke];
      if (clip) next[stroke] = { clipId: clip.id, sourceHandedness: clip.sourceHandedness ?? '' };
    }
    setPicks(next);
    setDeleting(false);
    setMessage('');
    setError('');
  }

  function changePick(stroke: NativeMotionStroke, patch: Partial<DraftPick>) {
    setPicks((current) => ({
      ...current,
      [stroke]: { ...current[stroke], ...patch },
    }));
  }

  async function saveProfile() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const clips: NativeMotionPicks = {};
      for (const stroke of NATIVE_MOTION_STROKES) {
        const pick = picks[stroke];
        if (!pick.clipId) continue;
        if (!pick.sourceHandedness) throw new Error(`Confirm the original handedness for the ${stroke} clip.`);
        clips[stroke] = { clipId: pick.clipId, sourceHandedness: pick.sourceHandedness };
      }
      if (automaticFallback && NATIVE_MOTION_STROKES.some((stroke) => !clips[stroke])) {
        throw new Error('Automatic fallback needs a confirmed clip for every stroke.');
      }
      if (!automaticFallback && !Object.keys(clips).length) {
        throw new Error('Select at least one stroke animation.');
      }
      if (!automaticFallback && !characterName.trim()) {
        throw new Error('Enter the character name exactly as it appears in replay data.');
      }
      const response = await fetch('/api/admin/native-motion/profiles', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ characterName, automaticFallback, clips }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(parseError(payload, 'The profile could not be saved.'));
      const saved = payload.profile as NativeMotionProfile;
      setProfiles((current) => [
        ...current.filter((profile) => profile.profileKey !== saved.profileKey),
        saved,
      ].sort((a, b) => Number(b.automaticFallback) - Number(a.automaticFallback)
        || a.characterName.localeCompare(b.characterName)));
      setSelectedKey(saved.profileKey);
      setMessage('Animation profile saved.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The profile could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  async function deleteProfile() {
    if (!selectedProfile) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch(
        `/api/admin/native-motion/profiles?profileKey=${encodeURIComponent(selectedProfile.profileKey)}`,
        { method: 'DELETE' },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(parseError(payload, 'The profile could not be removed.'));
      setProfiles((current) => current.filter((profile) => profile.profileKey !== selectedProfile.profileKey));
      startNewCharacterProfile();
      setMessage('Profile removed. Any stream using it will return to the saved character mapping.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The profile could not be removed.');
    } finally {
      setBusy(false);
    }
  }

  async function saveOverrides(broadcast: Broadcast) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const selected = overrides[broadcast.id] ?? ['', ''];
      const response = await fetch('/api/admin/native-motion/overrides', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          broadcastId: broadcast.id,
          profileKeys: [selected[0] || null, selected[1] || null],
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(parseError(payload, 'Manual stream choices could not be saved.'));
      setMessage(`Animation overrides saved for ${broadcast.players[0]} vs ${broadcast.players[1]}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Manual stream choices could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  function setBroadcastOverride(broadcastId: string, playerIndex: 0 | 1, profileKey: string) {
    setOverrides((current) => {
      const prior = current[broadcastId] ?? ['', ''];
      const next: [string, string] = [...prior];
      next[playerIndex] = profileKey === NONE_PROFILE ? '' : profileKey;
      return { ...current, [broadcastId]: next };
    });
  }

  return (
    <div className={styles.admin}>
      <NativeMotionMatchOverrides catalog={catalog ?? undefined} />
      <section className={styles.card} aria-labelledby="native-motion-title">
        <div className={styles.heading}>
          <div>
            <h2 id="native-motion-title">Character animation profiles</h2>
            <p>
              Optional defaults for a game character. Match-specific choices above take priority,
              regardless of which player or character is selected.
            </p>
          </div>
          <div className={styles.actions}>
            <button type="button" className="btn btn-sm" onClick={startNewCharacterProfile}>New character</button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => selectProfile(NATIVE_MOTION_AUTOMATIC_PROFILE_KEY)}
            >
              Automatic fallback
            </button>
          </div>
        </div>

        {loadingError && <p className={styles.error} role="alert">{loadingError}</p>}
        {!catalog && !loadingError && <p className={styles.notice} role="status">Loading the verified animation catalog…</p>}
        {catalog && (
          <>
            <label className={styles.field}>
              <span>Character selected in a submitted replay</span>
              <select
                value={selectedKnownCharacter}
                onChange={(event) => selectKnownCharacter(event.target.value)}
              >
                <option value="">Choose a character to configure</option>
                {knownCharacters.map((name) => {
                  const configured = profiles.some((profile) => (
                    !profile.automaticFallback && profile.profileKey === nativeMotionProfileKey(name)
                  ));
                  return (
                    <option value={name} key={nativeMotionProfileKey(name)}>
                      {name} · {configured ? 'animation saved' : 'needs animation setup'}
                    </option>
                  );
                })}
              </select>
            </label>
            <p className={styles.notice}>
              A player can use any number of characters. Each character keeps its own animation profile;
              active manual streams can still override either player independently. Missing profiles are
              generated from matching non-acceleration clips and the character’s consistent recorded playing hand.
            </p>

            <label className={styles.field}>
              <span>Saved profile</span>
              <select value={selectedKey} onChange={(event) => selectProfile(event.target.value)}>
                <option value="__new__">New character profile</option>
                {profiles.map((profile) => (
                  <option value={profile.profileKey} key={profile.profileKey}>
                    {profile.automaticFallback ? 'Automatic stream fallback' : profile.characterName}
                  </option>
                ))}
                {!profiles.some((profile) => profile.automaticFallback) && (
                  <option value={NATIVE_MOTION_AUTOMATIC_PROFILE_KEY}>Create automatic fallback</option>
                )}
              </select>
            </label>

            {automaticFallback ? (
              <div className={styles.notice}>
                Unmapped automatic-stream players can use the first valid strike and serve clips below.
                Hidden and acceleration variants are excluded. Confirm each clip’s recorded handedness.
              </div>
            ) : (
              <label className={styles.field}>
                <span>Exact character name</span>
                <input
                  value={characterName}
                  onChange={(event) => setCharacterName(event.target.value)}
                  maxLength={100}
                  placeholder="Match the character name shown in replay data"
                />
              </label>
            )}

            <label className={styles.check}>
              <input
                type="checkbox"
                checked={showVariants}
                onChange={(event) => setShowVariants(event.target.checked)}
              />
              <span>Show hidden and acceleration variants for explicit review</span>
            </label>

            <div className={styles.strokeGrid}>
              {NATIVE_MOTION_STROKES.map((stroke) => {
                const currentId = picks[stroke].clipId;
                const selectedClip = catalog.clips.find((clip) => clip.id === currentId);
                const options = filteredClips[stroke];
                const labelId = `native-motion-${stroke}-label`;
                return (
                  <fieldset className={styles.stroke} key={stroke}>
                    <legend>{stroke[0].toUpperCase() + stroke.slice(1)}</legend>
                    <label className={styles.field}>
                      <span id={labelId}>Recorded clip</span>
                      <SearchableClipSelect
                        id={`native-motion-${stroke}-clip`}
                        labelledBy={labelId}
                        value={currentId}
                        placeholder="Search player or animation"
                        options={[
                          { value: '', label: 'Use standard replay motion' },
                          ...options.map((clip) => ({ value: clip.id, label: labelForClip(clip) })),
                          ...(currentId && selectedClip && !options.some((clip) => clip.id === currentId)
                            ? [{ value: currentId, label: labelForClip(selectedClip) }]
                            : []),
                        ]}
                        onChange={(clipId) => {
                          const clip = catalog.clips.find((item) => item.id === clipId);
                          changePick(stroke, {
                            clipId,
                            sourceHandedness: clip?.sourceHandedness ?? picks[stroke].sourceHandedness,
                          });
                        }}
                      />
                    </label>
                    {selectedClip && (
                      <p className={styles.clipMeta}>
                        {selectedClip.frameCount} frames · {selectedClip.duration.toFixed(2)} seconds
                        {selectedClip.events?.contactTime != null
                          ? ` · SDK contact marker ${selectedClip.events.contactTime.toFixed(2)}s`
                          : ''}
                      </p>
                    )}
                    {selectedClip && !nativeMotionClipSupportsStroke(selectedClip, stroke) && (
                      <p className={styles.error} role="alert">
                        This clip has no valid SDK contact marker for {stroke}. Select a different clip.
                      </p>
                    )}
                    <label className={styles.field}>
                      <span>Hand used in the original clip</span>
                      <select
                        value={picks[stroke].sourceHandedness}
                        onChange={(event) => changePick(stroke, {
                          sourceHandedness: event.target.value as NativeMotionHand | '',
                        })}
                        disabled={!currentId}
                      >
                        <option value="">Confirm original handedness</option>
                        <option value="right">Right-handed source</option>
                        <option value="left">Left-handed source</option>
                      </select>
                    </label>
                  </fieldset>
                );
              })}
            </div>

            {(error || message) && (
              <p className={error ? styles.error : styles.success} role={error ? 'alert' : 'status'}>
                {error || message}
              </p>
            )}
            <div className={styles.actions}>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void saveProfile()}>
                {busy ? 'Saving…' : 'Save profile'}
              </button>
              {selectedProfile && !deleting && (
                <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setDeleting(true)}>
                  Remove profile
                </button>
              )}
              {selectedProfile && deleting && (
                <>
                  <span className={styles.notice}>This also removes any manual-stream overrides using this profile.</span>
                  <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void deleteProfile()}>
                    Confirm removal
                  </button>
                  <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setDeleting(false)}>
                    Keep profile
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </section>

      <section className={styles.card} aria-labelledby="native-overrides-title">
        <h2 id="native-overrides-title">Manual-stream player overrides</h2>
        <p>Choose a saved profile separately for either player in each active manual stream.</p>
        {broadcasts.length === 0 ? (
          <p className={styles.notice}>No active manual streams need overrides.</p>
        ) : (
          <div className={styles.broadcastList}>
            {broadcasts.map((broadcast) => {
              const selected = overrides[broadcast.id] ?? ['', ''];
              return (
                <div className={styles.broadcast} key={broadcast.id}>
                  <h3>{broadcast.players[0]} vs {broadcast.players[1]}</h3>
                  <p>Started {new Date(broadcast.startedAt).toLocaleString()}</p>
                  {([0, 1] as const).map((playerIndex) => (
                    <label className={styles.field} key={playerIndex}>
                      <span>{broadcast.players[playerIndex]}</span>
                      <select
                        value={selected[playerIndex] || NONE_PROFILE}
                        onChange={(event) => setBroadcastOverride(
                          broadcast.id,
                          playerIndex,
                          event.target.value,
                        )}
                      >
                        <option value={NONE_PROFILE}>Use the saved character mapping</option>
                        {profiles.map((profile) => (
                          <option value={profile.profileKey} key={profile.profileKey}>
                            {profile.automaticFallback ? 'Automatic stream fallback' : profile.characterName}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    disabled={busy}
                    onClick={() => void saveOverrides(broadcast)}
                  >
                    Save player overrides
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

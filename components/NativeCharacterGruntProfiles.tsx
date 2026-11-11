'use client';

import { useEffect, useMemo, useState } from 'react';
import styles from './NativeCharacterGruntProfiles.module.css';

type GruntGroup = { id: string; label: string };
type Profile = {
  name: string;
  key: string;
  heightCm: number | null;
  weightKg: number | null;
  defaultGroup: string | null;
  assignedGroup: string | null;
  isOverridden: boolean;
};

const USE_DEFAULT = '__default__';
const NO_GRUNT = '__none__';

function parseError(value: unknown, fallback: string) {
  return value && typeof value === 'object'
    && 'error' in value && typeof value.error === 'string'
    ? value.error
    : fallback;
}

export default function NativeCharacterGruntProfiles() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [groups, setGroups] = useState<GruntGroup[]>([]);
  const [query, setQuery] = useState('');
  const [selectedKey, setSelectedKey] = useState('');
  const [draftGroup, setDraftGroup] = useState(USE_DEFAULT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const selected = profiles.find((profile) => profile.key === selectedKey) ?? null;
  const filtered = useMemo(() => {
    const search = query.trim().toLocaleLowerCase('en-GB');
    return profiles.filter((profile) => profile.name.toLocaleLowerCase('en-GB').includes(search));
  }, [profiles, query]);
  const groupLabel = (id: string | null) => groups.find((group) => group.id === id)?.label ?? 'No imported grunt';

  useEffect(() => {
    let active = true;
    void fetch('/api/admin/native-motion/grunt-profiles', { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(parseError(payload, 'Character grunt profiles could not be loaded.'));
        if (!Array.isArray(payload?.profiles) || !Array.isArray(payload?.groups)) {
          throw new Error('Character grunt profile data is invalid.');
        }
        if (active) {
          const nextProfiles = payload.profiles as Profile[];
          setProfiles(nextProfiles);
          setGroups(payload.groups as GruntGroup[]);
          setSelectedKey(nextProfiles[0]?.key ?? '');
        }
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Character grunt profiles could not be loaded.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!selected) return;
    setDraftGroup(selected.isOverridden
      ? selected.assignedGroup ?? NO_GRUNT
      : USE_DEFAULT);
    setMessage('');
    setError('');
  }, [selectedKey, profiles]);

  const save = async () => {
    if (!selected || saving) return;
    setSaving(true);
    setError('');
    setMessage('');
    const gruntGroup = draftGroup === USE_DEFAULT
      ? USE_DEFAULT
      : draftGroup === NO_GRUNT ? null : draftGroup;
    try {
      const response = await fetch('/api/admin/native-motion/grunt-profiles', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterName: selected.name, gruntGroup }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(parseError(payload, 'Character grunt assignment could not be saved.'));
      setProfiles((current) => current.map((profile) => profile.key === selected.key
        ? {
          ...profile,
          assignedGroup: payload.assignedGroup ?? null,
          isOverridden: payload.isOverridden === true,
        }
        : profile));
      setMessage(draftGroup === USE_DEFAULT
        ? `Restored the imported grunt assignment for ${selected.name}.`
        : draftGroup === NO_GRUNT
          ? `Disabled grunts for ${selected.name}.`
          : `Assigned ${groupLabel(draftGroup)} to ${selected.name}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Character grunt assignment could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={styles.card} aria-labelledby="character-grunt-title">
      <h2 id="character-grunt-title">Character grunt profiles</h2>
      <p>Set the default grunt bank used by a character. Match-specific broadcaster or admin choices take precedence.</p>
      {loading ? (
        <p role="status">Loading character profiles…</p>
      ) : (
        <div className={styles.editor}>
          <label className={styles.field}>
            <span>Search character profiles</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Search by character name"
            />
          </label>
          <label className={styles.field}>
            <span>Character profile</span>
            <select
              value={selectedKey}
              onChange={(event) => setSelectedKey(event.currentTarget.value)}
            >
              {filtered.map((profile) => (
                <option value={profile.key} key={profile.key}>{profile.name}</option>
              ))}
              {!filtered.length && <option value="">No profiles match this search</option>}
            </select>
          </label>
          {selected && (
            <>
              <p className={styles.meta}>
                Imported profile: {selected.heightCm ?? '—'} cm · {selected.weightKg ?? '—'} kg · {groupLabel(selected.defaultGroup)}
              </p>
              <label className={styles.field}>
                <span>Default grunt bank</span>
                <select value={draftGroup} onChange={(event) => setDraftGroup(event.currentTarget.value)}>
                  <option value={USE_DEFAULT}>Use imported profile assignment</option>
                  <option value={NO_GRUNT}>No grunt</option>
                  {groups.map((group) => (
                    <option value={group.id} key={group.id}>{group.label}</option>
                  ))}
                </select>
              </label>
              {(error || message) && (
                <p className={error ? styles.error : styles.success} role={error ? 'alert' : 'status'}>
                  {error || message}
                </p>
              )}
              <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void save()}>
                {saving ? 'Saving…' : 'Save character grunt'}
              </button>
            </>
          )}
        </div>
      )}
      {error && loading && <p className={styles.error} role="alert">{error}</p>}
    </section>
  );
}

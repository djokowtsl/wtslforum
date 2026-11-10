'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import {
  parseDmoSubmissionCharacterRoster,
  type DmoSubmissionCharacterOption,
} from '@/lib/dmoSubmissionPlayerStyle';

export type DmoPlayerStyleValues = {
  player1Character: string;
  player2Character: string;
  player1Handedness: string;
  player2Handedness: string;
  player1BackhandType: string;
  player2BackhandType: string;
};

export default function DmoSubmissionPlayerStyleEditor({
  value, onChange, inputStyle, disabled,
}: {
  value: DmoPlayerStyleValues;
  onChange: (patch: Partial<DmoPlayerStyleValues>) => void;
  inputStyle: CSSProperties;
  disabled: boolean;
}) {
  const [options, setOptions] = useState<DmoSubmissionCharacterOption[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading');
    void fetch('/api/character-stats?tour=all&include_profile=false', {
      cache: 'no-store', signal: controller.signal,
    }).then(async response => {
      if (!response.ok) throw new Error('Character list unavailable.');
      const body = await response.json();
      const roster = parseDmoSubmissionCharacterRoster(body?.character_filter_metadata);
      if (!roster.length) throw new Error('Character list unavailable.');
      if (!controller.signal.aborted) {
        setOptions(roster);
        setStatus('ready');
      }
    }).catch(() => {
      if (!controller.signal.aborted) setStatus('error');
    });
    return () => controller.abort();
  }, [retry]);

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
        {([1, 2] as const).map(player => {
          const characterKey = `player${player}Character` as const;
          const handKey = `player${player}Handedness` as const;
          const backhandKey = `player${player}BackhandType` as const;
          const character = value[characterKey];
          return (
            <fieldset key={player} disabled={disabled} style={{ minWidth: 0, margin: 0, padding: 12, border: '1px solid var(--border, #667085)', borderRadius: 8, display: 'grid', gap: 9 }}>
              <legend>Player {player} style</legend>
              <label style={{ display: 'grid', gap: 5 }}>
                TE4 character
                <select
                  aria-label={`Player ${player} character`}
                  style={inputStyle}
                  value={character}
                  disabled={status === 'loading'}
                  onChange={event => {
                    const selected = options.find(option => option.character === event.target.value);
                    onChange({
                      [characterKey]: event.target.value,
                      [handKey]: selected?.playingHand ?? '',
                      [backhandKey]: selected?.backhandType ?? '',
                    });
                  }}
                >
                  <option value="">No character / created character</option>
                  {character && !options.some(option => option.character === character) && (
                    <option value={character}>{character} (saved)</option>
                  )}
                  {options.map(option => <option key={option.character} value={option.character}>{option.character}</option>)}
                </select>
              </label>
              <label style={{ display: 'grid', gap: 5 }}>
                Playing hand
                <select aria-label={`Player ${player} playing hand`} style={inputStyle} value={value[handKey]} onChange={event => onChange({ [handKey]: event.target.value })}>
                  <option value="">Not recorded</option>
                  <option value="right">Right-handed</option>
                  <option value="left">Left-handed</option>
                </select>
              </label>
              <label style={{ display: 'grid', gap: 5 }}>
                Backhand grip
                <select aria-label={`Player ${player} backhand grip`} style={inputStyle} value={value[backhandKey]} onChange={event => onChange({ [backhandKey]: event.target.value })}>
                  <option value="">Not recorded</option>
                  <option value="one-handed">One-handed</option>
                  <option value="two-handed">Two-handed</option>
                </select>
              </label>
            </fieldset>
          );
        })}
      </div>
      <p className="notice" role="status" style={{ margin: 0 }}>
        {status === 'loading' ? 'Loading the character list…'
          : status === 'error' ? <>The character list is unavailable. Saved characters are retained and manual style fields still work.{' '}
            <button type="button" className="btn btn-sm btn-ghost" disabled={disabled} onClick={() => setRetry(count => count + 1)}>Retry</button></>
            : 'Selecting a character fills the hand and backhand grip. You can override either field or enter them manually for a created character.'}
      </p>
    </>
  );
}

'use client';

import { useEffect, useState } from 'react';
import {
  buildTe4CoachGroupPlayersApiUrl,
  buildTe4CoachPlayerEmbedUrl,
} from '@/lib/te4CoachEmbed';
import styles from './Te4CoachPlayerCard.module.css';

type GroupPlayer = {
  id?: unknown;
  name?: unknown;
  names?: unknown;
  played?: unknown;
  matches?: unknown;
};

function normalizedPlayerId(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }
  return null;
}

function hasPlayerName(player: GroupPlayer, name: string): boolean {
  const wanted = name.trim().toLocaleLowerCase();
  if (!wanted) return false;
  const aliases = [
    ...(typeof player.name === 'string' ? [player.name] : []),
    ...(Array.isArray(player.names) ? player.names.filter((item): item is string => typeof item === 'string') : []),
  ];
  return aliases.some((alias) => alias.trim().toLocaleLowerCase() === wanted);
}

function hasPlayedMatches(player: GroupPlayer): boolean {
  const value = player.played ?? player.matches;
  if (value === undefined || value === null) return true;
  const count = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(count) && count > 0;
}

export default function Te4CoachPlayerCard({
  groupId,
  playerName,
}: {
  groupId: string;
  playerName: string;
}) {
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);
  const playersUrl = buildTe4CoachGroupPlayersApiUrl(groupId);

  useEffect(() => {
    if (!playersUrl || !playerName.trim()) {
      setEmbedUrl(null);
      return;
    }
    const controller = new AbortController();
    void fetch(playersUrl, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok || !Array.isArray(body?.players)) return null;
        const matches = (body.players as GroupPlayer[]).filter(
          (player) => hasPlayerName(player, playerName) && hasPlayedMatches(player),
        );
        if (matches.length !== 1) return null;
        const id = normalizedPlayerId(matches[0].id);
        return id ? buildTe4CoachPlayerEmbedUrl(groupId, id) : null;
      })
      .then((url) => {
        if (!controller.signal.aborted) setEmbedUrl(url);
      })
      .catch(() => {
        if (!controller.signal.aborted) setEmbedUrl(null);
      });
    return () => controller.abort();
  }, [groupId, playerName, playersUrl]);

  if (!embedUrl) return null;
  return (
    <section className={styles.card} aria-label={`TE4 Coach shared match stats for ${playerName}`}>
      <div className={styles.heading}>
        <div>
          <span>PUBLIC GROUP · WTSL FORUM</span>
          <h2>TE4 Coach player card</h2>
        </div>
        <a href={embedUrl} target="_blank" rel="noopener noreferrer">
          Open in TE4 Coach ↗
        </a>
      </div>
      <iframe
        className={styles.embed}
        src={embedUrl}
        title={`TE4 Coach player card for ${playerName}`}
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </section>
  );
}

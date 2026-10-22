'use client';

import { useEffect, useState } from 'react';
import type { LiveStream } from '@/lib/liveBroadcast';

function playerUrl(stream: LiveStream, parent: string): string | null {
  if (!/^[A-Za-z0-9_-]{3,64}$/.test(stream.id)) return null;
  if (stream.provider === 'youtube') {
    return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(stream.id)}`;
  }
  if (!/^[a-z0-9_]{3,25}$/.test(stream.id) && stream.provider === 'twitch') return null;
  if (stream.provider === 'twitch') {
    return `https://player.twitch.tv/?channel=${encodeURIComponent(stream.id)}&parent=${encodeURIComponent(parent)}`;
  }
  if (stream.provider === 'twitch-clip') {
    return `https://clips.twitch.tv/embed?clip=${encodeURIComponent(stream.id)}&parent=${encodeURIComponent(parent)}`;
  }
  return null;
}

export default function LiveStreamEmbed({ stream, title }: { stream: LiveStream; title: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    setSrc(playerUrl(stream, window.location.hostname) ?? '');
  }, [stream]);

  return (
    <div className="live-broadcast-stream">
      {src ? (
        <iframe
          src={src}
          title={title}
          loading="lazy"
          allow="autoplay; encrypted-media; picture-in-picture; web-share"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : (
        <div className="live-broadcast-stream-loading" role="status">Loading stream player…</div>
      )}
      <a href={stream.sourceUrl} target="_blank" rel="noopener noreferrer">
        Open original stream ↗
      </a>
    </div>
  );
}

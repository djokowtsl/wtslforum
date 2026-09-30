export function timeAgo(input?: string | Date | null): string {
  if (!input) return '';
  const d = new Date(input).getTime();
  if (!Number.isFinite(d)) return '';
  const s = Math.max(0, Math.floor((Date.now() - d) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export const fmtDate = (input?: string | Date | null) =>
  input ? new Date(input).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export const fmtDateTime = (input?: string | Date | null) =>
  input
    ? new Date(input).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';

/** "us-open-2026-09-01" -> "Us Open" (fallback only; real names come from the tournaments table). */
export function prettyKey(key?: string | null): string {
  if (!key) return 'WTSL';
  return key
    .replace(/-?\d{4}-\d{2}-\d{2}$/, '')
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export const initial = (name?: string | null) => (name?.trim()?.[0] ?? 'W').toUpperCase();

import { STATUS_LABELS, type UserStatus } from '@/lib/presence';

const COLORS: Record<UserStatus, string> = {
  online: '#3ddc73',
  away: '#f5c94d',
  busy: '#f5544d',
  offline: '#6f82a0',
};

/** Small coloured dot shown next to a member's name/avatar wherever they appear on the forum. */
export function StatusDot({ status, className = '' }: { status?: string | null; className?: string }) {
  const s: UserStatus = status && status in COLORS ? (status as UserStatus) : 'offline';
  return <span className={`presence-dot ${className}`} style={{ background: COLORS[s] }} title={STATUS_LABELS[s]} />;
}

export const STATUSES = ['online', 'away', 'busy', 'offline'] as const;
export type UserStatus = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<UserStatus, string> = {
  online: 'Online',
  away: 'Away',
  busy: 'Busy',
  offline: 'Offline',
};

export const ONLINE_PRESENCE_WINDOW_MINUTES = 5;
export const PRESENCE_WRITE_INTERVAL_SECONDS = 45;

export function isUserStatus(value: unknown): value is UserStatus {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value);
}

export function resolveEffectiveUserStatus(status: unknown, recentlyActive: boolean): UserStatus {
  if (!isUserStatus(status)) return 'offline';
  return status === 'online' && !recentlyActive ? 'offline' : status;
}
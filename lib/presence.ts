import { sql } from './db';

/** Member-set presence — there's no automatic online/offline detection, members just pick one. */
export const STATUSES = ['online', 'away', 'busy', 'offline'] as const;
export type UserStatus = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<UserStatus, string> = {
  online: 'Online',
  away: 'Away',
  busy: 'Busy',
  offline: 'Offline',
};

export function isUserStatus(v: unknown): v is UserStatus {
  return typeof v === 'string' && (STATUSES as readonly string[]).includes(v);
}

export async function setUserStatus(userId: string | number, status: UserStatus) {
  await sql`UPDATE users SET status=${status}, updated_at=NOW() WHERE id=${Number(userId)}`;
}

export async function getUserStatus(userId: string | number): Promise<UserStatus> {
  const rows = await sql`SELECT status FROM users WHERE id=${Number(userId)} LIMIT 1`;
  const s = rows[0]?.status;
  return isUserStatus(s) ? s : 'online';
}

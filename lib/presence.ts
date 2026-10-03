import { sql } from './db';
import {
  ONLINE_PRESENCE_WINDOW_MINUTES,
  PRESENCE_WRITE_INTERVAL_SECONDS,
  resolveEffectiveUserStatus,
  type UserStatus,
} from './presencePolicy';

export { isUserStatus, STATUSES, STATUS_LABELS } from './presencePolicy';
export type { UserStatus } from './presencePolicy';

export async function setUserStatus(userId: string | number, status: UserStatus) {
  await sql`
    UPDATE users
    SET status=${status},
      last_active_at=CASE WHEN ${status}='online' THEN NOW() ELSE last_active_at END,
      updated_at=NOW()
    WHERE id=${Number(userId)}`;
}

/** Refresh activity for online members; rate-limit writes across tabs. */
export async function recordPresenceActivity(userId: string | number) {
  await sql`
    UPDATE users
    SET last_active_at=NOW()
    WHERE id=${Number(userId)} AND status='online'
      AND (last_active_at IS NULL OR last_active_at < NOW() - ${PRESENCE_WRITE_INTERVAL_SECONDS} * INTERVAL '1 second')`;
}

export async function getUserStatus(userId: string | number): Promise<UserStatus> {
  const rows = await sql`
    SELECT status,
      last_active_at >= NOW() - ${ONLINE_PRESENCE_WINDOW_MINUTES} * INTERVAL '1 minute' AS recently_active
    FROM users
    WHERE id=${Number(userId)}
    LIMIT 1`;
  return resolveEffectiveUserStatus(rows[0]?.status, Boolean(rows[0]?.recently_active));
}

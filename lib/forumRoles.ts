import { sql } from '@/lib/db';

export const FORUM_ROLE_LABELS = {
  tour_player: 'Tour Player',
  coach: 'Coach',
  yapper: 'Yapper',
  doubles_player: 'Doubles Player',
  writer: 'Writer',
} as const;

export type ManualForumRoleKey = 'tour_player' | 'coach' | 'doubles_player';
export type ForumRoleKey = keyof typeof FORUM_ROLE_LABELS;
export type ForumRoleBadge = { key: ForumRoleKey; label: string };
export type ForumRoleRequestStatus = 'pending' | 'approved' | 'rejected';
export type ForumRoleRequest = {
  id: number;
  user_id: string;
  discord_id: string;
  username: string;
  role_key: ManualForumRoleKey;
  status: ForumRoleRequestStatus;
  requested_at: string;
  review_note: string;
};

export const MANUAL_FORUM_ROLE_KEYS: ManualForumRoleKey[] = [
  'tour_player',
  'coach',
  'doubles_player',
];

export const YAPPER_POST_THRESHOLD = 25;

const ROLE_ORDER: ForumRoleKey[] = [
  'tour_player',
  'coach',
  'yapper',
  'doubles_player',
  'writer',
];

export function isManualForumRoleKey(value: unknown): value is ManualForumRoleKey {
  return typeof value === 'string'
    && MANUAL_FORUM_ROLE_KEYS.includes(value as ManualForumRoleKey);
}

export async function getForumRoleBadgeMap(
  userIds: Array<string | number | null | undefined>,
): Promise<Map<string, ForumRoleBadge[]>> {
  const ids = [...new Set(userIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (!ids.length) return new Map();

  const rows = await sql`
    WITH post_counts AS (
      SELECT author_id, COUNT(*)::int AS approved_post_count
      FROM (
        SELECT author_id FROM topics
        WHERE author_id = ANY(${ids}::bigint[]) AND moderation_status = 'approved'
        UNION ALL
        SELECT author_id FROM replies
        WHERE author_id = ANY(${ids}::bigint[]) AND moderation_status = 'approved'
      ) public_posts
      WHERE author_id IS NOT NULL
      GROUP BY author_id
    )
    SELECT u.id::text AS user_id,
      STRING_AGG(DISTINCT r.role_key, ',')
        FILTER (WHERE r.status = 'approved') AS approved_role_keys,
      COALESCE(pc.approved_post_count, 0)::int AS approved_post_count,
      EXISTS (SELECT 1 FROM articles a WHERE a.author_id = u.id) AS has_article
    FROM users u
    LEFT JOIN forum_role_requests r ON r.user_id = u.id
    LEFT JOIN post_counts pc ON pc.author_id = u.id
    WHERE u.id = ANY(${ids}::bigint[])
    GROUP BY u.id, pc.approved_post_count
  ` as any[];

  const result = new Map<string, ForumRoleBadge[]>();
  for (const row of rows) {
    const assigned = new Set(
      String(row.approved_role_keys || '')
        .split(',')
        .filter((key): key is ForumRoleKey => key in FORUM_ROLE_LABELS),
    );
    if (Boolean(row.has_article)) assigned.add('writer');
    if (Number(row.approved_post_count) >= YAPPER_POST_THRESHOLD) assigned.add('yapper');
    result.set(
      String(row.user_id),
      ROLE_ORDER.filter((key) => assigned.has(key)).map((key) => ({
        key,
        label: FORUM_ROLE_LABELS[key],
      })),
    );
  }
  return result;
}

export async function getForumRoleRequestsForUser(
  userId: string | number,
): Promise<Array<{ role_key: ManualForumRoleKey; status: ForumRoleRequestStatus; review_note: string }>> {
  const rows = await sql`
    SELECT role_key, status, review_note
    FROM forum_role_requests
    WHERE user_id = ${Number(userId)}
    ORDER BY requested_at DESC
  ` as any[];
  return rows.map((row) => ({
    role_key: row.role_key as ManualForumRoleKey,
    status: row.status as ForumRoleRequestStatus,
    review_note: String(row.review_note || ''),
  }));
}

export async function requestForumRole(
  userId: string | number,
  roleKey: ManualForumRoleKey,
): Promise<void> {
  const rows = await sql`
    INSERT INTO forum_role_requests (user_id, role_key, status)
    VALUES (${Number(userId)}, ${roleKey}, 'pending')
    ON CONFLICT (user_id, role_key) DO UPDATE
      SET status = 'pending', requested_at = NOW(), reviewed_by = NULL,
          reviewed_at = NULL, review_note = ''
      WHERE forum_role_requests.status = 'rejected'
    RETURNING id
  ` as any[];
  if (!rows[0]) throw new Error('This role is already pending or approved.');
}

export async function listPendingForumRoleRequests(): Promise<ForumRoleRequest[]> {
  const rows = await sql`
    SELECT r.id, r.user_id::text AS user_id, u.discord_id,
      u.display_name AS username, r.role_key, r.status, r.requested_at, r.review_note
    FROM forum_role_requests r
    JOIN users u ON u.id = r.user_id
    WHERE r.status = 'pending'
    ORDER BY r.requested_at ASC, r.id ASC
  ` as any[];
  return rows.map((row) => ({
    ...row,
    id: Number(row.id),
    user_id: String(row.user_id),
    role_key: row.role_key as ManualForumRoleKey,
    status: row.status as ForumRoleRequestStatus,
    requested_at: new Date(row.requested_at).toISOString(),
    review_note: String(row.review_note || ''),
  }));
}

export async function reviewForumRoleRequest(
  requestId: number,
  adminId: string | number,
  decision: 'approved' | 'rejected',
): Promise<{ discordId: string; roleKey: ManualForumRoleKey; decision: 'approved' | 'rejected' } | null> {
  const rows = await sql`
    UPDATE forum_role_requests
    SET status = ${decision}, reviewed_by = ${Number(adminId)},
        reviewed_at = NOW(), review_note = ''
    WHERE id = ${requestId} AND status = 'pending'
    RETURNING user_id, role_key
  ` as any[];
  if (!rows[0]) return null;
  const owner = await sql`
    SELECT discord_id FROM users WHERE id = ${Number(rows[0].user_id)} LIMIT 1
  ` as any[];
  if (!owner[0]?.discord_id) return null;
  return {
    discordId: String(owner[0].discord_id),
    roleKey: rows[0].role_key as ManualForumRoleKey,
    decision,
  };
}

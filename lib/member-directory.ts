import { sql } from '@/lib/db';

export type ForumDirectoryMember = {
  id: number;
  display_name: string;
  avatar_url: string | null;
  profile_player_id: string | null;
  profile_tour: string | null;
};

export type ForumMemberDirectoryPage = {
  members: ForumDirectoryMember[];
  total: number;
  page: number;
  pageCount: number;
};

export const FORUM_MEMBER_PAGE_SIZE = 36;
const MAX_PAGE_SIZE = 60;
const MAX_QUERY_LENGTH = 80;

/** Keep directory display data minimal; approved identity fields are only for profile navigation. */
export async function listForumMembers(
  query: string,
  requestedPage = 1,
  requestedPageSize = FORUM_MEMBER_PAGE_SIZE,
): Promise<ForumMemberDirectoryPage> {
  const normalizedQuery = String(query || '').trim().slice(0, MAX_QUERY_LENGTH);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(Number(requestedPageSize) || FORUM_MEMBER_PAGE_SIZE)));
  const safeRequestedPage = Math.max(1, Math.floor(Number(requestedPage) || 1));
  const countRows = await sql`
    SELECT COUNT(*)::int AS total
    FROM users
    WHERE NULLIF(BTRIM(display_name), '') IS NOT NULL
      AND (${normalizedQuery} = '' OR STRPOS(LOWER(display_name), LOWER(${normalizedQuery})) > 0)`;
  const total = Number(countRows[0]?.total || 0);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(safeRequestedPage, pageCount);
  const offset = (page - 1) * pageSize;
  const members = await sql`
    SELECT u.id, u.display_name, u.avatar_url,
      linked_player.wtsl_player_id AS profile_player_id,
      linked_player.tour AS profile_tour
    FROM users u
    LEFT JOIN LATERAL (
      SELECT c.wtsl_player_id, c.tour
      FROM player_claims c
      JOIN wtsl_players p
        ON p.wtsl_player_id = c.wtsl_player_id AND p.tour = c.tour
      WHERE c.user_id = u.id AND c.status = 'approved'
      ORDER BY
        CASE WHEN c.tour = 'TE4' THEN 0
          WHEN c.id = u.default_player_claim_id THEN 1
          ELSE 2 END,
        c.created_at ASC, c.id ASC
      LIMIT 1
    ) linked_player ON TRUE
    WHERE NULLIF(BTRIM(u.display_name), '') IS NOT NULL
      AND (${normalizedQuery} = '' OR STRPOS(LOWER(u.display_name), LOWER(${normalizedQuery})) > 0)
    ORDER BY LOWER(u.display_name), u.id
    LIMIT ${pageSize} OFFSET ${offset}`;

  return { members: members as ForumDirectoryMember[], total, page, pageCount };
}

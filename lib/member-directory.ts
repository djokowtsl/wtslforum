import { sql } from '@/lib/db';

export type ForumDirectoryMember = {
  id: number;
  display_name: string;
  avatar_url: string | null;
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

/** Public directory data is intentionally limited to the name and avatar already shown on posts. */
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
    SELECT id, display_name, avatar_url
    FROM users
    WHERE NULLIF(BTRIM(display_name), '') IS NOT NULL
      AND (${normalizedQuery} = '' OR STRPOS(LOWER(display_name), LOWER(${normalizedQuery})) > 0)
    ORDER BY LOWER(display_name), id
    LIMIT ${pageSize} OFFSET ${offset}`;

  return { members: members as ForumDirectoryMember[], total, page, pageCount };
}

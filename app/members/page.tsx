import Link from 'next/link';
import type { Metadata } from 'next';
import { getSession, discordAvatar } from '@/lib/auth';
import { FORUM_MEMBER_PAGE_SIZE, listForumMembers } from '@/lib/member-directory';
import PageHero from '@/components/PageHero';
import ForumRoleBadges from '@/components/ForumRoleBadges';
import { getForumRoleBadgeMap } from '@/lib/forumRoles';
import { safe } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Members' };

type MembersSearchParams = { q?: string | string[]; page?: string | string[] };

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] || '' : value || '';
}

function pageHref(page: number, query: string): string {
  const params = new URLSearchParams({ page: String(page) });
  if (query) params.set('q', query);
  return `/members?${params.toString()}`;
}

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<MembersSearchParams>;
}) {
  const params = await searchParams;
  const query = firstParam(params.q).trim().slice(0, 80);
  const pageValue = Number.parseInt(firstParam(params.page), 10);
  const requestedPage = Number.isFinite(pageValue) && pageValue > 0 ? pageValue : 1;
  const [user, directory] = await Promise.all([
    getSession(),
    listForumMembers(query, requestedPage, FORUM_MEMBER_PAGE_SIZE),
  ]);
  const roleBadgeMap = await safe(
    () => getForumRoleBadgeMap(directory.members.map((member) => member.id)),
    new Map(),
  );

  const firstMember = directory.total === 0
    ? 0
    : (directory.page - 1) * FORUM_MEMBER_PAGE_SIZE + 1;
  const lastMember = Math.min(directory.page * FORUM_MEMBER_PAGE_SIZE, directory.total);

  return (
    <>
      <PageHero eyebrow="The community" title="Forum Members">
        Browse the people in the WTSL Forum. Sign in to start a private chat.
      </PageHero>
      <main className="container narrow">
        <div className="member-directory-toolbar">
          <form className="member-directory-search" action="/members" method="get">
            <label htmlFor="member-query">Find a member</label>
            <input
              id="member-query"
              name="q"
              type="search"
              maxLength={80}
              placeholder="Search by display name"
              defaultValue={query}
            />
            <button className="btn btn-sm" type="submit">Search</button>
          </form>
          <p className="member-directory-count">
            {directory.total === 0
              ? 'No members found'
              : `Showing ${firstMember}–${lastMember} of ${directory.total} members`}
          </p>
        </div>

        {directory.members.length > 0 ? (
          <div className="member-directory-grid" role="list" aria-label="Forum members">
            {directory.members.map((member) => {
              const isSelf = user && Number(user.id) === Number(member.id);
              const profileHref = member.profile_player_id
                ? `/players/${encodeURIComponent(member.profile_player_id)}?tour=${encodeURIComponent(member.profile_tour || 'TE4')}`
                : null;
              const memberAvatar = (
                <img
                  className="avatar-img"
                  src={discordAvatar(member.avatar_url, member.display_name)}
                  alt=""
                  loading="lazy"
                />
              );
              const memberName = (
                <span className="member-directory-name">{member.display_name}</span>
              );
              return (
                <div className="member-directory-card" key={member.id} role="listitem">
                  {profileHref ? (
                    <Link className="member-directory-profile-link" href={profileHref}>
                      {memberAvatar}
                      {memberName}
                    </Link>
                  ) : (
                    <>
                      {memberAvatar}
                      {memberName}
                    </>
                  )}
                  <ForumRoleBadges roles={roleBadgeMap.get(String(member.id)) || []} />
                  {isSelf ? (
                    <span className="pill cyan">You</span>
                  ) : user ? (
                    <Link className="btn btn-ghost btn-sm" href={`/messages/${member.id}`}>
                      Message
                    </Link>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="forum-list">
            <div className="empty">
              <strong>No members found</strong>
              {query ? 'Try a different display name.' : 'The member list is empty.'}
            </div>
          </div>
        )}

        {directory.pageCount > 1 && (
          <nav className="member-directory-pagination" aria-label="Member list pages">
            {directory.page > 1 ? (
              <Link className="btn btn-ghost btn-sm" href={pageHref(directory.page - 1, query)}>
                Previous
              </Link>
            ) : (
              <span />
            )}
            <span className="member-directory-page-label">
              Page {directory.page} of {directory.pageCount}
            </span>
            {directory.page < directory.pageCount ? (
              <Link className="btn btn-ghost btn-sm" href={pageHref(directory.page + 1, query)}>
                Next
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </main>
    </>
  );
}

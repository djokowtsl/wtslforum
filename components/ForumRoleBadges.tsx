import type { ForumRoleBadge } from '@/lib/forumRoles';

export default function ForumRoleBadges({ roles }: { roles: ForumRoleBadge[] }) {
  if (!roles.length) return null;
  return (
    <span className="community-role-badges" aria-label="Community roles">
      {roles.map((role) => (
        <span className="pill role community-role-tag" key={role.key}>{role.label}</span>
      ))}
    </span>
  );
}

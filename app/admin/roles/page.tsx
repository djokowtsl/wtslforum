import { redirect } from 'next/navigation';
import PageHero from '@/components/PageHero';
import AdminRoleManager from '@/components/AdminRoleManager';
import { getSession } from '@/lib/auth';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function AdminRoles() {
  const user = await getSession();
  if (!user) redirect('/api/auth/discord');
  if (!user.isAdmin) redirect('/');

  const bootstrapAdmins = (process.env.ADMIN_DISCORD_IDS || '').split(',').map((id) => id.trim()).filter(Boolean);
  const bootstrapModerators = (process.env.MODERATOR_DISCORD_IDS || '').split(',').map((id) => id.trim()).filter(Boolean);
  const rows = await sql`
    SELECT id,display_name,username,is_admin,is_moderator,discord_id
    FROM users
    ORDER BY lower(display_name),id
  `;
  const members = rows.map((member) => ({
    id: Number(member.id),
    display_name: member.display_name,
    username: member.username,
    is_admin: Boolean(member.is_admin) || bootstrapAdmins.includes(member.discord_id),
    is_moderator: Boolean(member.is_moderator) || bootstrapModerators.includes(member.discord_id),
    bootstrap_admin: bootstrapAdmins.includes(member.discord_id),
    bootstrap_moderator: bootstrapModerators.includes(member.discord_id),
  }));

  return (
    <>
      <PageHero eyebrow="Staff" title="Account roles">Assign admin and moderator access to forum accounts.</PageHero>
      <main className="container">
        <div className="panel role-panel">
          <p className="notice">Configured admin and moderator IDs are protected here. Update ADMIN_DISCORD_IDS or MODERATOR_DISCORD_IDS in deployment settings to change those bootstrap lists.</p>
          <AdminRoleManager initialMembers={members} />
        </div>
      </main>
    </>
  );
}
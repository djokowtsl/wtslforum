import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import DmoLiveHost from '@/components/DmoLiveHost';

export const dynamic = 'force-dynamic';

export default async function AdminDmoLive() {
  const user = await getSession();
  if (!user) redirect('/api/auth/discord');
  if (!user.isAdmin) redirect('/');
  return <DmoLiveHost adminName={user.username} />;
}

import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import DmoLiveHost from '@/components/DmoLiveHost';
import DmoLiveViewer from '@/components/DmoLiveViewer';

export const dynamic = 'force-dynamic';

export default async function LiveDmoPage() {
  const user = await getSession();
  if (!user) redirect('/api/auth/discord');
  return (
    <main className="live-broadcast-page">
      <DmoLiveHost displayName={user.username} />
      <DmoLiveViewer />
    </main>
  );
}

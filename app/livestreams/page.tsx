import { getSession } from '@/lib/auth';
import DmoLiveHost from '@/components/DmoLiveHost';
import DmoLiveViewer from '@/components/DmoLiveViewer';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: { absolute: 'Live Streams' } };

export default async function LivestreamsPage() {
  const user = await getSession();
  return (
    <main className="live-broadcast-page">
      {user && <DmoLiveHost displayName={user.username} />}
      <DmoLiveViewer canWatch={Boolean(user)} />
    </main>
  );
}

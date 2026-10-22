import { redirect } from 'next/navigation';
import DmoAnalysisWorkspace from '@/components/DmoAnalysisWorkspace';
import { getSession } from '@/lib/auth';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function AdminDmoAnalysis() {
  const user = await getSession();
  if (!user) redirect('/api/auth/discord');
  if (!user.isAdmin) redirect('/');
  return (
    <>
      <div className="container" style={{ paddingTop: 16 }}>
        <Link className="btn btn-sm btn-ghost" href="/livestreams">Open Live Broadcast</Link>
      </div>
      <DmoAnalysisWorkspace />
    </>
  );
}

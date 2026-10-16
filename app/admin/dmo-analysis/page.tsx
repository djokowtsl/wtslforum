import { redirect } from 'next/navigation';
import DmoAnalysisWorkspace from '@/components/DmoAnalysisWorkspace';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function AdminDmoAnalysis() {
  const user = await getSession();
  if (!user) redirect('/api/auth/discord');
  if (!user.isAdmin) redirect('/');
  return <DmoAnalysisWorkspace />;
}

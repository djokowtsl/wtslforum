import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import AdminArticleManager from '@/components/AdminArticleManager';

export const dynamic = 'force-dynamic';

export default async function AdminArticles() {
  const user = await getSession();
  if (!user) redirect('/api/auth/discord');
  if (!user.isAdmin) redirect('/');
  return <main><AdminArticleManager userId={String(user.id)} /></main>;
}

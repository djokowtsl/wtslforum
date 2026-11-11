import { redirect } from 'next/navigation';
import NativeMotionAdmin from '@/components/NativeMotionAdmin';
import PageHero from '@/components/PageHero';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function AdminDmoAnimations() {
  const user = await getSession();
  if (!user) redirect('/api/auth/discord');
  if (!user.isAdmin) redirect('/');
  return (
    <>
      <PageHero eyebrow="Staff" title="Replay & live-stream animations">
        Choose one fixed animation per player and stroke for each match, with optional character defaults.
      </PageHero>
      <main className="container">
        <NativeMotionAdmin />
      </main>
    </>
  );
}

import { redirect } from 'next/navigation';
import NativeMotionAdmin from '@/components/NativeMotionAdmin';
import NativeCharacterGruntProfiles from '@/components/NativeCharacterGruntProfiles';
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
        Choose fixed animations and character grunt defaults, with match-specific controls for staff and stream owners.
      </PageHero>
      <main className="container">
        <NativeMotionAdmin />
        <NativeCharacterGruntProfiles />
      </main>
    </>
  );
}

import type { Metadata } from 'next';
import { safe } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getClips, youtubeId } from '@/lib/media';
import { isTourCode, tourLabel, TOURS, type TourCode } from '@/lib/wtsl';
import PageHero from '@/components/PageHero';
import MediaSubmitForm from '@/components/MediaSubmitForm';
import MediaGrid from '@/components/MediaGrid';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Media' };

export default async function Media({ searchParams }: { searchParams: Promise<{ tour?: string }> }) {
  const sp = await searchParams;
  const tour: TourCode | undefined = isTourCode(sp.tour) ? sp.tour : undefined;
  const [user, clipsRaw] = await Promise.all([getSession(), safe(() => getClips(tour), [] as any[])]);
  const clips = clipsRaw.map((c: any) => ({ ...c, youtube_id: youtubeId(c.url) }));

  return (
    <>
      <PageHero eyebrow="Community highlights" title="Media">Clips, highlights and match footage shared by the WTSL community.</PageHero>
      <main className="container">
        <div className="tour-tabs" role="tablist" aria-label="Tour filter" style={{ marginBottom: 24 }}>
          <a href="/media" className={`tour-tab${!tour ? ' active' : ''}`}>All</a>
          {TOURS.map((t) => (
            <a key={t.code} href={`/media?tour=${encodeURIComponent(t.code)}`} className={`tour-tab${tour === t.code ? ' active' : ''}`}>{t.short}</a>
          ))}
        </div>

        {user ? (
          <div style={{ marginBottom: 36 }}><MediaSubmitForm /></div>
        ) : (
          <div className="notice" style={{ marginBottom: 36 }}>
            <a className="btn btn-sm btn-discord" href="/api/auth/discord">Log in with Discord</a> to submit your own clips.
          </div>
        )}

        <div className="section-heading"><h2>{tour ? tourLabel(tour) : 'All'} clips</h2></div>
        <MediaGrid clips={clips} canManage={!!user?.isAdmin} currentUserId={user?.id ?? null} />
      </main>
    </>
  );
}

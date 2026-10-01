import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { safe } from '@/lib/db';
import { getCategories } from '@/lib/queries';
import { getSession } from '@/lib/auth';
import NewDiscussionForm from '@/components/NewDiscussionForm';
import PageHero from '@/components/PageHero';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Start a discussion' };

export default async function NewDiscussion({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await getSession();
  if (!u) redirect('/api/auth/discord');
  const sp = await searchParams;
  const cats = await safe(() => getCategories(), [] as any[]);
  const matchTalkCat = cats.find((c: any) => c.slug === 'match-talk');
  return (
    <>
      <PageHero eyebrow="WTSL Forum" title="Start a discussion">Share a match, a question, an opinion or a WTSL story with the community.</PageHero>
      <main className="container narrow">
        {cats.length === 0 ? <div className="notice warn">No boards exist yet. Run <code>db.sql</code> on the forum database to create the default boards.</div> : (
          <NewDiscussionForm
            categories={cats}
            initialTitle={sp.title}
            initialBody={sp.body}
            matchKey={sp.matchKey}
            initialCategoryId={sp.matchKey ? matchTalkCat?.id : undefined}
          />
        )}
      </main>
    </>
  );
}

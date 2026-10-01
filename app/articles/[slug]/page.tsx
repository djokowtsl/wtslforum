import Link from 'next/link';
import { notFound } from 'next/navigation';
import { safe, sql } from '@/lib/db';
import { fmtDate } from '@/lib/format';
import RichText from '@/components/RichText';

export const dynamic = 'force-dynamic';

export default async function Article({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const rows = await safe(() => sql`SELECT a.*,u.display_name author FROM articles a LEFT JOIN users u ON u.id=a.author_id WHERE a.slug=${slug} AND a.published=true LIMIT 1`, [] as any[]);
  const a = rows[0];
  if (!a) notFound();
  return (
    <main className="container narrow">
      <Link href="/articles" className="back-link">← All articles</Link>
      <article className="thread-head">
        <div className="eyebrow">WTSL Editorial</div>
        <h1 className="display">{a.title}</h1>
        <div className="topic-meta"><span>By {a.author || 'WTSL Forum'}</span><span>{fmtDate(a.created_at)}</span></div>
      </article>
      <article className="article-long"><RichText text={a.body} /></article>
    </main>
  );
}

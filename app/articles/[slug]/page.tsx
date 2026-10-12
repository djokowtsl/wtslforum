import Link from 'next/link';
import { notFound } from 'next/navigation';
import { safe, sql } from '@/lib/db';
import { fmtDate } from '@/lib/format';
import RichText from '@/components/RichText';
import ArticleRichText from '@/components/ArticleRichText';
import { readArticleContent, safeArticleUrl } from '@/lib/articleContent';

export const dynamic = 'force-dynamic';

export default async function Article({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const rows = await safe(() => sql`SELECT a.*,u.display_name author FROM articles a LEFT JOIN users u ON u.id=a.author_id WHERE a.slug=${slug} AND a.published=true LIMIT 1`, [] as any[]);
  const a = rows[0];
  if (!a) notFound();
  const content = readArticleContent(a.body);
  const coverUrl = safeArticleUrl(a.cover_url);
  return (
    <main className="container narrow">
      <Link href="/articles" className="back-link">← All articles</Link>
      <article className="thread-head">
        <div className="eyebrow">WTSL Editorial</div>
        {content ? <ArticleRichText doc={content.titleDoc} title className="article-public-title" /> : <h1 className="display">{a.title}</h1>}
        <div className="topic-meta"><span>By {a.author || 'WTSL Forum'}</span><span>{fmtDate(a.created_at)}</span></div>
      </article>
      {coverUrl && <img className="article-public-cover" src={coverUrl} alt="" />}
      <article className="article-long">{content ? <ArticleRichText doc={content.bodyDoc} /> : <RichText text={a.body} />}</article>
    </main>
  );
}

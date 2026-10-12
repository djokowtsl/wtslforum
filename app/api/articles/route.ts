import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { sql } from '@/lib/db';
import { announceArticle } from '@/lib/discord';
import { validateArticleInput } from '@/lib/articleContent';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getSession();
  if (!user?.isAdmin) return NextResponse.json({ error: 'Admin access required.' }, { status: 403 });
  try {
    const articles = await sql`SELECT a.id,a.title,a.slug,a.excerpt,a.body,a.cover_url,a.published,a.created_at,u.display_name author FROM articles a LEFT JOIN users u ON u.id=a.author_id ORDER BY a.created_at DESC`;
    return NextResponse.json({ articles }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return NextResponse.json({ error: 'Unable to load articles. Please try again.' }, { status: 503 });
  }
}

export async function POST(req: Request) {
  const user = await getSession();
  if (!user?.isAdmin) return NextResponse.json({ error: 'Admin access required.' }, { status: 403 });
  let article;
  try {
    const text = await req.text();
    if (text.length > 350000) throw new Error('Article is too large.');
    article = validateArticleInput(JSON.parse(text));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid article.' }, { status: 400 });
  }
  try {
    const slug = article.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 90) || 'article';
    const rows = await sql`INSERT INTO articles(author_id,title,slug,excerpt,body,cover_url,published) VALUES (${Number(user.id)},${article.title},${slug + '-' + crypto.randomUUID()},${article.excerpt},${article.body},${article.coverUrl},${article.published}) RETURNING id,slug`;
    if (article.published) await announceArticle(article.title, String(rows[0].slug), user.username).catch(console.error);
    return NextResponse.json({ id: rows[0].id, slug: rows[0].slug, published: article.published }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Unable to save the article. Your editor content has been kept; please try again.' }, { status: 503 });
  }
}

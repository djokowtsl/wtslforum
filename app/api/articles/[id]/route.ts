import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { sql } from '@/lib/db';
import { announceArticle } from '@/lib/discord';
import { validateArticleInput } from '@/lib/articleContent';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
function articleId(id: string) {
  return /^\d+$/.test(id) && Number.isSafeInteger(Number(id)) && Number(id) > 0 ? Number(id) : null;
}

export async function GET(_req: Request, context: Context) {
  const user = await getSession();
  if (!user?.isAdmin) return NextResponse.json({ error: 'Admin access required.' }, { status: 403 });
  const id = articleId((await context.params).id);
  if (!id) return NextResponse.json({ error: 'Invalid article ID.' }, { status: 400 });
  try {
    const rows = await sql`SELECT id,title,slug,excerpt,body,cover_url,published,created_at FROM articles WHERE id=${id} LIMIT 1`;
    if (!rows[0]) return NextResponse.json({ error: 'Article not found.' }, { status: 404 });
    return NextResponse.json({ article: rows[0] }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch { return NextResponse.json({ error: 'Unable to load the article.' }, { status: 503 }); }
}

export async function PUT(req: Request, context: Context) {
  const user = await getSession();
  if (!user?.isAdmin) return NextResponse.json({ error: 'Admin access required.' }, { status: 403 });
  const id = articleId((await context.params).id);
  if (!id) return NextResponse.json({ error: 'Invalid article ID.' }, { status: 400 });
  let article;
  try {
    const text = await req.text();
    if (text.length > 350000) throw new Error('Article is too large.');
    article = validateArticleInput(JSON.parse(text));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid article.' }, { status: 400 });
  }
  try {
    // Lock the old row and update in one SQL statement; only a false -> true
    // transition can announce publication, even when two publish clicks race.
    const rows = await sql`WITH previous AS MATERIALIZED (
      SELECT id,published FROM articles WHERE id=${id} FOR UPDATE
    ), changed AS (
      UPDATE articles SET title=${article.title},excerpt=${article.excerpt},body=${article.body},
        cover_url=${article.coverUrl},published=${article.published}
      WHERE id IN (SELECT id FROM previous) RETURNING id,slug,published
    ) SELECT changed.*,previous.published AS was_published FROM changed JOIN previous USING(id)`;
    if (!rows[0]) return NextResponse.json({ error: 'Article not found.' }, { status: 404 });
    if (article.published && !rows[0].was_published) {
      await announceArticle(article.title, String(rows[0].slug), user.username).catch(console.error);
    }
    return NextResponse.json({ id, slug: rows[0].slug, published: article.published });
  } catch {
    return NextResponse.json({ error: 'Unable to save changes. Your editor content has been kept; please try again.' }, { status: 503 });
  }
}

export async function DELETE(_req: Request, context: Context) {
  const user = await getSession();
  if (!user?.isAdmin) return NextResponse.json({ error: 'Admin access required.' }, { status: 403 });
  const id = articleId((await context.params).id);
  if (!id) return NextResponse.json({ error: 'Invalid article ID.' }, { status: 400 });
  try {
    const rows = await sql`DELETE FROM articles WHERE id=${id} RETURNING id`;
    if (!rows[0]) return NextResponse.json({ error: 'Article not found.' }, { status: 404 });
    return NextResponse.json({ deleted: true });
  } catch { return NextResponse.json({ error: 'Unable to delete the article.' }, { status: 503 }); }
}

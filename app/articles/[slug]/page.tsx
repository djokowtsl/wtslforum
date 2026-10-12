import Link from 'next/link';
import { notFound } from 'next/navigation';
import { safe, sql } from '@/lib/db';
import { fmtDate } from '@/lib/format';
import { canModerateComments, discordAvatar, getSession } from '@/lib/auth';
import RichText from '@/components/RichText';
import ArticleRichText from '@/components/ArticleRichText';
import { readArticleContent, safeArticleUrl } from '@/lib/articleContent';
import ReactionBar from '@/components/ReactionBar';
import ArticleCommentForm from '@/components/ArticleCommentForm';
import EditableArticleComment from '@/components/EditableArticleComment';
import { getArticleComments, getArticleReactions, type ReactionSummary } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export default async function Article({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const rows = await safe(() => sql`SELECT a.*,u.display_name author FROM articles a LEFT JOIN users u ON u.id=a.author_id WHERE a.slug=${slug} AND a.published=true LIMIT 1`, [] as any[]);
  const a = rows[0];
  if (!a) notFound();
  const user = await getSession();
  const articleId = Number(a.id);
  let comments: any[] = [];
  let reactions: ReactionSummary = [];
  let interactionsUnavailable = false;
  try {
    [comments, reactions] = await Promise.all([
      getArticleComments(articleId),
      getArticleReactions(articleId, user?.id ?? null),
    ]);
  } catch (error) {
    console.error('[articles] article interactions could not be loaded', error instanceof Error ? error.message : error);
    interactionsUnavailable = true;
  }
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
      <section className="article-reactions" aria-labelledby="article-reactions-title">
        <h2 id="article-reactions-title">React to this article</h2>
        {interactionsUnavailable
          ? <p className="notice article-interactions-unavailable" role="status">Article interactions are temporarily unavailable.</p>
          : <ReactionBar articleId={articleId} initial={reactions} signedIn={!!user} />}
      </section>
      <section className="article-comments-section" aria-labelledby="article-comments-title">
        <div className="article-comments-heading">
          <h2 id="article-comments-title">Comments</h2>
          {!interactionsUnavailable && <span>{comments.length === 100 ? 'Latest 100 comments' : `${comments.length} ${comments.length === 1 ? 'comment' : 'comments'}`}</span>}
        </div>
        {!interactionsUnavailable && (user
          ? <ArticleCommentForm articleId={articleId} />
          : <p className="article-comment-signin"><Link href="/api/auth/discord">Sign in with Discord</Link> to join the conversation.</p>)}
        {!interactionsUnavailable && comments.length === 0 && (
          <p className="article-comments-empty">No comments yet. Start the conversation.</p>
        )}
        {!interactionsUnavailable && comments.length > 0 && (
          <div className="article-comment-list">
            {comments.map((comment: any) => {
              const author = comment.author || 'Former member';
              const officialProfile = comment.official_player_id && comment.official_tour
                ? `/players/${encodeURIComponent(String(comment.official_player_id))}?tour=${encodeURIComponent(String(comment.official_tour))}`
                : null;
              const ownsComment = Boolean(user && String(comment.author_id) === String(user.id));
              const canRemoveComment = ownsComment || canModerateComments(user);
              return (
                <article className="article-comment" key={comment.id}>
                  <header className="article-comment-header">
                    <img src={discordAvatar(comment.avatar, author)} alt="" />
                    <div className="article-comment-author">
                      {officialProfile ? <Link href={officialProfile}>{author}</Link> : <strong>{author}</strong>}
                      <time dateTime={new Date(comment.created_at).toISOString()}>{fmtDate(comment.created_at)}</time>
                    </div>
                  </header>
                  <div className="article-comment-body"><RichText text={comment.body} /></div>
                  {canRemoveComment && (
                    <EditableArticleComment
                      commentId={Number(comment.id)}
                      initialBody={comment.body}
                      canEdit={ownsComment}
                      canDelete={canRemoveComment}
                    />
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}

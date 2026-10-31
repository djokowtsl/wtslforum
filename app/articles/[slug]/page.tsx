import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { safe, sql } from '@/lib/db';
import { fmtDate } from '@/lib/format';
import { canModerateComments, discordAvatar, getSession } from '@/lib/auth';
import RichText from '@/components/RichText';
import ArticleRichText from '@/components/ArticleRichText';
import { readArticleContent, safeArticleUrl } from '@/lib/articleContent';
import ReactionBar from '@/components/ReactionBar';
import ArticleCommentForm from '@/components/ArticleCommentForm';
import EditableArticleComment from '@/components/EditableArticleComment';
import ReplyToComment from '@/components/ReplyToComment';
import { buildCommentTree, type CommentNode } from '@/lib/commentTree';
import { getArticleComments, getArticleCommentReactions, getArticleReactions, type ReactionSummary } from '@/lib/queries';
import ForumRoleBadges from '@/components/ForumRoleBadges';
import { getForumRoleBadgeMap, type ForumRoleBadge } from '@/lib/forumRoles';

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
  let commentReactions: Record<number, ReactionSummary> = {};
  let commentsUnavailable = false;
  let articleReactionsUnavailable = false;
  let commentReactionsUnavailable = false;
  const [commentsResult, articleReactionsResult] = await Promise.allSettled([
    getArticleComments(articleId),
    getArticleReactions(articleId, user?.id ?? null),
  ]);
  if (commentsResult.status === 'fulfilled') {
    comments = commentsResult.value;
  } else {
    console.error('[articles] comments could not be loaded', commentsResult.reason instanceof Error ? commentsResult.reason.message : commentsResult.reason);
    commentsUnavailable = true;
  }
  if (articleReactionsResult.status === 'fulfilled') {
    reactions = articleReactionsResult.value;
  } else {
    console.error('[articles] article reactions could not be loaded', articleReactionsResult.reason instanceof Error ? articleReactionsResult.reason.message : articleReactionsResult.reason);
    articleReactionsUnavailable = true;
  }
  if (!commentsUnavailable && comments.length > 0) {
    try {
      commentReactions = await getArticleCommentReactions(
        comments.map((comment: any) => Number(comment.id)),
        user?.id ?? null,
      );
    } catch (error) {
      console.error('[articles] comment reactions could not be loaded', error instanceof Error ? error.message : error);
      commentReactionsUnavailable = true;
    }
  }
  const roleBadgeMap = await safe(
    () => getForumRoleBadgeMap([a.author_id, ...comments.map((comment: any) => comment.author_id)]),
    new Map<string, ForumRoleBadge[]>(),
  );
  const authorRoles = (authorId: string | number | null | undefined) =>
    authorId == null ? [] : roleBadgeMap.get(String(authorId)) || [];
  const commentTree = buildCommentTree(comments, 'parent_comment_id');
  const recentCommentCount = comments.filter((comment) => comment.is_recent !== false).length;
  const renderComment = (node: CommentNode<any>): ReactNode => {
    const comment = node.comment;
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
            <ForumRoleBadges roles={authorRoles(comment.author_id)} />
            <time dateTime={new Date(comment.created_at).toISOString()}>{fmtDate(comment.created_at)}</time>
          </div>
        </header>
        <div className="article-comment-body"><RichText text={comment.body} /></div>
        <div className="article-comment-interactions">
          {!commentReactionsUnavailable && (
            <ReactionBar
              articleCommentId={Number(comment.id)}
              initial={commentReactions[Number(comment.id)] || []}
              signedIn={!!user}
            />
          )}
          {user && <ReplyToComment target="article" articleId={articleId} parentId={Number(comment.id)} />}
          {canRemoveComment && (
            <EditableArticleComment
              commentId={Number(comment.id)}
              initialBody={comment.body}
              canEdit={ownsComment}
              canDelete={canRemoveComment}
            />
          )}
        </div>
        {node.children.length > 0 && (
          <div className="article-comment-children" aria-label={`Replies to ${author}`}>
            {node.children.map((child) => renderComment(child))}
          </div>
        )}
      </article>
    );
  };
  const content = readArticleContent(a.body);
  const coverUrl = safeArticleUrl(a.cover_url);
  return (
    <main className="container narrow">
      <Link href="/articles" className="back-link">← All articles</Link>
      <article className="thread-head">
        <div className="eyebrow">WTSL Editorial</div>
        {content ? <ArticleRichText doc={content.titleDoc} title className="article-public-title" /> : <h1 className="display">{a.title}</h1>}
        <div className="topic-meta">
          <span>By {a.author || 'WTSL Forum'}</span>
          <ForumRoleBadges roles={authorRoles(a.author_id)} />
          <span>{fmtDate(a.created_at)}</span>
        </div>
      </article>
      {coverUrl && <img className="article-public-cover" src={coverUrl} alt="" />}
      <article className="article-long">{content ? <ArticleRichText doc={content.bodyDoc} /> : <RichText text={a.body} />}</article>
      <section className="article-reactions" aria-labelledby="article-reactions-title">
        <h2 id="article-reactions-title">React to this article</h2>
        {articleReactionsUnavailable
          ? <p className="notice article-interactions-unavailable" role="status">Article reactions are temporarily unavailable.</p>
          : <ReactionBar articleId={articleId} initial={reactions} signedIn={!!user} />}
      </section>
      <section className="article-comments-section" aria-labelledby="article-comments-title">
        <div className="article-comments-heading">
          <h2 id="article-comments-title">Comments</h2>
          {!commentsUnavailable && <span>{recentCommentCount >= 100 ? 'Latest 100 comments' : `${recentCommentCount} ${recentCommentCount === 1 ? 'comment' : 'comments'}`}</span>}
        </div>
        {commentsUnavailable && <p className="notice" role="status">Comments are temporarily unavailable.</p>}
        {!commentsUnavailable && commentReactionsUnavailable && (
          <p className="notice" role="status">Comment reactions are temporarily unavailable.</p>
        )}
        {!commentsUnavailable && (user
          ? <ArticleCommentForm articleId={articleId} />
          : <p className="article-comment-signin"><Link href="/api/auth/discord">Sign in with Discord</Link> to join the conversation.</p>)}
        {!commentsUnavailable && comments.length === 0 && (
          <p className="article-comments-empty">No comments yet. Start the conversation.</p>
        )}
        {!commentsUnavailable && comments.length > 0 && (
          <div className="article-comment-list">
            {commentTree.map((node) => renderComment(node))}
          </div>
        )}
      </section>
    </main>
  );
}

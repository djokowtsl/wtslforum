import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');

function loadPage() {
  const comment = {
    id: 1,
    article_id: 2,
    author_id: 3,
    author: 'Riachsoup',
    body: 'A saved comment',
    created_at: '2026-10-25T20:34:52.135Z',
    updated_at: '2026-10-25T20:34:52.135Z',
    parent_comment_id: null,
    is_recent: true,
  };
  const mocks = {
    'next/link': function Link() { return null; },
    'next/navigation': { notFound: () => { throw new Error('Article not found'); } },
    '@/lib/db': {
      safe: async (fn, fallback) => {
        try { return await fn(); } catch { return fallback; }
      },
      sql: async () => [{
        id: 2,
        slug: 'a-new-dawn',
        title: 'A new Dawn',
        body: 'Article body',
        created_at: '2026-10-25T20:34:52.135Z',
        published: true,
        author: 'Member',
      }],
    },
    '@/lib/format': { fmtDate: () => '25 Oct 2026' },
    '@/lib/auth': {
      canModerateComments: () => false,
      discordAvatar: () => '/avatar.png',
      getSession: async () => null,
    },
    '@/components/RichText': function RichText() { return null; },
    '@/components/ArticleRichText': function ArticleRichText() { return null; },
    '@/components/ReactionBar': function ReactionBar() { return null; },
    '@/components/ArticleCommentForm': function ArticleCommentForm() { return null; },
    '@/components/EditableArticleComment': function EditableArticleComment() { return null; },
    '@/components/ReplyToComment': function ReplyToComment() { return null; },
    '@/components/ForumRoleBadges': function ForumRoleBadges() { return null; },
    '@/lib/articleContent': { readArticleContent: () => null, safeArticleUrl: () => null },
    '@/lib/forumRoles': { getForumRoleBadgeMap: async () => new Map() },
    '@/lib/commentTree': {
      buildCommentTree: (comments) => comments.map((item) => ({ comment: item, children: [] })),
    },
    '@/lib/queries': {
      getArticleComments: async () => [comment],
      getArticleReactions: async () => { throw new Error('Wrong reaction source table'); },
      getArticleCommentReactions: async () => { throw new Error('Wrong comment reaction source table'); },
    },
  };
  const source = readFileSync(new URL('../app/articles/[slug]/page.tsx', import.meta.url), 'utf8');
  const { code } = transformSync(source, {
    jsc: { parser: { syntax: 'typescript', tsx: true }, target: 'es2022', transform: { react: { runtime: 'automatic' } } },
    module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => {
    if (name === 'react/jsx-runtime') return require(name);
    if (!(name in mocks)) throw new Error(`Unexpected page dependency: ${name}`);
    return mocks[name];
  }, module, module.exports);
  return { Page: module.exports.default, comment };
}

function flattenElements(node, result = []) {
  if (Array.isArray(node)) {
    for (const child of node) flattenElements(child, result);
  } else if (node && typeof node === 'object') {
    result.push(node);
    flattenElements(node.props?.children, result);
  }
  return result;
}

test('an article reaction query failure does not hide saved comments', async () => {
  const { Page } = loadPage();
  const page = await Page({ params: Promise.resolve({ slug: 'a-new-dawn' }) });
  const elements = flattenElements(page);

  assert.ok(elements.some((element) => element.type === 'article' && element.props.className === 'article-comment'));
  assert.ok(elements.some((element) => String(element.props?.className || '').includes('article-interactions-unavailable')));
  assert.ok(elements.some((element) => element.props?.role === 'status' && element.props.children === 'Comment reactions are temporarily unavailable.'));
});

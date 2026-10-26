import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');

function loadQueries() {
  const statements = [];
  const mocks = {
    './db': {
      sql: async (strings) => {
        statements.push(strings.join('?'));
        return [];
      },
    },
    './matchThreads': { ensureMatchThreadTourSchema: async () => {} },
    './presencePolicy': { ONLINE_PRESENCE_WINDOW_MINUTES: 15 },
    './media': { ensureTopicVideoSchema: async () => {} },
  };
  const source = readFileSync(new URL('../lib/queries.ts', import.meta.url), 'utf8');
  const { code } = transformSync(source, {
    jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
    module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => {
    if (!(name in mocks)) throw new Error(`Unexpected query dependency: ${name}`);
    return mocks[name];
  }, module, module.exports);
  return { queries: module.exports, statements };
}

test('discussion and article reactions read from reactions; comment reactions use their own table', async () => {
  const { queries, statements } = loadQueries();

  await queries.getThreadReactions(5, [2], '7');
  await queries.getArticleReactions(6, '7');
  await queries.getArticleCommentReactions([9], '7');

  assert.match(statements[0], /FROM reactions r/);
  assert.match(statements[1], /FROM reactions r/);
  assert.match(statements[2], /FROM article_comment_reactions r/);
  assert.doesNotMatch(statements[2], /FROM reactions r/);
});

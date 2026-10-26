import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCommentTree } from '../lib/commentTree.ts';

test('builds nested discussion replies and keeps roots in their original order', () => {
  const tree = buildCommentTree([
    { id: 1, parent_reply_id: null },
    { id: 2, parent_reply_id: 1 },
    { id: 3, parent_reply_id: null },
    { id: 4, parent_reply_id: 2 },
  ], 'parent_reply_id');

  assert.deepEqual(tree.map((node) => node.comment.id), [1, 3]);
  assert.deepEqual(tree[0].children[0].comment.id, 2);
  assert.deepEqual(tree[0].children[0].children[0].comment.id, 4);
});

test('keeps article comments with unavailable parents visible as roots', () => {
  const tree = buildCommentTree([
    { id: 2, parent_comment_id: 99 },
    { id: 3, parent_comment_id: null },
  ], 'parent_comment_id');

  assert.deepEqual(tree.map((node) => node.comment.id), [2, 3]);
});

test('treats a self-parented comment as a root instead of hiding it', () => {
  const tree = buildCommentTree([{ id: 1, parent_reply_id: 1 }], 'parent_reply_id');
  assert.deepEqual(tree.map((node) => node.comment.id), [1]);
});

export type CommentNode<T> = { comment: T; children: CommentNode<T>[] };

type ParentField = 'parent_reply_id' | 'parent_comment_id';
type ParentReferences = {
  parent_reply_id?: string | number | null;
  parent_comment_id?: string | number | null;
};

export function buildCommentTree<T extends { id: string | number } & ParentReferences>(
  comments: T[],
  parentField: ParentField,
): CommentNode<T>[] {
  const nodes = comments.map((comment) => ({ comment, children: [] as CommentNode<T>[] }));
  const byId = new Map(nodes.map((node) => [Number(node.comment.id), node]));
  const roots: CommentNode<T>[] = [];

  for (const node of nodes) {
    const parentValue = node.comment[parentField];
    const parentId = parentValue == null ? null : Number(parentValue);
    const parent = parentId === null ? undefined : byId.get(parentId);
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }

  return roots;
}

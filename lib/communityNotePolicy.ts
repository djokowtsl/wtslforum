export function hasCommunityNoteConsensus(ratingCount: number, helpfulCount: number) {
  return ratingCount >= 5 && helpfulCount * 5 >= ratingCount * 4;
}

export function anonymizeCommunityNote<T extends { author_id: number | null; author?: string | null }>(
  note: T,
  viewerId: string | null,
): Omit<T, 'author_id' | 'author'> & { viewer_is_author: boolean } {
  const { author_id, author: _author, ...visibleFields } = note;
  void _author;
  return {
    ...visibleFields,
    viewer_is_author: viewerId !== null && author_id !== null && String(author_id) === viewerId,
  };
}

export function partitionCommunityNotes<T extends { has_consensus: boolean }>(notes: T[]) {
  const publicNotes: T[] = [];
  const pendingNotes: T[] = [];
  for (const note of notes) {
    (note.has_consensus ? publicNotes : pendingNotes).push(note);
  }
  return { publicNotes, pendingNotes };
}
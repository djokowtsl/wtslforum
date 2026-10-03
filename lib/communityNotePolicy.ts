export function hasCommunityNoteConsensus(ratingCount: number, helpfulCount: number) {
  return ratingCount >= 5 && helpfulCount * 5 >= ratingCount * 4;
}

export function partitionCommunityNotes<T extends { has_consensus: boolean }>(notes: T[]) {
  const publicNotes: T[] = [];
  const pendingNotes: T[] = [];
  for (const note of notes) {
    (note.has_consensus ? publicNotes : pendingNotes).push(note);
  }
  return { publicNotes, pendingNotes };
}
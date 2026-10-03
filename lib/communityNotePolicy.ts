export function hasCommunityNoteConsensus(ratingCount: number, helpfulCount: number) {
  return ratingCount >= 5 && helpfulCount * 5 >= ratingCount * 4;
}

export function partitionCommunityNotes<T extends { has_consensus: boolean }>(
  notes: readonly T[],
  signedIn: boolean,
) {
  return {
    consensus: notes.filter((note) => note.has_consensus),
    proposed: signedIn ? notes.filter((note) => !note.has_consensus) : [],
  };
}
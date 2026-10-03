export function hasCommunityNoteConsensus(ratingCount: number, helpfulCount: number) {
  return ratingCount >= 5 && helpfulCount * 5 >= ratingCount * 4;
}
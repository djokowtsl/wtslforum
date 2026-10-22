export type AwardProgressCategory = {
  id: number;
  is_required: boolean;
};

export type AwardVoteProgress = {
  requiredSavedCount: number;
  optionalSavedCount: number;
  allQuestionsSaved: boolean;
  completionPercentage: number;
  isSubmitted: boolean;
};

export function getAwardVoteProgress(
  categories: AwardProgressCategory[],
  savedVotes: Record<number, boolean>,
  dirty: Record<number, boolean>,
): AwardVoteProgress {
  const isSaved = (category: AwardProgressCategory) => Boolean(savedVotes[category.id]) && !dirty[category.id];
  const required = categories.filter((category) => category.is_required);
  const optional = categories.filter((category) => !category.is_required);
  const requiredSavedCount = required.filter(isSaved).length;
  const optionalSavedCount = optional.filter(isSaved).length;
  const allQuestionsSaved = categories.length > 0 && categories.every(isSaved);
  const hasSavedVote = categories.some(isSaved);
  const progressTotal = required.length || optional.length;
  const progressSaved = required.length ? requiredSavedCount : optionalSavedCount;
  const requiredComplete = required.length > 0
    ? requiredSavedCount === required.length
    : hasSavedVote;

  return {
    requiredSavedCount,
    optionalSavedCount,
    allQuestionsSaved,
    completionPercentage: progressTotal > 0 ? Math.round((progressSaved / progressTotal) * 100) : 0,
    isSubmitted: requiredComplete && hasSavedVote,
  };
}

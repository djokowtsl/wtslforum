export type AwardProgressCategory = {
  id: number;
  is_required: boolean;
};

export type AwardVoteProgress = {
  requiredSavedCount: number;
  optionalSavedCount: number;
  savedQuestionCount: number;
  questionCount: number;
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
  const savedQuestionCount = categories.filter(isSaved).length;
  const allQuestionsSaved = categories.length > 0 && categories.every(isSaved);
  const hasSavedVote = categories.some(isSaved);
  const requiredComplete = required.length > 0
    ? requiredSavedCount === required.length
    : hasSavedVote;

  return {
    requiredSavedCount,
    optionalSavedCount,
    savedQuestionCount,
    questionCount: categories.length,
    allQuestionsSaved,
    completionPercentage: categories.length > 0 ? Math.round((savedQuestionCount / categories.length) * 100) : 0,
    isSubmitted: requiredComplete && hasSavedVote,
  };
}

export function getNextUnansweredRequiredCategoryId(
  categories: AwardProgressCategory[],
  savedVotes: Record<number, boolean>,
  dirty: Record<number, boolean>,
  justSavedCategoryId: number,
): number | null {
  const justSaved = categories.find((category) => category.id === justSavedCategoryId);
  if (!justSaved?.is_required) return null;

  return categories.find((category) =>
    category.is_required
    && category.id !== justSavedCategoryId
    && (!savedVotes[category.id] || dirty[category.id])
  )?.id ?? null;
}

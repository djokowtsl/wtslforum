export function isAwardVotingOpen(
  votingOpen: boolean,
  closesAt: string | Date | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (!votingOpen) return false;
  if (closesAt == null || closesAt === '') return true;

  const closeTime = closesAt instanceof Date ? closesAt.getTime() : Date.parse(closesAt);
  return Number.isFinite(closeTime) && closeTime > nowMs;
}

type CommentModerationUser = { discordId: string; isAdmin: boolean; isModerator?: boolean };

export function canModerateComments(
  user: CommentModerationUser | null | undefined,
  moderatorIds: string | undefined = process.env.MODERATOR_DISCORD_IDS,
): boolean {
  if (!user) return false;
  if (user.isAdmin || user.isModerator) return true;
  const allowedIds = (moderatorIds || '').split(',').map((id) => id.trim()).filter(Boolean);
  return allowedIds.includes(user.discordId);
}

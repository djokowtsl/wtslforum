import { sql } from './db';

export type PlayerClaim = {
  id: string;
  user_id: string;
  wtsl_player_id: string;
  tour: string;
  player_name: string;
  note: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  reviewed_at: string | null;
  review_note: string | null;
};

/** The requesting user's most recent claim (so the profile page can show its status). */
export async function getLatestClaimForUser(userId: string): Promise<PlayerClaim | null> {
  const rows = await sql`SELECT * FROM player_claims WHERE user_id=${userId} ORDER BY created_at DESC LIMIT 1`;
  return (rows[0] as PlayerClaim) ?? null;
}

/**
 * Submit (or resubmit) a claim that this Discord account is a given WTSL player.
 * This never verifies anything by itself — it only queues the request for an
 * admin to approve or reject, which is what actually links the account.
 */
export async function submitClaim(userId: string, wtslPlayerId: string, tour: string, playerName: string, note: string) {
  const existing = await sql`SELECT id, status FROM player_claims WHERE user_id=${userId} AND status='pending'`;
  if (existing.length) throw new Error('You already have a pending claim awaiting review.');
  const alreadyOwned = await sql`SELECT id FROM player_claims WHERE wtsl_player_id=${wtslPlayerId} AND tour=${tour} AND status='approved'`;
  if (alreadyOwned.length) throw new Error('That player profile is already verified to another account.');
  await sql`INSERT INTO player_claims (user_id, wtsl_player_id, tour, player_name, note) VALUES (${userId}, ${wtslPlayerId}, ${tour}, ${playerName}, ${note})`;
}

export async function listClaims(status?: string): Promise<(PlayerClaim & { username: string; discord_id: string })[]> {
  const rows = status
    ? await sql`SELECT c.*, u.display_name AS username, u.discord_id FROM player_claims c JOIN users u ON u.id=c.user_id WHERE c.status=${status} ORDER BY c.created_at DESC`
    : await sql`SELECT c.*, u.display_name AS username, u.discord_id FROM player_claims c JOIN users u ON u.id=c.user_id ORDER BY c.created_at DESC`;
  return rows as any;
}

/** Approve a claim: links the Discord account to the player and revokes any other approved claim for that player. */
export async function approveClaim(claimId: string, adminId: string) {
  const rows = await sql`SELECT * FROM player_claims WHERE id=${claimId}`;
  const claim = rows[0];
  if (!claim) throw new Error('Claim not found');
  if (claim.status !== 'pending') throw new Error('Claim has already been reviewed');

  await sql`UPDATE player_claims SET status='rejected', reviewed_by=${adminId}, reviewed_at=NOW(), review_note='Superseded by a newly approved claim' WHERE wtsl_player_id=${claim.wtsl_player_id} AND tour=${claim.tour} AND status='approved'`;
  await sql`UPDATE player_claims SET status='approved', reviewed_by=${adminId}, reviewed_at=NOW() WHERE id=${claimId}`;
  await sql`UPDATE users SET verified_player_id=${claim.wtsl_player_id}, verified_player_tour=${claim.tour}, verified_player_name=${claim.player_name}, verified_at=NOW() WHERE id=${claim.user_id}`;
}

export async function rejectClaim(claimId: string, adminId: string, note: string) {
  await sql`UPDATE player_claims SET status='rejected', reviewed_by=${adminId}, reviewed_at=NOW(), review_note=${note} WHERE id=${claimId} AND status='pending'`;
}

/** The verified account owner for a player profile, if any (used on /players/[id] to show a badge). */
export async function getVerifiedOwner(wtslPlayerId: string, tour: string) {
  const rows = await sql`SELECT display_name, avatar_url, discord_id FROM users WHERE verified_player_id=${wtslPlayerId} AND verified_player_tour=${tour} LIMIT 1`;
  return rows[0] ?? null;
}

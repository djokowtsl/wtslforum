import { sql } from './db';
import { notifyChallongeVerified } from './discord';

export type ChallongeClaim = {
  id: string;
  user_id: string;
  challonge_username: string;
  note: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  reviewed_at: string | null;
  review_note: string | null;
};

/** The requesting user's most recent Challonge verification request. */
export async function getLatestChallongeClaimForUser(userId: string): Promise<ChallongeClaim | null> {
  const rows = await sql`SELECT * FROM challonge_claims WHERE user_id=${userId} ORDER BY created_at DESC LIMIT 1`;
  return (rows[0] as ChallongeClaim) ?? null;
}

/**
 * Submit (or resubmit) a claim that this Discord account owns a given Challonge username.
 * Only queues the request for an admin to approve — never verifies anything by itself.
 */
export async function submitChallongeClaim(userId: string, challongeUsername: string, note: string) {
  const username = challongeUsername.trim();
  if (!username) throw new Error('Missing Challonge username');
  const existing = await sql`SELECT id FROM challonge_claims WHERE user_id=${userId} AND status='pending'`;
  if (existing.length) throw new Error('You already have a pending Challonge claim awaiting review.');
  const alreadyOwned = await sql`SELECT id FROM challonge_claims WHERE LOWER(challonge_username)=LOWER(${username}) AND status='approved'`;
  if (alreadyOwned.length) throw new Error('That Challonge username is already verified to another account.');
  await sql`INSERT INTO challonge_claims (user_id, challonge_username, note) VALUES (${userId}, ${username}, ${note})`;
}

export async function listChallongeClaims(status?: string): Promise<(ChallongeClaim & { username: string; discord_id: string })[]> {
  const rows = status
    ? await sql`SELECT c.*, u.display_name AS username, u.discord_id FROM challonge_claims c JOIN users u ON u.id=c.user_id WHERE c.status=${status} ORDER BY c.created_at DESC`
    : await sql`SELECT c.*, u.display_name AS username, u.discord_id FROM challonge_claims c JOIN users u ON u.id=c.user_id ORDER BY c.created_at DESC`;
  return rows as any;
}

/** Approve a Challonge claim: supersedes any other account already verified for that username. */
export async function approveChallongeClaim(claimId: string, adminId: string) {
  const rows = await sql`SELECT * FROM challonge_claims WHERE id=${claimId}`;
  const claim = rows[0];
  if (!claim) throw new Error('Claim not found');
  if (claim.status !== 'pending') throw new Error('Claim has already been reviewed');

  await sql`UPDATE challonge_claims SET status='rejected', reviewed_by=${adminId}, reviewed_at=NOW(), review_note='Superseded by a newly approved claim' WHERE LOWER(challonge_username)=LOWER(${claim.challonge_username}) AND status='approved'`;
  await sql`UPDATE challonge_claims SET status='rejected', reviewed_by=${adminId}, reviewed_at=NOW(), review_note='Superseded by a newly approved claim' WHERE user_id=${claim.user_id} AND status='approved' AND id != ${claimId}`;
  await sql`UPDATE challonge_claims SET status='approved', reviewed_by=${adminId}, reviewed_at=NOW() WHERE id=${claimId}`;

  const owner = await sql`SELECT discord_id FROM users WHERE id=${claim.user_id}`;
  if (owner[0]?.discord_id) await notifyChallongeVerified(owner[0].discord_id, claim.challonge_username);
}

export async function rejectChallongeClaim(claimId: string, adminId: string, note: string) {
  await sql`UPDATE challonge_claims SET status='rejected', reviewed_by=${adminId}, reviewed_at=NOW(), review_note=${note} WHERE id=${claimId} AND status='pending'`;
}

export type ChallongeDisplay = {
  displayName: string;
  avatarUrl: string | null;
  wtslPlayerId: string | null;
  tour: string | null;
  playerName: string | null;
};

/**
 * All verified Challonge usernames mapped to the forum identity they belong to, preferring
 * their verified WTSL player profile (so the predictions leaderboard can link a predictor
 * straight to their official player page) and falling back to their forum display name if
 * they haven't verified a WTSL player yet. Fetched once per page render, not per row.
 */
export async function getChallongeDisplayMap(): Promise<Map<string, ChallongeDisplay>> {
  const rows = await sql`
    SELECT c.challonge_username, u.display_name, u.avatar_url,
           pc.wtsl_player_id, pc.tour, pc.player_name
    FROM challonge_claims c
    JOIN users u ON u.id = c.user_id
    LEFT JOIN LATERAL (
      SELECT wtsl_player_id, tour, player_name
      FROM player_claims
      WHERE user_id = c.user_id AND status = 'approved'
      ORDER BY (tour = 'TE4') DESC, tour
      LIMIT 1
    ) pc ON true
    WHERE c.status = 'approved'
  `;
  const map = new Map<string, ChallongeDisplay>();
  for (const r of rows as any[]) {
    map.set(String(r.challonge_username).toLowerCase(), {
      displayName: r.player_name || r.display_name,
      avatarUrl: r.avatar_url ?? null,
      wtslPlayerId: r.wtsl_player_id ?? null,
      tour: r.tour ?? null,
      playerName: r.player_name ?? null,
    });
  }
  return map;
}

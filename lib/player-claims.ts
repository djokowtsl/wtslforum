import { sql } from './db';
import { notifyPlayerVerified } from './discord';

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

/** The requesting user's most recent claim for one tour (so the profile page can show its status). */
export async function getLatestClaimForUser(userId: string, tour?: string): Promise<PlayerClaim | null> {
  const rows = tour
    ? await sql`SELECT * FROM player_claims WHERE user_id=${userId} AND tour=${tour} ORDER BY created_at DESC LIMIT 1`
    : await sql`SELECT * FROM player_claims WHERE user_id=${userId} ORDER BY created_at DESC LIMIT 1`;
  return (rows[0] as PlayerClaim) ?? null;
}

/**
 * The requesting user's most recent claim per tour, so a player who verifies for
 * ATP, WTA, Doubles etc. independently can see every tour's status at once.
 */
export async function getClaimsForUser(userId: string): Promise<PlayerClaim[]> {
  const rows = await sql`SELECT DISTINCT ON (tour) * FROM player_claims WHERE user_id=${userId} ORDER BY tour, created_at DESC`;
  return rows as PlayerClaim[];
}

export type ApprovedPlayerIdentity = {
  id: string;
  wtsl_player_id: string;
  tour: string;
  player_name: string;
};

/** Approved WTSL identities with current official names, for the profile's discussion-name picker. */
export async function getApprovedPlayerIdentities(userId: string): Promise<ApprovedPlayerIdentity[]> {
  const rows = await sql`
    SELECT c.id::text AS id, c.wtsl_player_id, c.tour, COALESCE(p.name, c.player_name) AS player_name
    FROM player_claims c
    LEFT JOIN wtsl_players p ON p.wtsl_player_id = c.wtsl_player_id AND p.tour = c.tour
    WHERE c.user_id = ${userId} AND c.status = 'approved'
    ORDER BY c.created_at ASC, c.id ASC
  `;
  return rows as ApprovedPlayerIdentity[];
}

export async function getDefaultPlayerClaimId(userId: string): Promise<string | null> {
  const rows = await sql`SELECT default_player_claim_id::text AS id FROM users WHERE id = ${userId} LIMIT 1`;
  return rows[0]?.id ?? null;
}

/** Only approved claims owned by this account can become its default forum identity. */
export async function setDefaultPlayerClaim(userId: string, claimId: string): Promise<boolean> {
  const rows = await sql`
    UPDATE users u
    SET default_player_claim_id = ${claimId}
    WHERE u.id = ${userId}
      AND EXISTS (
        SELECT 1 FROM player_claims c
        WHERE c.id = ${claimId} AND c.user_id = u.id AND c.status = 'approved'
      )
    RETURNING u.id
  `;
  return rows.length > 0;
}

/**
 * Submit (or resubmit) a claim that this Discord account is a given WTSL player.
 * This never verifies anything by itself — it only queues the request for an
 * admin to approve or reject, which is what actually links the account.
 * Scoped per tour, so a player can have a pending claim for one tour (e.g. ATP)
 * while already verified — or awaiting review — on another (e.g. WTA).
 */
export async function submitClaim(userId: string, wtslPlayerId: string, tour: string, playerName: string, note: string) {
  const existing = await sql`SELECT id, status FROM player_claims WHERE user_id=${userId} AND tour=${tour} AND status='pending'`;
  if (existing.length) throw new Error('You already have a pending claim for this tour awaiting review.');
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

/** Approve a claim: links the Discord account to the player and revokes any other approved claim for that player or tour. */
export async function approveClaim(claimId: string, adminId: string) {
  const rows = await sql`SELECT * FROM player_claims WHERE id=${claimId}`;
  const claim = rows[0];
  if (!claim) throw new Error('Claim not found');
  if (claim.status !== 'pending') throw new Error('Claim has already been reviewed');

  // Supersede any other account already verified as this player on this tour...
  await sql`UPDATE player_claims SET status='rejected', reviewed_by=${adminId}, reviewed_at=NOW(), review_note='Superseded by a newly approved claim' WHERE wtsl_player_id=${claim.wtsl_player_id} AND tour=${claim.tour} AND status='approved'`;
  // ...and any other player this same account was verified as on this same tour.
  await sql`UPDATE player_claims SET status='rejected', reviewed_by=${adminId}, reviewed_at=NOW(), review_note='Superseded by a newly approved claim' WHERE user_id=${claim.user_id} AND tour=${claim.tour} AND status='approved' AND id != ${claimId}`;
  await sql`UPDATE player_claims SET status='approved', reviewed_by=${adminId}, reviewed_at=NOW() WHERE id=${claimId}`;
  // The first verified identity becomes the default; preserve a valid user-selected default later.
  await sql`
    UPDATE users u
    SET default_player_claim_id = ${claim.id}
    WHERE u.id = ${claim.user_id}
      AND NOT EXISTS (
        SELECT 1 FROM player_claims current_claim
        WHERE current_claim.id = u.default_player_claim_id
          AND current_claim.user_id = u.id AND current_claim.status = 'approved'
      )
  `;

  const owner = await sql`SELECT discord_id FROM users WHERE id=${claim.user_id}`;
  if (owner[0]?.discord_id) await notifyPlayerVerified(owner[0].discord_id, claim.player_name, claim.tour);
}

export async function rejectClaim(claimId: string, adminId: string, note: string) {
  await sql`UPDATE player_claims SET status='rejected', reviewed_by=${adminId}, reviewed_at=NOW(), review_note=${note} WHERE id=${claimId} AND status='pending'`;
}

/** The verified account owner for a player profile, if any (used on /players/[id] to show a badge). */
export async function getVerifiedOwner(wtslPlayerId: string, tour: string) {
  const rows = await sql`SELECT u.id, u.display_name, u.avatar_url, u.discord_id, u.status, u.created_at FROM player_claims c JOIN users u ON u.id=c.user_id WHERE c.wtsl_player_id=${wtslPlayerId} AND c.tour=${tour} AND c.status='approved' LIMIT 1`;
  return rows[0] ?? null;
}

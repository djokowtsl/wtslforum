import { sql } from './db';
import { notifyPlayerVerified } from './discord';
import { ONLINE_PRESENCE_WINDOW_MINUTES } from './presencePolicy';
import { wtslCore } from './wtsl-core';

export class PlayerIdentityConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlayerIdentityConflictError';
  }
}

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
/** Apply an identity already approved by the WTSL Discord server to a forum account. */
export async function applyServerApprovedPlayerIdentity(
  userId: string,
  identity: { wtsl_player_id: string; tour: string; player_name: string },
): Promise<{ status: 'synced' | 'already_synced'; claimId: string }> {
  const wtslPlayerId = String(identity.wtsl_player_id || '').trim();
  const tour = String(identity.tour || '').trim();
  const playerName = String(identity.player_name || '').trim();
  if (!wtslPlayerId || !playerName || !['TE4', 'TE4_(F)'].includes(tour)) {
    throw new Error('The server-approved player identity is incomplete or unsupported.');
  }

  const existing = await sql`
    SELECT id::text AS id FROM player_claims
    WHERE user_id = ${userId} AND wtsl_player_id = ${wtslPlayerId}
      AND tour = ${tour} AND status = 'approved' LIMIT 1
  `;
  let claimId = existing[0]?.id as string | undefined;
  let status: 'synced' | 'already_synced' = claimId ? 'already_synced' : 'synced';

  if (!claimId) {
    const conflicts = await sql`
      SELECT CASE
        WHEN c.wtsl_player_id = ${wtslPlayerId}
          THEN 'This WTSL player is already verified to another forum account.'
        ELSE 'This forum account already has a different approved player for this tour.'
      END AS reason
      FROM player_claims c
      WHERE c.tour = ${tour} AND c.status = 'approved'
        AND ((c.wtsl_player_id = ${wtslPlayerId} AND c.user_id <> ${userId})
          OR (c.user_id = ${userId} AND c.wtsl_player_id <> ${wtslPlayerId}))
      LIMIT 1
    `;
    if (conflicts.length) throw new PlayerIdentityConflictError(String(conflicts[0].reason));

    const pending = await sql`
      SELECT id::text AS id FROM player_claims
      WHERE user_id = ${userId} AND wtsl_player_id = ${wtslPlayerId}
        AND tour = ${tour} AND status = 'pending'
      ORDER BY created_at DESC LIMIT 1
    `;
    let rows: any[];
    try {
      rows = pending.length
        ? await sql`
            UPDATE player_claims
            SET player_name = ${playerName}, status = 'approved', reviewed_by = NULL,
                reviewed_at = NOW(), review_note = 'Approved via WTSL Discord server'
            WHERE id = ${pending[0].id} AND status = 'pending'
            RETURNING id::text AS id
          `
        : await sql`
            INSERT INTO player_claims
              (user_id, wtsl_player_id, tour, player_name, note, status, reviewed_at, review_note)
            VALUES
              (${userId}, ${wtslPlayerId}, ${tour}, ${playerName}, '', 'approved', NOW(),
               'Approved via WTSL Discord server')
            RETURNING id::text AS id
          `;
    } catch (error) {
      if ((error as { code?: string })?.code === '23505') {
        throw new PlayerIdentityConflictError('This WTSL player is already verified to another forum account.');
      }
      throw error;
    }
    if (!rows[0]?.id) throw new Error('The approved forum player identity could not be saved.');
    claimId = String(rows[0].id);
  }

  await sql`
    UPDATE users u
    SET default_player_claim_id = ${claimId}
    WHERE u.id = ${userId}
      AND NOT EXISTS (
        SELECT 1 FROM player_claims current_claim
        WHERE current_claim.id = u.default_player_claim_id
          AND current_claim.user_id = u.id AND current_claim.status = 'approved'
      )
  `;
  return { status, claimId };
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
  const rows = await sql`
    SELECT c.*, u.discord_id
    FROM player_claims c JOIN users u ON u.id = c.user_id
    WHERE c.id = ${claimId}
  `;
  const claim = rows[0];
  if (!claim) throw new Error('Claim not found');
  if (claim.status !== 'pending') throw new Error('Claim has already been reviewed');

  // Only the bot's ATP/WTA MatchLog identity store is mirrored. Other forum
  // tours keep their existing forum-only approval behavior.
  const coreTour = claim.tour === 'TE4' ? 'atp' : claim.tour === 'TE4_(F)' ? 'wta' : null;
  if (coreTour) {
    await wtslCore.syncMatchlogIdentity({
      discord_user_id: String(claim.discord_id),
      tour: coreTour,
      player_name: String(claim.player_name),
      wtsl_player_id: String(claim.wtsl_player_id),
    });
  }

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
  const rows = await sql`
    SELECT u.id, u.display_name, u.avatar_url, u.discord_id,
      CASE WHEN u.status='online' AND (
        u.last_active_at IS NULL OR u.last_active_at < NOW() - ${ONLINE_PRESENCE_WINDOW_MINUTES} * INTERVAL '1 minute'
      ) THEN 'offline' ELSE COALESCE(u.status,'offline') END AS status,
      u.created_at
    FROM player_claims c
    JOIN users u ON u.id=c.user_id
    WHERE c.wtsl_player_id=${wtslPlayerId} AND c.tour=${tour} AND c.status='approved'
    LIMIT 1`;
  return rows[0] ?? null;
}

import { sql } from './db';
import { applyServerApprovedPlayerIdentity, PlayerIdentityConflictError } from './player-claims';
import { wtslCore, type CoreMatchlogIdentity } from './wtsl-core';

type CoreTour = 'atp' | 'wta';
type ForumTour = 'TE4' | 'TE4_(F)';
type OfficialPlayer = { wtsl_player_id: string; tour: ForumTour; name: string };

export class WtslPlayerLookupError extends Error {
  constructor(message: string, readonly statusCode: 404 | 409) {
    super(message);
    this.name = 'WtslPlayerLookupError';
  }
}

function forumTourForCore(tour: string): ForumTour | null {
  if (tour === 'atp') return 'TE4';
  if (tour === 'wta') return 'TE4_(F)';
  return null;
}

async function findOfficialPlayer(
  tour: ForumTour,
  playerName: string,
  wtslPlayerId?: string | null,
): Promise<OfficialPlayer> {
  const rows = wtslPlayerId
    ? await sql`
        SELECT wtsl_player_id, tour, name FROM wtsl_players
        WHERE tour = ${tour} AND wtsl_player_id = ${wtslPlayerId} LIMIT 2
      `
    : await sql`
        SELECT wtsl_player_id, tour, name FROM wtsl_players
        WHERE tour = ${tour} AND LOWER(BTRIM(name)) = LOWER(BTRIM(${playerName}))
        LIMIT 2
      `;
  if (!rows.length) {
    throw new WtslPlayerLookupError(
      'No exact player match was found in the forum WTSL data for this tour.',
      404,
    );
  }
  if (rows.length !== 1) {
    throw new WtslPlayerLookupError(
      'The WTSL player match is ambiguous; no identity was synchronized.',
      409,
    );
  }
  return {
    wtsl_player_id: String(rows[0].wtsl_player_id),
    tour,
    name: String(rows[0].name),
  };
}

/** Resolve a bot-approved player by Discord ID + tour, without requiring a forum claim. */
export async function syncDiscordApprovedIdentity(
  discordId: string,
  coreTour: string,
  playerName: string,
) {
  const tour = forumTourForCore(coreTour);
  if (!tour) {
    throw new WtslPlayerLookupError(
      'Only ATP and WTA identities can sync to MatchLog.',
      409,
    );
  }
  const player = await findOfficialPlayer(tour, playerName);
  const otherOwner = await sql`
    SELECT c.id FROM player_claims c JOIN users u ON u.id = c.user_id
    WHERE c.wtsl_player_id = ${player.wtsl_player_id} AND c.tour = ${tour}
      AND c.status = 'approved' AND u.discord_id <> ${discordId} LIMIT 1
  `;
  if (otherOwner.length) {
    throw new PlayerIdentityConflictError(
      'This WTSL player is already verified to another forum account.',
    );
  }
  const users = await sql`SELECT id::text AS id FROM users WHERE discord_id = ${discordId} LIMIT 1`;
  if (!users[0]) {
    return { status: 'awaiting_account', wtsl_player_id: player.wtsl_player_id, player_name: player.name };
  }
  const applied = await applyServerApprovedPlayerIdentity(String(users[0].id), {
    wtsl_player_id: player.wtsl_player_id,
    tour: player.tour,
    player_name: player.name,
  });
  return { status: applied.status, wtsl_player_id: player.wtsl_player_id, player_name: player.name };
}

/** Pull only this Discord account's approved bot identities after Discord OAuth login. */
export async function syncBotApprovedIdentitiesForUser(
  userId: string,
  discordId: string,
) {
  const response = await wtslCore.matchlogIdentities(discordId);
  const identities: CoreMatchlogIdentity[] = Array.isArray(response.identities)
    ? response.identities
    : [];
  const failures: string[] = [];
  const applied: Array<{ tour: ForumTour; player_name: string; status: string }> = [];

  for (const identity of identities) {
    if (String(identity.discord_user_id) !== discordId) continue;
    const tour = forumTourForCore(String(identity.tour));
    if (!tour) continue;
    try {
      const player = await findOfficialPlayer(
        tour,
        String(identity.player_name || ''),
        identity.wtsl_player_id,
      );
      await wtslCore.syncMatchlogIdentity({
        discord_user_id: discordId,
        tour: String(identity.tour) as CoreTour,
        player_name: player.name,
        wtsl_player_id: player.wtsl_player_id,
      });
      const result = await applyServerApprovedPlayerIdentity(userId, {
        wtsl_player_id: player.wtsl_player_id,
        tour: player.tour,
        player_name: player.name,
      });
      applied.push({ tour, player_name: player.name, status: result.status });
    } catch (error) {
      failures.push(`${identity.tour}: ${error instanceof Error ? error.message : 'sync failed'}`);
    }
  }
  if (failures.length) {
    throw new Error(`Some server-approved player identities could not be synchronized: ${failures.join('; ')}`);
  }
  return applied;
}

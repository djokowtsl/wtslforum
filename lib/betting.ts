import { wtslCore } from './wtsl-core';
import { normalizePlayerName } from './queries';

/** Display-only odds helpers retained from the original bot semantics. */
export const POOL_TAKEOUT = 0.05;
export function houseAdjustedOdds(officialOdds:number){ if(officialOdds<=0) throw new Error('Odds must be positive'); return Math.max(1, officialOdds/(1+POOL_TAKEOUT)); }
export function poolOdds(totalPool:number, selectedPool:number){ if(totalPool<=0 || selectedPool<=0) throw new Error('Pool amounts must be positive'); return Math.max(1, totalPool*(1-POOL_TAKEOUT)/selectedPool); }
export function hybridOdds(officialOdds:number, pool:number|null){ return Math.max(houseAdjustedOdds(officialOdds), pool ?? 0); }

/** The Replit WTSL bot is authoritative. No second balance/ledger is created here. */
export async function openFixtures(){ return wtslCore.fixtures(); }

/** Open fixtures plus the bot's own recently-settled list (winner, result note, settled time)
 * in a single request — used by the betting board to show completed matches too. Note the
 * bot doesn't always close out every finished match promptly, so this list can be incomplete;
 * pair it with `excludeStaleFixtures` for the open side. */
export async function fixturesBoard(){ return wtslCore.fixturesBoard(); }

/** Drops any fixture whose player pairing is already in a completed-pairs set (see
 * `recentlyCompletedPairs` in lib/stats.ts) — i.e. a fixture the bot hasn't closed out yet
 * even though the match has actually been played and synced. */
export function excludeStaleFixtures<T extends { first_id?: string | number; second_id?: string | number; first_name?: string; second_name?: string }>(
  fixtures: T[],
  completedPairs: Set<string>,
): T[] {
  return fixtures.filter((f) => {
    const idKey = f.first_id && f.second_id
      ? [String(f.first_id), String(f.second_id)].sort().join('|')
      : null;
    const nameKey = f.first_name && f.second_name
      ? [normalizePlayerName(f.first_name), normalizePlayerName(f.second_name)].sort().join('|')
      : null;
    return !(idKey && completedPairs.has(idKey)) && !(nameKey && completedPairs.has(nameKey));
  });
}
export async function getBalance(discordId:string){ return wtslCore.balance(discordId); }
export async function getBets(discordId:string){ return wtslCore.bets(discordId); }
export async function placeBet(discordId:string, fixtureId:number, selectionId:string, stake:number){
  if(!Number.isFinite(stake)||stake<=0) throw new Error('Invalid stake');
  return wtslCore.placeBet({discordId, fixtureId, selectionId, stake});
}

import { wtslCore } from './wtsl-core';

/** Display-only odds helpers retained from the original bot semantics. */
export const POOL_TAKEOUT = 0.05;
export function houseAdjustedOdds(officialOdds:number){ if(officialOdds<=0) throw new Error('Odds must be positive'); return Math.max(1, officialOdds/(1+POOL_TAKEOUT)); }
export function poolOdds(totalPool:number, selectedPool:number){ if(totalPool<=0 || selectedPool<=0) throw new Error('Pool amounts must be positive'); return Math.max(1, totalPool*(1-POOL_TAKEOUT)/selectedPool); }
export function hybridOdds(officialOdds:number, pool:number|null){ return Math.max(houseAdjustedOdds(officialOdds), pool ?? 0); }

/** The Replit WTSL bot is authoritative. No second balance/ledger is created here. */
import { sql } from './db';

export async function openFixtures(){
  const fixtures = await wtslCore.fixtures();
  if (!fixtures.length) return fixtures;
  const canonicalTour = (value?: string) => {
    const normalized = String(value ?? '').toLowerCase();
    if (normalized === 'wta' || normalized === 'te4_(f)') return 'TE4_(F)';
    if (normalized === 'atp' || normalized === 'te4') return 'TE4';
    return value || 'TE4';
  };
  try {
    const players = await sql`
      SELECT tour, wtsl_player_id, avatar_url, flag_url, country
      FROM wtsl_players
      WHERE tour IN ('TE4','TE4_(F)')
    `;
    const byId = new Map<string, any>();
    for (const player of players as any[]) {
      byId.set(`${player.tour}:${player.wtsl_player_id}`, player);
    }
    return fixtures.map((fixture) => {
      const tour = canonicalTour(fixture.tour);
      const first = byId.get(`${tour}:${fixture.first_id}`);
      const second = byId.get(`${tour}:${fixture.second_id}`);
      return {
        ...fixture,
        tour,
        first_avatar: fixture.first_avatar || first?.avatar_url || null,
        first_flag: first?.flag_url || null,
        first_country: first?.country || null,
        second_avatar: fixture.second_avatar || second?.avatar_url || null,
        second_flag: second?.flag_url || null,
        second_country: second?.country || null,
      };
    });
  } catch {
    return fixtures;
  }
}

/** Open fixtures plus the bot's recently-settled list in one request. */
export async function fixturesBoard(){ return wtslCore.fixturesBoard(); }

export async function getBalance(discordId:string){ return wtslCore.balance(discordId); }
export async function getBets(discordId:string){ return wtslCore.bets(discordId); }
export async function placeBet(discordId:string, fixtureId:number, selectionId:string, stake:number){
  if(!Number.isFinite(stake)||stake<=0) throw new Error('Invalid stake');
  return wtslCore.placeBet({discordId, fixtureId, selectionId, stake});
}

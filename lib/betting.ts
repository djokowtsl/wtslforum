import { wtslCore } from './wtsl-core';

/** Display-only odds helpers retained from the original bot semantics. */
export const POOL_TAKEOUT = 0.05;
export function houseAdjustedOdds(officialOdds:number){ if(officialOdds<=0) throw new Error('Odds must be positive'); return Math.max(1, officialOdds/(1+POOL_TAKEOUT)); }
export function poolOdds(totalPool:number, selectedPool:number){ if(totalPool<=0 || selectedPool<=0) throw new Error('Pool amounts must be positive'); return Math.max(1, totalPool*(1-POOL_TAKEOUT)/selectedPool); }
export function hybridOdds(officialOdds:number, pool:number|null){ return Math.max(houseAdjustedOdds(officialOdds), pool ?? 0); }

/** The Replit WTSL bot is authoritative. No second balance/ledger is created here. */
export async function openFixtures(){ return wtslCore.fixtures(); }
export async function getBalance(discordId:string){ return wtslCore.balance(discordId); }
export async function getBets(discordId:string){ return wtslCore.bets(discordId); }
export async function placeBet(discordId:string, fixtureId:number, selectionId:string, stake:number){
  if(!Number.isFinite(stake)||stake<=0) throw new Error('Invalid stake');
  return wtslCore.placeBet({discordId, fixtureId, selectionId, stake});
}

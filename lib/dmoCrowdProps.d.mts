export type CrowdProp = 'cap' | 'drink' | 'snack' | 'sign';
export const CROWD_PROP_SHARES: Readonly<Record<CrowdProp, number>>;
export const CROWD_SIGN_MESSAGES: readonly string[];
export const CROWD_SIGN_COLORS: readonly string[];
export const CROWD_CAP_COLORS: readonly number[];
export function crowdPropFor(seat: number, row?: number): CrowdProp | null;
export function crowdSignMessageFor(seat: number): number;
export function crowdCapColorFor(seat: number): number;
export function crowdDrinkIsCup(seat: number): boolean;

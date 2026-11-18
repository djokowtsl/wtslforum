// What a spectator has with them: a cap, a sign, a drink or a snack. Fixed
// per seat (the same person always has the same thing), one each, and only
// for some of the crowd, as in a real stand.

/** Shares of the crowd with each prop. */
export const CROWD_PROP_SHARES = Object.freeze({
  cap: 0.07,
  drink: 0.05,
  snack: 0.02,
  sign: 0.015,
});

/** Messages on the signs fans hold up (no sponsor marks or real-world brands). */
export const CROWD_SIGN_MESSAGES = Object.freeze([
  'WTSL', 'ACE!', 'COME ON!', 'VAMOS!', 'ALLEZ!', '♥ TENNIS', 'GAME ON', 'WOW!',
]);

/** Sign background colours, one per message. */
export const CROWD_SIGN_COLORS = Object.freeze([
  '#174e5d', '#913841', '#335b43', '#765276', '#a17a2e', '#f2efe6', '#24344d', '#b5482f',
]);

/** Cap colours. */
export const CROWD_CAP_COLORS = Object.freeze([
  0x184d66, 0x9d3037, 0xd1ae42, 0xf0eee5, 0x29363d, 0x467357, 0x71466d,
]);

function hash(seat, row, salt) {
  let value = (seat * 2654435761 + row * 40503 + salt * 97) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d) >>> 0;
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b) >>> 0;
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

/** 'cap', 'drink', 'snack', 'sign' or null for this seat. */
export function crowdPropFor(seat, row = 0) {
  if (!Number.isInteger(seat) || seat < 0) return null;
  let roll = hash(seat, Number.isInteger(row) ? row : 0, 11);
  for (const [prop, share] of Object.entries(CROWD_PROP_SHARES)) {
    if (roll < share) return prop;
    roll -= share;
  }
  return null;
}

/** Which message a sign holder has. */
export function crowdSignMessageFor(seat) {
  return Math.floor(hash(seat, 0, 23) * CROWD_SIGN_MESSAGES.length) % CROWD_SIGN_MESSAGES.length;
}

/** Which colour a cap is. */
export function crowdCapColorFor(seat) {
  return CROWD_CAP_COLORS[Math.floor(hash(seat, 0, 31) * CROWD_CAP_COLORS.length) % CROWD_CAP_COLORS.length];
}

/** Whether a drink is a cup (true) or a bottle (false). */
export function crowdDrinkIsCup(seat) {
  return hash(seat, 0, 41) < 0.7;
}

export const HIGH_DETAIL_CROWD_ROW_LIMIT = 2;
export const HIGH_DETAIL_CROWD_SEAT_STRIDE = 2;

/** Give every seat in the nearest rows a player-grade mesh, split by model gender. */
export function shouldUseHighDetailCrowdSeat(row: number, seatIndex: number, genderIndex: number) {
  return row < HIGH_DETAIL_CROWD_ROW_LIMIT && seatIndex % HIGH_DETAIL_CROWD_SEAT_STRIDE === genderIndex;
}

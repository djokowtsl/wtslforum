export const HIGH_DETAIL_CROWD_ROW_LIMIT = 2;
export const HIGH_DETAIL_CROWD_SEAT_STRIDE = 8;

/** Keep the full-resolution crowd mesh to a sparse, even subset of near seats. */
export function shouldUseHighDetailCrowdSeat(row: number, seatIndex: number, genderIndex: number) {
  return row < HIGH_DETAIL_CROWD_ROW_LIMIT && seatIndex % HIGH_DETAIL_CROWD_SEAT_STRIDE === genderIndex;
}

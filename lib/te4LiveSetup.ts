/**
 * The live court needs non-zero player coordinates in the locally parsed DMO.
 * This checks the derived court rows only; it never reads or uploads the DMO.
 */
export function hasPlayerPositionData(court: readonly number[][]): boolean {
  return court.some((row) => {
    if (row.length < 7) return false;
    return row.slice(3, 7).some((coordinate) => Number.isFinite(coordinate) && Math.abs(coordinate) >= 100);
  });
}

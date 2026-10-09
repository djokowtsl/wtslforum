/** Use explicit fields: Intl forbids combining dateStyle with timeZoneName. */
export function formatSnapshotRefreshTime(timestamp: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(timestamp));
}

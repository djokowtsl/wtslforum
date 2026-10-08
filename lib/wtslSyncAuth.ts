type WtslSyncSecrets = {
  externalSecret?: string;
  cronSecret?: string;
};

export function isWtslSyncAuthorized(
  headers: Pick<Headers, 'get'>,
  secrets: WtslSyncSecrets = {
    externalSecret: process.env.WTSL_SYNC_SECRET,
    cronSecret: process.env.CRON_SECRET,
  },
): boolean {
  const external = headers.get('x-wtsl-sync-secret');
  const authorization = headers.get('authorization');
  return Boolean(
    (secrets.externalSecret && external === secrets.externalSecret)
    || (secrets.cronSecret && authorization === `Bearer ${secrets.cronSecret}`),
  );
}

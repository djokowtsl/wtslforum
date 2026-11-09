export const MAX_DMO_SUBMISSION_BYTES = 20 * 1024 * 1024;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DMO_UPLOAD_PATH_PATTERN = /^dmo\/(\d{1,20})\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})-([a-z0-9._-]{1,100}\.dmo)$/i;

export function safeDmoSubmissionFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100) || 'match-recording.dmo';
}

export function buildDmoSubmissionUploadPath(userId: string, uploadId: string, fileName: string) {
  if (!/^\d{1,20}$/.test(userId) || !UUID_PATTERN.test(uploadId)) {
    throw new Error('The recording upload could not be prepared.');
  }
  return `dmo/${userId}/${uploadId}-${safeDmoSubmissionFileName(fileName)}`;
}

export function isOwnedDmoSubmissionUploadPath(pathname: unknown, userId: string) {
  if (typeof pathname !== 'string' || pathname.length > 240 || !/^\d{1,20}$/.test(userId)) {
    return false;
  }
  const match = DMO_UPLOAD_PATH_PATTERN.exec(pathname);
  return Boolean(match && match[1] === userId);
}

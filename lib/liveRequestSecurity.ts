export function isSameSiteMutation(request: Request): boolean {
  const originValue = request.headers.get('origin');
  if (!originValue) return false;

  let origin: URL;
  try {
    origin = new URL(originValue);
  } catch {
    return false;
  }
  if (origin.protocol !== 'https:' && origin.protocol !== 'http:') return false;

  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = (forwardedHost || request.headers.get('host') || '').toLowerCase();
  if (!host || origin.host.toLowerCase() !== host) return false;

  const forwardedProtocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
  return !forwardedProtocol || origin.protocol === `${forwardedProtocol}:`;
}

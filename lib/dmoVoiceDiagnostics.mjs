export function canViewDmoVoiceDiagnostics(user) {
  const username = String(user?.username || '').trim().toLowerCase();
  return Boolean(user?.isAdmin && (username === 'squeaky' || username === 'squeaky94'));
}

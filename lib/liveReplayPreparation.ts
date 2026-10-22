export async function attemptFullReplayPreparation(
  prepare: () => Promise<void>,
): Promise<boolean> {
  try {
    await prepare();
    return true;
  } catch {
    return false;
  }
}

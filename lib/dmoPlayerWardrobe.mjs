function hashSeed(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// Version the deterministic assignment so existing replays get one new kit
// lineup with this wardrobe, then keep that lineup stable on every replay.
const KIT_SELECTION_EPOCH = 'kit-lineup-v2';

export function selectDmoPlayerKitIndices(matchKey, playerIdentities, kitCount) {
  const count = Math.floor(kitCount);
  if (!Number.isFinite(count) || count < 1) return [0, 0];

  const key = String(matchKey ?? '').trim();
  const indices = playerIdentities.map((identity, slot) => (
    hashSeed(`${KIT_SELECTION_EPOCH}|${key}|${String(identity ?? '').trim()}|${slot}`) % count
  ));
  const first = indices[0] ?? 0;
  let second = indices[1] ?? 0;
  if (count > 1 && second === first) second = (second + 1) % count;
  return [first, second];
}

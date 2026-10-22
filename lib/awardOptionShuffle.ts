type ShuffleSettings = {
  shuffle_options?: boolean | null;
  shuffle_options_override?: boolean | null;
};

export function getAwardShuffleSetting(settings: ShuffleSettings) {
  return settings.shuffle_options_override ?? settings.shuffle_options ?? false;
}

function hashSeed(seed: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function createRandom(seed: number) {
  let state = seed;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic Fisher-Yates shuffle; the same voter/category seed keeps the order stable. */
export function shuffleAwardOptions<T>(options: readonly T[], seed: string): T[] {
  const shuffled = [...options];
  if (!seed) return shuffled;
  const random = createRandom(hashSeed(seed));
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

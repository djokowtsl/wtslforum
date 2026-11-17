// Viewer settings for the live and replay court, remembered on this device.
// Browser storage can be missing, full or blocked, so every read and write is
// guarded and invalid values are ignored.

export const DMO_BROADCAST_SETTINGS_KEY = 'wtsl-broadcast-settings-v1';

const CAMERA_VIEWS = new Set([
  'court', 'aerial', 'tv',
  'player-one-first', 'player-one-third', 'player-two-first', 'player-two-third',
]);
const TIMES_OF_DAY = new Set(['day', 'evening', 'night']);
const RENDER_SETTINGS = new Set(['auto', '720p', '1080p', '4k']);
const CROWD_DENSITIES = new Set(['auto', 'light', 'standard', 'packed']);
const SPEEDS = new Set([0.25, 0.5, 1, 2, 4, 8]);

const volume = (value) => (typeof value === 'number' && value >= 0 && value <= 1 ? value : undefined);
const flag = (value) => (typeof value === 'boolean' ? value : undefined);
const oneOf = (set) => (value) => (set.has(value) ? value : undefined);

const FIELDS = {
  cameraLive: oneOf(CAMERA_VIEWS),
  cameraReplay: oneOf(CAMERA_VIEWS),
  timeOfDay: oneOf(TIMES_OF_DAY),
  soundEnabled: flag,
  gruntsEnabled: flag,
  crowdVolume: volume,
  effectsVolume: volume,
  renderLive: oneOf(RENDER_SETTINGS),
  // Full replays don't offer "auto".
  renderReplay: (value) => (value !== 'auto' ? oneOf(RENDER_SETTINGS)(value) : undefined),
  crowdDensity: oneOf(CROWD_DENSITIES),
  replaySpeed: oneOf(SPEEDS),
};

/** Only the fields that are present and valid. */
export function sanitizeDmoBroadcastSettings(value) {
  const result = {};
  if (!value || typeof value !== 'object') return result;
  for (const [key, check] of Object.entries(FIELDS)) {
    const checked = check(value[key]);
    if (checked !== undefined) result[key] = checked;
  }
  return result;
}

function defaultStorage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function readDmoBroadcastSettings(storage = defaultStorage()) {
  try {
    const raw = storage?.getItem(DMO_BROADCAST_SETTINGS_KEY);
    return raw ? sanitizeDmoBroadcastSettings(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

/** Merges valid fields of `patch` into the saved settings. Returns false when they couldn't be saved. */
export function saveDmoBroadcastSettings(patch, storage = defaultStorage()) {
  if (!storage) return false;
  try {
    const next = { ...readDmoBroadcastSettings(storage), ...sanitizeDmoBroadcastSettings(patch) };
    storage.setItem(DMO_BROADCAST_SETTINGS_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

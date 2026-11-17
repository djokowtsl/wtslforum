export const DMO_BROADCAST_SETTINGS_KEY: string;

type SavedCameraView =
  | 'court' | 'aerial' | 'tv'
  | 'player-one-first' | 'player-one-third' | 'player-two-first' | 'player-two-third';

export interface DmoBroadcastSettings {
  cameraLive?: SavedCameraView;
  cameraReplay?: SavedCameraView;
  timeOfDay?: 'day' | 'evening' | 'night';
  soundEnabled?: boolean;
  gruntsEnabled?: boolean;
  crowdVolume?: number;
  effectsVolume?: number;
  renderLive?: 'auto' | '720p' | '1080p' | '4k';
  renderReplay?: '720p' | '1080p' | '4k';
  crowdDensity?: 'auto' | 'light' | 'standard' | 'packed';
  replaySpeed?: 0.25 | 0.5 | 1 | 2 | 4 | 8;
  settingsSeen?: boolean;
}

type SettingsStorage = Pick<Storage, 'getItem' | 'setItem'> | null | undefined;

export function sanitizeDmoBroadcastSettings(value: unknown): DmoBroadcastSettings;
export function readDmoBroadcastSettings(storage?: SettingsStorage): DmoBroadcastSettings;
export function saveDmoBroadcastSettings(patch: DmoBroadcastSettings, storage?: SettingsStorage): boolean;

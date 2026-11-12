import type { KokoroTTS } from 'kokoro-js';

export function isDmoLocalVoiceDeviceSupported(options?: {
  userAgent?: string;
  deviceMemory?: number | null;
  maxTouchPoints?: number;
  allowMobile?: boolean;
}): boolean;

export function isMobileDmoVoiceDevice(options?: {
  userAgent?: string;
  maxTouchPoints?: number;
}): boolean;

export function canUseDmoLocalVoice(options?: { allowMobile?: boolean }): boolean;

export function isMobileDmoLocalVoiceDevice(): boolean;

export function loadDmoLocalVoiceModel(
  onProgress?: (progress: {
    status?: string;
    progress?: number;
    total?: number;
  }) => void,
): Promise<KokoroTTS>;

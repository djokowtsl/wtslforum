import type { KokoroTTS } from 'kokoro-js';

export function isDmoLocalVoiceDeviceSupported(options?: {
  userAgent?: string;
  deviceMemory?: number | null;
  maxTouchPoints?: number;
}): boolean;

export function canUseDmoLocalVoice(): boolean;

export function loadDmoLocalVoiceModel(
  onProgress?: (progress: {
    status?: string;
    progress?: number;
    total?: number;
  }) => void,
): Promise<KokoroTTS>;

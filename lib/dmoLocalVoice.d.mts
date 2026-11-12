import type { KokoroTTS } from 'kokoro-js';

export function loadDmoLocalVoiceModel(
  onProgress?: (progress: {
    status?: string;
    progress?: number;
    total?: number;
  }) => void,
): Promise<KokoroTTS>;

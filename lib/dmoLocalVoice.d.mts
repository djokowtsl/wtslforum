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

export const DMO_VOICE_WARMUP_TEXT: string;

export type DmoCommentaryVoice = {
  readonly dmoVoiceSource: 'server' | 'local';
  generate(
    text: string,
    options?: { voice?: string; speed?: number; priority?: 'high' | 'low' },
  ): Promise<{ audio: Float32Array; sampling_rate: number }>;
  prefetch(text: string, options?: { voice?: string; speed?: number }): void;
};

export function loadDmoLocalVoiceModel(
  onProgress?: (progress: {
    status?: string;
    progress?: number;
    total?: number;
    backend?: 'wasm' | 'server';
  }) => void,
  options?: {
    serverOnly?: boolean;
    createServer?: () => { generate: DmoCommentaryVoice['generate'] }
      | Promise<{ generate: DmoCommentaryVoice['generate'] }>;
    createLocal?: (options: { onProgress?: (progress: unknown) => void }) =>
      Promise<{ generate: DmoCommentaryVoice['generate'] }>;
  },
): Promise<DmoCommentaryVoice>;

export function resetDmoLocalVoiceModel(): void;

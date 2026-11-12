export const DMO_SPEECH_VOICES: readonly ['af_heart', 'am_michael'];
export const DMO_SPEECH_MAX_TEXT_LENGTH: number;
export const DMO_SPEECH_DEFAULT_SPEED: number;

export type DmoSpeechRequest = {
  text: string;
  voice: 'af_heart' | 'am_michael';
  speed: number;
};

export function cleanDmoSpeechText(text: unknown): string;
export function normalizeDmoSpeechRequest(input?: {
  text?: unknown;
  voice?: unknown;
  speed?: unknown;
}): DmoSpeechRequest | null;
export function buildDmoSpeechUrl(input: {
  text: string;
  voice: 'af_heart' | 'am_michael';
  speed?: number;
}): string | null;
export function decodeDmoWav(arrayBuffer: ArrayBuffer): {
  audio: Float32Array;
  sampling_rate: number;
};
export function createDmoServerVoiceModel(options?: {
  fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}): {
  dmoVoiceSource: 'server';
  generate(
    text: string,
    options?: { voice?: 'af_heart' | 'am_michael'; speed?: number },
  ): Promise<{ audio: Float32Array; sampling_rate: number }>;
};

import type { DmoCommentaryVoice } from './dmoLocalVoice.mjs';

type DecodedAudio = { getChannelData(channel: number): Float32Array; sampleRate: number };
type LiveClipVoiceOptions = {
  broadcastId: string;
  decode: (bytes: ArrayBuffer) => Promise<DecodedAudio>;
  fetchImpl?: typeof fetch;
};

export function createDmoLiveClipVoice(options: LiveClipVoiceOptions): {
  dmoVoiceSource: 'server';
  generate: DmoCommentaryVoice['generate'];
};
export function loadDmoLiveClipVoice(options: LiveClipVoiceOptions): Promise<DmoCommentaryVoice>;

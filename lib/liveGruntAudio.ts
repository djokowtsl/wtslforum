export const ATP_GRUNT_AUDIO_URL = '/audio/te4-player-grunt.mp3';
export const WTA_GRUNT_AUDIO_URL = '/audio/te4-player-grunt-wta.mp3';

export function liveGruntAudioUrl(isWta: boolean) {
  return isWta ? WTA_GRUNT_AUDIO_URL : ATP_GRUNT_AUDIO_URL;
}

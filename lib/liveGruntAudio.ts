export const ATP_GRUNT_AUDIO_URL = '/audio/te4-player-grunt.mp3';
export const WTA_GRUNT_AUDIO_URL = '/audio/te4-player-grunt-wta.mp3';

const ATP_XKT_GRUNT_AUDIO_URLS = [
  '/audio/xkt/grunts/atp-01.mp3',
  '/audio/xkt/grunts/atp-02.mp3',
  '/audio/xkt/grunts/atp-03.mp3',
  '/audio/xkt/grunts/atp-04.mp3',
  '/audio/xkt/grunts/atp-05.mp3',
] as const;
const WTA_XKT_GRUNT_AUDIO_URLS = [
  '/audio/xkt/grunts/wta-01.mp3',
  '/audio/xkt/grunts/wta-02.mp3',
  '/audio/xkt/grunts/wta-03.mp3',
] as const;

export function liveGruntAudioUrl(isWta: boolean) {
  return isWta ? WTA_GRUNT_AUDIO_URL : ATP_GRUNT_AUDIO_URL;
}

export function liveGruntAudioUrls(isWta: boolean) {
  return isWta ? WTA_XKT_GRUNT_AUDIO_URLS : ATP_XKT_GRUNT_AUDIO_URLS;
}

export async function loadLiveGruntSamples(
  context: BaseAudioContext,
  isWta: boolean,
  fetcher: (url: string) => Promise<Response> = url => fetch(url),
): Promise<AudioBuffer[]> {
  const responses = await Promise.all(liveGruntAudioUrls(isWta).map(async url => {
    try {
      const response = await fetcher(url);
      if (!response.ok) return null;
      return await context.decodeAudioData(await response.arrayBuffer());
    } catch {
      return null;
    }
  }));
  const samples = responses.filter((sample): sample is AudioBuffer => sample !== null);
  if (samples.length) return samples;

  const fallback = await fetcher(liveGruntAudioUrl(isWta));
  if (!fallback.ok) throw new Error('Player grunt samples are unavailable.');
  return [await context.decodeAudioData(await fallback.arrayBuffer())];
}

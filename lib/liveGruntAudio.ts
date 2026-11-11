import {
  getDmoCharacterGruntSetting,
  getDmoGruntGroupUrls,
  type DmoCharacterGruntSetting,
} from './dmoCharacterAppearance.mjs';

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

async function loadAudioUrls(
  context: BaseAudioContext,
  urls: readonly string[],
  fetcher: (url: string) => Promise<Response>,
) {
  const responses = await Promise.all(urls.map(async (url) => {
    try {
      const response = await fetcher(url);
      if (!response.ok) return null;
      return await context.decodeAudioData(await response.arrayBuffer());
    } catch {
      return null;
    }
  }));
  return responses.filter((sample): sample is AudioBuffer => sample !== null);
}

export async function loadLiveCharacterGruntSamples(
  context: BaseAudioContext,
  isWta: boolean,
  characters: readonly [string | null | undefined, string | null | undefined],
  assignedSettings?: readonly [DmoCharacterGruntSetting | null, DmoCharacterGruntSetting | null],
  fetcher: (url: string) => Promise<Response> = url => fetch(url),
): Promise<[AudioBuffer[], AudioBuffer[]]> {
  const settings = characters.map((character, index) => (
    assignedSettings?.[index] ?? getDmoCharacterGruntSetting(character)
  )) as [DmoCharacterGruntSetting, DmoCharacterGruntSetting];
  const fallback = settings.some((setting) => setting.useGenericFallback)
    ? await loadLiveGruntSamples(context, isWta, fetcher)
    : [];
  const playerSamples = await Promise.all(settings.map(async (setting) => {
    const urls = setting.groupId ? getDmoGruntGroupUrls(setting.groupId) : [];
    if (!urls.length) return setting.useGenericFallback ? fallback : [];
    const samples = await loadAudioUrls(context, urls, fetcher);
    return samples.length ? samples : (setting.useGenericFallback ? fallback : []);
  }));
  return [playerSamples[0], playerSamples[1]];
}

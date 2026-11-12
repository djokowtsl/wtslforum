import characterData from '../public/dmo-character-appearance.json' with { type: 'json' };

function normalizeCharacterName(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('en-GB')
    .replace(/\b(?:atp|wta|v\d+)\b/gu, ' ')
    .match(/[\p{L}\p{N}]+/gu)
    ?.join(' ') ?? '';
}

const profilesByKey = new Map(
  characterData.profiles.map((profile) => [profile.key, profile]),
);

const complexionColorsByKey = new Map([
  ['naomi osaka', 0x805440],
  ['daniil medvedev', 0xd8ad92],
  ['sumit nagal', 0xa87658],
]);

export function dmoCharacterNameKey(value) {
  return normalizeCharacterName(value);
}

export function getDmoCharacterAppearance(name) {
  const key = normalizeCharacterName(name);
  const profile = key ? profilesByKey.get(key) : null;
  return profile
    ? { ...profile, complexionColor: complexionColorsByKey.get(key) ?? null }
    : null;
}

export function getDmoCharacterComplexionColor(name) {
  const key = normalizeCharacterName(name);
  return key ? complexionColorsByKey.get(key) ?? null : null;
}

export function getDmoCharacterGruntUrls(name) {
  const profile = getDmoCharacterAppearance(name);
  if (!profile?.gruntGroup) return [];
  return getDmoGruntGroupUrls(profile.gruntGroup);
}

export function getDmoGruntGroupUrls(groupId) {
  if (typeof groupId !== 'string' || !groupId) return [];
  return characterData.grunts[groupId] ?? [];
}

export function getDmoCharacterGruntSetting(name) {
  const profile = getDmoCharacterAppearance(name);
  const groupId = profile?.gruntGroup ?? null;
  return { groupId, useGenericFallback: !groupId };
}

export function getDmoCharacterGruntGroups() {
  return Object.keys(characterData.grunts).sort().map((id) => {
    const [gender, ...tail] = id.split('-');
    const words = tail.join(' ').replace(/^(\d+)\s+/, '$1 · ');
    return {
      id,
      label: `${gender === 'female' ? 'Female' : 'Male'} · ${words.replace(/\b[a-z]/g, (letter) => letter.toUpperCase())}`,
    };
  });
}

export function isDmoCharacterGruntGroup(groupId) {
  return typeof groupId === 'string'
    && Object.prototype.hasOwnProperty.call(characterData.grunts, groupId);
}

export function getDmoCharacterProfiles() {
  return characterData.profiles;
}

export function dmoCharacterBodyScale(heightCm, weightKg, isWta = false) {
  if (!Number.isFinite(heightCm) || !Number.isFinite(weightKg)
    || heightCm <= 0 || weightKg <= 0) {
    return { width: 1, height: 1 };
  }
  const referenceHeight = isWta ? 168 : 183;
  const referenceWeight = isWta ? 60 : 80;
  const height = Math.max(0.88, Math.min(1.12, heightCm / referenceHeight));
  const bmi = weightKg / ((heightCm / 100) ** 2);
  const referenceBmi = referenceWeight / ((referenceHeight / 100) ** 2);
  const width = Math.max(0.9, Math.min(1.1, Math.sqrt(bmi / referenceBmi)));
  return { width, height };
}

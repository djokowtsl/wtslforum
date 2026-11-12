export type DmoCharacterProfile = {
  name: string;
  key: string;
  gender: 'male' | 'female';
  heightCm: number | null;
  weightKg: number | null;
  gruntGroup: string | null;
  complexionColor?: number | null;
};
export type DmoCharacterGruntSetting = { groupId: string | null; useGenericFallback: boolean };
export type DmoCharacterGruntGroup = { id: string; label: string };

export function dmoCharacterNameKey(value: string | null | undefined): string;
export function getDmoCharacterAppearance(name: string | null | undefined): DmoCharacterProfile | null;
export function getDmoCharacterComplexionColor(name: string | null | undefined): number | null;
export function getDmoCharacterGruntUrls(name: string | null | undefined): string[];
export function getDmoGruntGroupUrls(groupId: string | null | undefined): string[];
export function getDmoCharacterGruntSetting(name: string | null | undefined): DmoCharacterGruntSetting;
export function getDmoCharacterGruntGroups(): DmoCharacterGruntGroup[];
export function isDmoCharacterGruntGroup(groupId: string | null | undefined): boolean;
export function getDmoCharacterProfiles(): DmoCharacterProfile[];
export function dmoCharacterBodyScale(
  heightCm: number | null | undefined,
  weightKg: number | null | undefined,
  isWta?: boolean,
): { width: number; height: number };

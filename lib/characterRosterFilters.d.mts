export type CharacterFilterField =
  | 'acceleration'
  | 'style'
  | 'playing_hand'
  | 'forehand_type'
  | 'backhand_type'
  | 'country';

export type CharacterFilterMetadata = {
  character: string;
  country?: string | null;
  style?: string | null;
  acceleration?: string | null;
  playing_hand?: string | null;
  forehand_type?: string | null;
  backhand_type?: string | null;
};

export type CharacterRosterFilters = Record<CharacterFilterField, string>;

export function characterFilterOptions(
  metadata: CharacterFilterMetadata[],
  field: CharacterFilterField,
): string[];

export function filterCharacterNames(
  names: string[],
  metadata: CharacterFilterMetadata[],
  filters: CharacterRosterFilters,
): string[];

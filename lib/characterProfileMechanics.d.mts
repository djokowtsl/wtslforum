type Dimension = number | string | null | undefined;
type CharacterStrokeSetup = {
  forehand_type?: string | null;
  backhand_type?: string | null;
};

export function buildStrokeSetupLabels(profile?: CharacterStrokeSetup): string[];

export function buildSizeMechanicsInsight(height: Dimension): string;

export function buildStrokeMechanicsInsight(profile?: CharacterStrokeSetup & Record<string, unknown>): string;

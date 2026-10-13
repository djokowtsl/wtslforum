type Dimension = number | string | null | undefined;

export function buildSizeMechanicsInsight(height: Dimension, weight: Dimension): string;

export function buildStrokeMechanicsInsight(profile?: {
  playing_hand?: string | null;
  forehand_type?: string | null;
  backhand_type?: string | null;
}): string;

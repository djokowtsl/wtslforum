export type DmoCommentaryTrackState = 'starting' | 'on' | 'unavailable';

export function createDmoCommentaryTrackPlayer<Audio>(options: {
  cues: ReadonlyArray<{ at: number | null; clip: string; group: number; mustPlay?: boolean }>;
  fps?: number;
  loadClip: (clip: string) => Promise<Audio>;
  playClip: (audio: Audio) => Promise<void>;
  onState?: (state: DmoCommentaryTrackState) => void;
  lookAhead?: number;
  now?: () => number;
}): {
  start(frame: number, playing?: boolean): void;
  update(frame: number, playing: boolean): void;
  stop(): void;
  readonly state: DmoCommentaryTrackState | '';
};

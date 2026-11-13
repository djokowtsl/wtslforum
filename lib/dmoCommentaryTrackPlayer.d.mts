export type DmoCommentaryTrackState = 'starting' | 'on' | 'unavailable';

export function createDmoCommentaryTrackPlayer<Audio>(options: {
  cues: ReadonlyArray<{ at: number | null; clip: string; group: number; mustPlay?: boolean; kind?: string }>;
  fps?: number;
  loadClip: (clip: string) => Promise<Audio>;
  playClip: (audio: Audio) => Promise<void>;
  onState?: (state: DmoCommentaryTrackState) => void;
  /** Called on start and after a seek, with the new replay frame. */
  onPosition?: (frame: number) => void;
  lookAhead?: number;
  now?: () => number;
  wait?: (ms: number) => Promise<unknown>;
}): {
  start(frame: number, playing?: boolean): void;
  update(frame: number, playing: boolean): void;
  stop(): void;
  readonly state: DmoCommentaryTrackState | '';
};

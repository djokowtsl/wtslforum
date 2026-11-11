export interface BundledRigSchema {
  format: 'WTM1';
  rigHash: string;
  modelHash: string;
  bones: string[];
  pelvisIndex: number;
  fixedPose: Array<{
    p: { x: number; y: number; z: number };
    q: { x: number; y: number; z: number; w: number };
  }>;
}
export interface BundledMotionClip {
  boneCount: number;
  pelvisIndex: number;
  frameCount: number;
  sampleRate: number;
  duration: number;
  rigHash: string;
  positions: Float32Array;
  rotations: Float32Array;
}
export function bundledAnimationEvents(
  info: string,
  kind: 'strike' | 'serve',
  duration: number,
): { kind: 'strike' | 'serve'; contactTime: number; maxExtensionTime: number; tossTime?: number };
export function bundledAnimationEvents(
  info: string,
  kind: 'serve-waiting',
  duration: number,
): { kind: 'serve-waiting'; readyTime: number; loopStart: number; loopEnd: number; bounceThrowTime: number };
export function decodeBundledMotion(buffer: ArrayBuffer, schema: BundledRigSchema): BundledMotionClip;
export function bundledMotionFrame(
  clip: BundledMotionClip,
  seconds: number,
): { first: number; second: number; blend: number };

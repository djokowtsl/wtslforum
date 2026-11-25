// Types for the vendored TE4 Online Circuit input analyzer (analyze-dmo.cjs).
// The script is kept byte-for-byte as shared with the admin group; these
// declarations only describe the parts the Forum calls.
/* eslint-disable @typescript-eslint/no-explicit-any */
export type AnalyzerDemo = {
  Header: { Build: number; SubBuild: number; Version: number; Names: string[]; LagFrames: number; [key: string]: any };
  Frames: any[];
  Scores: any[];
  [key: string]: any;
};
export type AnalyzerTiming = { StepMs: number; RecordedStepMs: number; OriginMs: number; MaxErrorMs: number; NominalFps: number; Override: boolean };
export type AnalyzerAnalysis = { FinalScore: string; Points: any[]; Episodes: any[]; Candidates: any[]; Summary: any[]; Recorded: any; VirtualAim: any; Impact?: any; [key: string]: any };
export function ReadDemo(buffer: Buffer): AnalyzerDemo;
export function CalibrateTime(demo: AnalyzerDemo, fps?: number | null): AnalyzerTiming;
export function BuildPoints(demo: AnalyzerDemo): any;
export function Analyze(demo: AnalyzerDemo, timing: AnalyzerTiming, minSeconds?: number): AnalyzerAnalysis;
export function WriteReport(
  filename: string,
  source: string,
  buffer: Buffer,
  demo: AnalyzerDemo,
  timing: AnalyzerTiming,
  analysis: AnalyzerAnalysis,
  checks: string[],
): { Sha256: string; [key: string]: any };

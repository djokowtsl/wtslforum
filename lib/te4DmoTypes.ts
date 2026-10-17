export type Te4Player = 1 | 2;
export type Te4SetScore = [number, number];

export type Te4Highlight = {
  point: number;
  rewatch: string;
  frame: number;
  set: number;
  games: string;
  winner: Te4Player;
  wp: number;
  importance: number;
  excitement: number;
  score: number;
  reasons: string;
  rally: number;
};

export type Te4ViewerShot = {
  p: Te4Player;
  t: number;
  k: 's' | 'r';
  v: number;
  z: number;
  d: number;
  bx: number | null;
  by: number | null;
  bt: number | null;
};

export type Te4ViewerPoint = {
  k: number;
  mf: number;
  fc: number;
  ss: Te4SetScore[];
  sc: number;
  rs: string;
  wp: number;
  rt: string;
  set: number;
  g: string;
  pt: string;
  tb: 0 | 1;
  s: Te4Player;
  w: Te4Player;
  f: number;
  n: number;
  sh: Te4ViewerShot[];
};

export type Te4ViewerMatch = {
  d: string;
  n: number;
  fps: number;
};

export type Te4ViewerData = {
  names: [string, string];
  score: string;
  sets: Te4SetScore[];
  final: {
    ss: Te4SetScore[];
    wp: number;
  };
  match: Te4ViewerMatch;
  pts: Te4ViewerPoint[];
};

export type Te4AnalysisResult = {
  filename: string;
  names: [string, string];
  score: string;
  sets: Te4SetScore[];
  pointsAnalyzed: number;
  durationSeconds: number;
  meta: {
    setsToWin: number;
    eloMatchProbability: number | null;
    serveShift: number | null;
    startProbability: number;
    finalWinner: Te4Player;
    serveWinRates: { 1: number; 2: number };
    frameCount: number;
  };
  highlights: Te4Highlight[];
  viewer: Te4ViewerData;
  warnings: string[];
};

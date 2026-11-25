// Match integrity screening: turns the Online Circuit input analyzer's
// measurements into a short per-match summary and the analyzer's own grade.
//
// The levels follow the analyzer's own grades exactly. Each flagged passage
// outside serves gets a strength from the tool (its Level() in the report):
//   3 = "Converging indicators", 2 = "Intermediate", 1 = "Weak / exploratory".
// A player's level is their strongest flagged passage; the match takes the
// player with the stronger grade. Nothing else (gap rates, plateaus, the opponent)
// raises or lowers a level: those numbers are shown for review only.
// Labels use the analyzer's own grade names; no level says "suspicious".
// For each flagged passage we also report whether the replay's recorded aim
// confirms it (the analyzer's recorded plateau check). That's shown for review
// and does not change the grade.
// A grade is a lead to review in the replay, not proof of cheating.

// Bump this when the analyzer scripts or the grading below change: every match
// with an older version is rescanned.
export const DMO_INTEGRITY_ANALYZER_VERSION = 'oc-1cc71d4a.c25bd7f1/tool-grades-3';

export const DMO_INTEGRITY_LEVELS = /** @type {const} */ ({
  high: { label: 'Converging indicators', toolGrade: 'Converging indicators', rank: 3 },
  medium: { label: 'Intermediate', toolGrade: 'Intermediate', rank: 2 },
  weak: { label: 'Weak / exploratory', toolGrade: 'Weak / exploratory', rank: 1 },
  none: { label: 'No flags', toolGrade: 'No flags outside serves', rank: 0 },
});

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function round(value, digits = 3) {
  const scale = 10 ** digits;
  return Math.round(finite(value) * scale) / scale;
}

function median(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

/**
 * Condense one analyzer run into what the admin panel stores and shows.
 * Input is the analyzer's own objects: ReadDemo, CalibrateTime, Analyze and
 * (optionally) AnalyzeImpact results.
 */
export function summarizeAnalyzerRun({ demo, timing, analysis, impact }) {
  const header = demo?.Header ?? {};
  const names = Array.isArray(header.Names) ? header.Names.map((name) => String(name ?? '')) : ['', ''];
  const recorded = analysis?.Recorded ?? {};
  const stepSeconds = finite(timing?.StepMs) / 1000;
  const originSeconds = finite(timing?.OriginMs) / 1000;

  const players = [0, 1].map((player) => {
    const summary = (analysis?.Summary ?? []).find((row) => row.Player === player) ?? {};
    const own = (recorded.Summary ?? []).find((row) => row.Player === player) ?? {};
    const longPreparations = finite(own.LongEpisodes);
    const repeatedGapPreparations = finite(own.LongWithRepeatedGaps);
    const flaggedWindows = finite(summary.Candidates);
    const strongWindows = finite(summary.Medium);
    const convergingWindows = finite(summary.High);
    const fireSeconds = finite(summary.FireSeconds);
    const impactRows = Array.isArray(impact?.Rows) ? impact.Rows.filter((row) => row.Player === player) : [];
    const impactMedian = median(impactRows.map((row) => Math.abs(finite(row.MeasuredCm))));
    const ownPassages = (analysis?.Candidates ?? []).filter((candidate) => candidate.Player === player && candidate.Context !== 'service');
    const checked = ownPassages.filter((candidate) => candidate.Recorded);
    const strongPassages = ownPassages.filter((candidate) => finite(candidate.Strength) >= 2);
    return {
      name: names[player] || `Player ${player + 1}`,
      longPreparations,
      shortGapPreparations: finite(own.LongWithShortGaps),
      repeatedGapPreparations,
      repeatedGapShare: longPreparations ? round(repeatedGapPreparations / longPreparations, 4) : 0,
      flaggedWindows,
      weakWindows: Math.max(0, flaggedWindows - strongWindows),
      intermediateWindows: Math.max(0, strongWindows - convergingWindows),
      convergingWindows,
      recordedPlateaus: finite(own.RecordedPlateaus),
      // Flagged passages the recorded aim could be checked on, and how many it
      // confirmed (aim held in a 60 cm band: the analyzer's plateau test).
      recordedCheckedPassages: checked.length,
      recordedConfirmedPassages: checked.filter((candidate) => candidate.Recorded.Plateau).length,
      strongPassagesChecked: strongPassages.filter((candidate) => candidate.Recorded).length,
      strongPassagesConfirmed: strongPassages.filter((candidate) => candidate.Recorded?.Plateau).length,
      aimGaps: Array.isArray(own.Aim?.Gaps) ? own.Aim.Gaps.length : finite(own.Aim?.Gaps),
      moveGaps: Array.isArray(own.Move?.Gaps) ? own.Move.Gaps.length : finite(own.Move?.Gaps),
      changesPer100s: fireSeconds ? round((finite(summary.ToggleCount) / fireSeconds) * 100, 1) : 0,
      impactShots: impactRows.length,
      impactMedianCm: impactMedian === null ? null : round(impactMedian, 1),
    };
  });

  const points = Array.isArray(analysis?.Points) ? analysis.Points : [];
  // The analyzer already sorts passages strongest first.
  const passageList = (analysis?.Candidates ?? [])
    .filter((candidate) => candidate.Context !== 'service')
    .map((candidate) => {
      const point = points.find((row) => row.Number === candidate.Point);
      return {
        player: candidate.Player,
        point: candidate.Point,
        score: String(candidate.Score ?? ''),
        matchTimeSeconds: round(originSeconds + finite(candidate.Start) * stepSeconds, 2),
        intoPointSeconds: point ? round((finite(candidate.Start) - finite(point.Start)) * stepSeconds, 2) : null,
        durationSeconds: round(candidate.Duration, 3),
        strength: finite(candidate.Strength),
        methods: Array.isArray(candidate.Methods) ? candidate.Methods.map(String) : [],
        // null when the replay has no recorded aim for the whole passage.
        recordedAim: candidate.Recorded
          ? {
            minCm: round(candidate.Recorded.Min, 1),
            maxCm: round(candidate.Recorded.Max, 1),
            medianCm: round(candidate.Recorded.Median, 1),
            plateau: candidate.Recorded.Plateau === true,
          }
          : null,
      };
    });

  return {
    version: DMO_INTEGRITY_ANALYZER_VERSION,
    match: {
      names,
      finalScore: String(analysis?.FinalScore ?? ''),
      points: Array.isArray(demo?.Scores) ? demo.Scores.length : 0,
      frames: Array.isArray(demo?.Frames) ? demo.Frames.length : 0,
      durationSeconds: round((Array.isArray(demo?.Frames) ? demo.Frames.length : 0) * stepSeconds, 1),
      build: `${finite(header.Build)}.${finite(header.SubBuild)}`,
      format: finite(header.Version),
      lagFrames: finite(header.LagFrames),
      fps: finite(timing?.NominalFps),
      recordedCoverage: round(recorded.Coverage, 4),
      impactAvailable: Boolean(impact && !impact.Unavailable && Array.isArray(impact.Rows)),
    },
    players,
    passages: passageList,
  };
}

function passages(count) {
  return `${count} passage${count === 1 ? '' : 's'}`;
}

/** Level for one player: the analyzer's grade of their strongest passage. */
export function assessPlayer(own) {
  const converging = finite(own?.convergingWindows);
  const intermediate = finite(own?.intermediateWindows);
  const weak = finite(own?.weakWindows);
  const level = converging > 0 ? 'high' : intermediate > 0 ? 'medium' : weak > 0 ? 'weak' : 'none';
  const reasons = [];
  if (converging) reasons.push(`${passages(converging)} graded "Converging indicators" by the analyzer`);
  if (intermediate) reasons.push(`${passages(intermediate)} graded "Intermediate"`);
  if (weak) reasons.push(`${passages(weak)} graded "Weak / exploratory"`);
  // Sort key within a level: how many passages reached that grade.
  const score = level === 'high' ? converging : level === 'medium' ? intermediate : level === 'weak' ? weak : 0;
  return { level, score, reasons };
}

/** Match-level assessment: the player with the stronger grade decides. */
export function assessDmoIntegrity(summary) {
  const players = Array.isArray(summary?.players) ? summary.players : [];
  if (players.length !== 2) {
    return { level: 'none', score: 0, flaggedPlayers: [], players: [] };
  }
  const assessed = players.map((own, index) => ({
    player: index,
    name: own.name,
    ...assessPlayer(own),
  }));
  const top = assessed.reduce((best, row) => (
    DMO_INTEGRITY_LEVELS[row.level].rank > DMO_INTEGRITY_LEVELS[best.level].rank
    || (row.level === best.level && row.score > best.score)
      ? row
      : best
  ));
  return {
    level: top.level,
    score: top.score,
    flaggedPlayers: assessed.filter((row) => row.level !== 'none').map((row) => row.player),
    players: assessed,
  };
}

/** Sort scans: strongest grade first, then score, then newest. */
export function compareIntegrityScans(a, b) {
  const rank = (scan) => (scan.status === 'done' ? DMO_INTEGRITY_LEVELS[scan.level]?.rank ?? -1 : -2);
  return rank(b) - rank(a)
    || finite(b.score) - finite(a.score)
    || String(b.submissionDate ?? '').localeCompare(String(a.submissionDate ?? ''));
}

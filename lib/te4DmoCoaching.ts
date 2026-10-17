import type { Te4AnalysisResult, Te4ViewerPoint } from './te4DmoTypes';

export type Te4CoachingTone = 'strength' | 'focus' | 'watch';

export type Te4CoachingInsight = {
  tone: Te4CoachingTone;
  title: string;
  evidence: string;
  cue: string;
};

export type Te4CoachingSummary = {
  playerName: string;
  matchesAnalyzed: number;
  matchesWithPlayer: number;
  matchWins: number;
  stats: {
    servicePoints: number;
    servicePointsWon: number;
    firstServePoints: number;
    firstServePointsWon: number;
    secondServePoints: number;
    secondServePointsWon: number;
    returnPoints: number;
    returnPointsWon: number;
    longRallyPoints: number;
    longRallyPointsWon: number;
    rallyWinners: number;
    rallyErrors: number;
  };
  insights: Te4CoachingInsight[];
};

function playerKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function isPlaceholderName(name: string): boolean {
  return /^player\s+[12]$/i.test(name.trim());
}

export function listTe4CoachingPlayers(results: Te4AnalysisResult[]): string[] {
  const names = new Map<string, string>();
  for (const result of results) {
    for (const name of result.names) {
      if (!isPlaceholderName(name)) {
        const key = playerKey(name);
        if (key && !names.has(key)) names.set(key, name.trim());
      }
    }
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b));
}

export function defaultTe4CoachingPlayer(results: Te4AnalysisResult[]): string | null {
  const names = listTe4CoachingPlayers(results);
  const shared = names.find((name) => results.length > 0 && results.every(
    (result) => result.names.some((candidate) => playerKey(candidate) === playerKey(name)),
  ));
  return shared ?? names[0] ?? null;
}

function buildInsight(
  tone: Te4CoachingTone,
  title: string,
  evidence: string,
  cue: string,
): Te4CoachingInsight {
  return { tone, title, evidence, cue };
}

function percent(won: number, total: number): number {
  return total ? Math.round((won / total) * 100) : 0;
}

export function buildTe4CoachingSummary(
  results: Te4AnalysisResult[],
  selectedPlayer: string,
): Te4CoachingSummary {
  const selectedKey = playerKey(selectedPlayer);
  const stats: Te4CoachingSummary['stats'] = {
    servicePoints: 0,
    servicePointsWon: 0,
    firstServePoints: 0,
    firstServePointsWon: 0,
    secondServePoints: 0,
    secondServePointsWon: 0,
    returnPoints: 0,
    returnPointsWon: 0,
    longRallyPoints: 0,
    longRallyPointsWon: 0,
    rallyWinners: 0,
    rallyErrors: 0,
  };
  let matchesWithPlayer = 0;
  let matchWins = 0;

  if (selectedKey) {
    for (const result of results) {
      const sideIndex = result.names.findIndex((name) => playerKey(name) === selectedKey);
      if (sideIndex < 0) continue;
      const side = sideIndex + 1;
      matchesWithPlayer += 1;
      if (result.meta.finalWinner === side) matchWins += 1;

      for (const point of result.viewer.pts) {
        const won = point.w === side;
        if (point.s === side) {
          stats.servicePoints += 1;
          stats.servicePointsWon += Number(won);
          if (point.f === 0) {
            stats.firstServePoints += 1;
            stats.firstServePointsWon += Number(won);
          } else {
            stats.secondServePoints += 1;
            stats.secondServePointsWon += Number(won);
          }
        } else {
          stats.returnPoints += 1;
          stats.returnPointsWon += Number(won);
        }

        // `n` counts rally hits; include the serve when classifying rally length.
        if (point.n + 1 >= 9) {
          stats.longRallyPoints += 1;
          stats.longRallyPointsWon += Number(won);
        }

        if (point.n > 0) {
          const lastShot = point.sh.at(-1);
          if (lastShot?.p === side) {
            if (won) stats.rallyWinners += 1;
            else stats.rallyErrors += 1;
          }
        }
      }
    }
  }

  const insights: Te4CoachingInsight[] = [];
  if (stats.servicePoints >= 8) {
    const rate = percent(stats.servicePointsWon, stats.servicePoints);
    const tone = rate >= 68 ? 'strength' : rate < 58 ? 'focus' : 'watch';
    const cue = tone === 'strength'
      ? 'Keep using a reliable serve-plus-one pattern to start the rally on your terms.'
      : tone === 'focus'
        ? 'Practise a dependable serve followed by a controlled first groundstroke.'
        : 'Look for repeatable serve-and-first-shot patterns that protect this base.';
    insights.push(buildInsight(
      tone,
      'Serve points',
      `Won ${stats.servicePointsWon} of ${stats.servicePoints} service points (${rate}%).`,
      cue,
    ));
  }

  if (stats.returnPoints >= 8) {
    const rate = percent(stats.returnPointsWon, stats.returnPoints);
    const tone = rate >= 45 ? 'strength' : rate < 34 ? 'focus' : 'watch';
    const cue = tone === 'strength'
      ? 'Keep taking away time on the return and look for chances to start neutral rallies.'
      : tone === 'focus'
        ? 'Prioritise getting more returns into play and starting the point on balanced terms.'
        : 'A little more depth and consistency on early returns could improve this area.';
    insights.push(buildInsight(
      tone,
      'Return points',
      `Won ${stats.returnPointsWon} of ${stats.returnPoints} return points (${rate}%).`,
      cue,
    ));
  }

  if (stats.longRallyPoints >= 8) {
    const rate = percent(stats.longRallyPointsWon, stats.longRallyPoints);
    const tone = rate >= 60 ? 'strength' : rate < 45 ? 'focus' : 'watch';
    const cue = tone === 'strength'
      ? 'Maintain this rally tolerance and recover early after each shot.'
      : tone === 'focus'
        ? 'Practise recovering between shots and staying patient through longer exchanges.'
        : 'Keep building consistency and court recovery in extended exchanges.';
    insights.push(buildInsight(
      tone,
      'Long rallies',
      `Won ${stats.longRallyPointsWon} of ${stats.longRallyPoints} rallies lasting 9 or more shots (${rate}%).`,
      cue,
    ));
  }

  const outcomeCount = stats.rallyWinners + stats.rallyErrors;
  if (outcomeCount >= 10) {
    const tone = stats.rallyErrors > stats.rallyWinners * 1.25
      ? 'focus'
      : stats.rallyWinners > stats.rallyErrors
        ? 'strength'
        : 'watch';
    const cue = tone === 'focus'
      ? 'Review error-ending points and favour a larger margin before going for a winner.'
      : tone === 'strength'
        ? 'Keep choosing clear opportunities to finish rallies while protecting your margin.'
        : 'Review a few rally endings to find where a safer option could help.';
    insights.push(buildInsight(
      tone,
      'Rally endings',
      `The reconstructed last shots show ${stats.rallyWinners} winners and ${stats.rallyErrors} errors.`,
      cue,
    ));
  }

  return {
    playerName: selectedPlayer,
    matchesAnalyzed: results.length,
    matchesWithPlayer,
    matchWins,
    stats,
    insights,
  };
}

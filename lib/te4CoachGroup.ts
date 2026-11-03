import { buildTe4CoachGroupMatchUrl } from '@/lib/te4CoachEmbed';

export type PublicCoachGroupReplay = {
  id: string;
  tournament: string;
  roundName: string;
  player1: string;
  player2: string;
  submissionDate: string;
  coachShareUrl?: string;
};

export type Te4CoachGroupEntry = {
  link: string;
  match: string;
  event: string;
  round: string;
  date: string;
};

export function buildTe4CoachGroupEntry(
  replay: PublicCoachGroupReplay,
): Te4CoachGroupEntry | null {
  if (!/^\d{1,19}$/.test(replay.id)) return null;
  const link = buildTe4CoachGroupMatchUrl(replay.coachShareUrl);
  if (!link) return null;
  const date = replay.submissionDate.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  return {
    link,
    match: `forum-dmo-${replay.id}`,
    event: replay.tournament.trim().slice(0, 100),
    round: replay.roundName.trim().slice(0, 60),
    date,
  };
}

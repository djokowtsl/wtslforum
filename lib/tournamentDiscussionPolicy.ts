export type TournamentDiscussion = {
  id: number;
  wtsl_tournament_key: string;
  name: string;
  location: string | null;
  country: string | null;
  category: string | null;
  surface: string | null;
  status: string;
  official_url: string;
  discussion_topic_id: number | null;
  discussion_enabled: boolean;
};

export function isTournamentDiscussionEnabled(tournament: Pick<TournamentDiscussion, 'discussion_enabled' | 'discussion_topic_id'>) {
  // Keep linked discussions working during an older deployment/migration overlap.
  return Boolean(tournament.discussion_enabled || tournament.discussion_topic_id);
}

export function tournamentDiscussionContent(tournament: Pick<TournamentDiscussion, 'name' | 'location' | 'country' | 'category' | 'surface' | 'status' | 'official_url'>) {
  return {
    title: `🏆 ${tournament.name} — Tournament Discussion`,
    body: `Community discussion for ${tournament.name}.\n\n${tournament.location}, ${tournament.country} · ${tournament.category} · ${tournament.surface}\n\n**Status:** ${tournament.status}\n\n[View the WTSL tournament page](${tournament.official_url})`,
    pinned: tournament.status === 'ongoing',
  };
}
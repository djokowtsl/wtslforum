import assert from 'node:assert/strict';
import test from 'node:test';
import { isTournamentDiscussionEnabled, tournamentDiscussionContent } from '../lib/tournamentDiscussionPolicy.ts';

test('discussion restore eligibility excludes unlinked historical backfills', () => {
  assert.equal(isTournamentDiscussionEnabled({ discussion_enabled: false, discussion_topic_id: null }), false);
});

test('discussion restore eligibility includes live rows and existing linked discussions', () => {
  assert.equal(isTournamentDiscussionEnabled({ discussion_enabled: true, discussion_topic_id: null }), true);
  assert.equal(isTournamentDiscussionEnabled({ discussion_enabled: false, discussion_topic_id: 42 }), true);
});

test('restored discussion content reflects the current tournament and ongoing status', () => {
  const content = tournamentDiscussionContent({
    name: 'Tokyo',
    location: 'Tokyo',
    country: 'Japan',
    category: 'WTSL 250',
    surface: 'Hard',
    status: 'ongoing',
    official_url: 'https://example.com/tokyo',
  });

  assert.match(content.title, /Tokyo — Tournament Discussion/);
  assert.match(content.body, /\*\*Status:\*\* ongoing/);
  assert.match(content.body, /https:\/\/example\.com\/tokyo/);
  assert.equal(content.pinned, true);
});
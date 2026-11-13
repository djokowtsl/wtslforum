import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COMMENTARY_RESTRICTION_END_UTC,
  FORUM_MAINTENANCE_END_UTC,
  FORUM_MAINTENANCE_START_UTC,
  isAllowedCommentaryMatch,
  isCommentaryRestrictionActive,
  isForumMaintenanceActive,
} from '../lib/dmoCommentaryMaintenance.mjs';

test('the landing page is active from 01:00 through 07:59 GMT only', () => {
  assert.equal(isForumMaintenanceActive(FORUM_MAINTENANCE_START_UTC - 1), false);
  assert.equal(isForumMaintenanceActive(FORUM_MAINTENANCE_START_UTC), true);
  assert.equal(isForumMaintenanceActive(FORUM_MAINTENANCE_END_UTC - 1), true);
  assert.equal(isForumMaintenanceActive(FORUM_MAINTENANCE_END_UTC), false);
});

test('commentary remains open independently of the Forum maintenance window', () => {
  assert.equal(isCommentaryRestrictionActive(FORUM_MAINTENANCE_START_UTC - 1), false);
  assert.equal(isCommentaryRestrictionActive(FORUM_MAINTENANCE_START_UTC), false);
  assert.equal(isCommentaryRestrictionActive(COMMENTARY_RESTRICTION_END_UTC - 1), false);
  assert.equal(isCommentaryRestrictionActive(COMMENTARY_RESTRICTION_END_UTC), false);
});

test('only the approved replay and verified pairing bypass commentary restriction', () => {
  const approved = {
    replayId: '23',
    names: ['gifuko', 'TheTinkerman_'],
    tournament: 'Roland Garros (WTA)',
  };
  assert.equal(isAllowedCommentaryMatch(approved), true);
  assert.equal(isAllowedCommentaryMatch({
    ...approved,
    names: ['TheTinkerman_', 'gifuko'],
  }), true);
  assert.equal(isAllowedCommentaryMatch({ ...approved, replayId: '24' }), false);
  assert.equal(isAllowedCommentaryMatch({ ...approved, tournament: 'Wimbledon (WTA)' }), false);
  assert.equal(isAllowedCommentaryMatch({ ...approved, names: ['gifuko', 'AnotherPlayer'] }), false);
});

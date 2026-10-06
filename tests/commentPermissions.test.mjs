import assert from 'node:assert/strict';
import test from 'node:test';
import { canModerateComments } from '../lib/commentPermissions.ts';

test('admins can delete comments without being in the moderator list', () => {
  assert.equal(canModerateComments({ discordId: 'admin-1', isAdmin: true }, ''), true);
});

test('account-assigned moderators can moderate without an environment ID', () => {
  assert.equal(canModerateComments({ discordId: 'mod-3', isAdmin: false, isModerator: true }, ''), true);
});

test('comma-separated moderator IDs are trimmed and grant deletion permission', () => {
  assert.equal(canModerateComments({ discordId: 'mod-2', isAdmin: false }, 'mod-1, mod-2 ,'), true);
});

test('members not in the moderator list cannot moderate comments', () => {
  assert.equal(canModerateComments({ discordId: 'member-1', isAdmin: false }, 'mod-1,mod-2'), false);
});

test('signed-out visitors cannot moderate comments', () => {
  assert.equal(canModerateComments(null, 'mod-1'), false);
  assert.equal(canModerateComments(undefined, 'mod-1'), false);
});

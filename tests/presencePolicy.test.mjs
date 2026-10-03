import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ONLINE_PRESENCE_WINDOW_MINUTES,
  resolveEffectiveUserStatus,
} from '../lib/presencePolicy.ts';

test('online presence expires unless the member has sent a recent heartbeat', () => {
  assert.equal(ONLINE_PRESENCE_WINDOW_MINUTES, 5);
  assert.equal(resolveEffectiveUserStatus('online', true), 'online');
  assert.equal(resolveEffectiveUserStatus('online', false), 'offline');
});

test('manual presence choices are preserved and invalid stored values fail closed', () => {
  assert.equal(resolveEffectiveUserStatus('away', false), 'away');
  assert.equal(resolveEffectiveUserStatus('busy', false), 'busy');
  assert.equal(resolveEffectiveUserStatus('offline', true), 'offline');
  assert.equal(resolveEffectiveUserStatus('unexpected', true), 'offline');
  assert.equal(resolveEffectiveUserStatus(null, false), 'offline');
});
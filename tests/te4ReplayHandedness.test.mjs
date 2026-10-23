import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const replayShell = await readFile(new URL('../public/te4-match-viewer-shell.html', import.meta.url), 'utf8');

test('full replay exposes an independent left/right selector for each named player', () => {
  assert.match(replayShell, /id="hand-controls" role="group" aria-label="Player handedness"/);
  assert.match(replayShell, /D\.names\.map\(\(name,index\)=>`<label>/);
  assert.match(replayShell, /option value="right">Right-handed/);
  assert.match(replayShell, /option value="left">Left-handed/);
  assert.match(replayShell, /hands\[id-1\]/);
});

test('hand selection changes avatar racket arm only and does not change court samples', () => {
  assert.ok(replayShell.includes("side=handedness==='left'?-1:1"));
  assert.ok(replayShell.includes('localStorage.setItem(handsKey,JSON.stringify(hands))'));
  assert.ok(replayShell.includes('person(q[0],q[1],c,n,swingFor(id),[ux,uy],id,hands[id-1])'));
  assert.ok(replayShell.includes('playerFocus={x:(g(i0,3)+g(i0,5))/2,y:(g(i0,4)+g(i0,6))/2}'));
});

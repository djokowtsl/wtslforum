import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const replayShell = await readFile(new URL('../public/te4-match-viewer-shell.html', import.meta.url), 'utf8');
const broadcaster = await readFile(new URL('../components/DmoLiveHost.tsx', import.meta.url), 'utf8');
const liveViewer = await readFile(new URL('../components/DmoLiveViewer.tsx', import.meta.url), 'utf8');
const liveCourt = await readFile(new URL('../components/DmoLiveCourt3D.tsx', import.meta.url), 'utf8');

test('broadcaster can set independent handedness for automatically detected players', () => {
  assert.match(broadcaster, /canonicalBroadcastPlayers\.current \?\? automaticPlayers\.current/);
  assert.match(broadcaster, /activeBroadcastPlayers\.map\(\(name, index\)/);
  assert.match(broadcaster, /handedness: playerHandsRef\.current/);
  assert.match(broadcaster, /shared with all viewers/);
});

test('live and full replay viewers use broadcaster settings and expose no hand controls', () => {
  assert.match(liveViewer, /handedness=\{broadcast\.snapshot\.handedness \?\? \['right', 'right'\]\}/);
  assert.match(liveCourt, /sceneDataRef\.current\.snapshot\.handedness\?\.\[0\] \?\? 'right'/);
  assert.match(liveCourt, /sceneDataRef\.current\.snapshot\.handedness\?\.\[1\] \?\? 'right'/);
  assert.equal(liveCourt.includes('Player handedness</summary>'), false);
  assert.equal(replayShell.includes('hand-controls'), false);
  assert.equal(replayShell.includes('localStorage'), false);
  assert.match(replayShell, /hands=__HANDEDNESS__/);
});

test('broadcaster hands reach the full replay and never alter court samples', () => {
  assert.ok(replayShell.includes("side=handedness==='left'?-1:1"));
  assert.ok(replayShell.includes("e.data?.type==='set-handedness'"));
  assert.ok(replayShell.includes('person(q[0],q[1],c,n,swingFor(id),[ux,uy],id,hands[id-1])'));
  assert.ok(replayShell.includes('playerFocus={x:(g(i0,3)+g(i0,5))/2,y:(g(i0,4)+g(i0,6))/2}'));
});

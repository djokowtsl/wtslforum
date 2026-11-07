import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const viewer = readFileSync(new URL('../components/DmoLiveViewer.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../app/live-broadcast.css', import.meta.url), 'utf8');

test('live broadcasts are selected in a horizontal carousel without vertical card jumps', () => {
  assert.match(viewer, /aria-label="Previous broadcast"/);
  assert.match(viewer, /aria-label="Next broadcast"/);
  assert.match(viewer, /Broadcast \{activeBroadcastIndex \+ 1\} of \{broadcasts\.length\}/);
  assert.match(viewer, /broadcastListRef/);
  assert.match(viewer, /list\.scrollTo\(\{ left: target\.offsetLeft, behavior \}\)/);
  assert.match(viewer, /onScroll=\{updateActiveBroadcastFromScroll\}/);
  assert.doesNotMatch(viewer, /target\.scrollIntoView/);
  assert.match(styles, /\.live-broadcast-list\s*\{[^}]*overflow-x:\s*auto/s);
  assert.match(styles, /\.live-broadcast-list\s*\{[^}]*scroll-snap-type:\s*x mandatory/s);
  assert.match(styles, /\.live-broadcast-card\s*\{[^}]*flex:\s*0 0 100%/s);
});

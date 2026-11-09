import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../components/DmoLiveCourt3D.tsx', import.meta.url), 'utf8');
const block = source.slice(source.indexOf('const SHORT_WALK_METRES'), source.indexOf('/** Furthest the hips'));
const javascript = block.replace(/: number/g, '');
const limitHeadingToNet = new Function('THREE', `${javascript}; return limitHeadingToNet;`)({
  MathUtils: {
    degToRad: degrees => degrees * Math.PI / 180,
    clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
  },
});
const degrees = radians => radians * 180 / Math.PI;

test('long walks face travel, including a straight walk back from the service line', () => {
  for (const net of [Math.PI / 2, -Math.PI / 2]) {
    for (const distance of [2, 3, 7.9]) {
      assert.ok(Math.abs(degrees(limitHeadingToNet(net + Math.PI, net, 3, distance) - net)) > 179);
      assert.ok(Math.abs(degrees(limitHeadingToNet(net + Math.PI / 2, net, 3, distance) - net) - 90) < 1e-9);
    }
  }
});

test('short steps turn at most 60 degrees and imminent serves at most 30', () => {
  for (const net of [Math.PI / 2, -Math.PI / 2]) {
    for (const direction of [-1, 1]) {
      const heading = net + direction * 170 * Math.PI / 180;
      assert.ok(Math.abs(degrees(limitHeadingToNet(heading, net, 2, 1.99) - net) - direction * 60) < 1e-9);
      for (const distance of [0.5, 2, 7.9]) {
        assert.ok(Math.abs(degrees(limitHeadingToNet(heading, net, 1.49, distance) - net) - direction * 30) < 1e-9);
      }
    }
  }
});

test('both generated repositioning and recorded walks use remaining distance', () => {
  assert.match(source, /Number\.POSITIVE_INFINITY, distance\)/);
  assert.match(source, /frame \+ frameRate \* 2/);
  assert.match(source, /Number\.POSITIVE_INFINITY, metresToGo\)/);
  assert.doesNotMatch(source, /NEAR_SERVE_MAX_TURN|SERVE_SOON_SECONDS/);
  assert.match(source, /recordedTouch \|\| liveCourtShotSpin/);
  assert.match(source, /recordedStrokeUsesTwoHands/);
});

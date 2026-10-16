import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  axisTicks,
  NORMALIZED_DOMAIN,
  tooltipPosition,
} from '../lib/characterMetricChartGeometry.mjs';

const chartComponent = readFileSync(
  new URL('../components/CharacterMetricCharts.tsx', import.meta.url),
  'utf8',
);

test('normalized character charts leave space around 0 and 100', () => {
  assert.deepEqual(NORMALIZED_DOMAIN, { min: -10, max: 110 });
  assert.deepEqual(
    axisTicks(NORMALIZED_DOMAIN, true),
    [-10, 0, 20, 40, 60, 80, 100, 110],
  );
});

test('raw and zoomed chart axes retain adaptive ticks', () => {
  assert.deepEqual(axisTicks({ min: 10, max: 50 }, false), [10, 20, 30, 40, 50]);
  assert.deepEqual(axisTicks({ min: 20, max: 80 }, true), [20, 35, 50, 65, 80]);
});

test('point tooltips stay inside the SVG viewport at every chart edge', () => {
  const viewport = { viewportWidth: 800, viewportHeight: 440 };
  const tooltip = { width: 300, height: 60 };
  const points = [
    { x: 78, y: 24 },
    { x: 776, y: 24 },
    { x: 78, y: 364 },
    { x: 776, y: 364 },
  ];

  for (const point of points) {
    const { left, top } = tooltipPosition({ ...point, ...tooltip, ...viewport });
    assert.ok(left >= 8);
    assert.ok(top >= 8);
    assert.ok(left + tooltip.width <= viewport.viewportWidth - 8);
    assert.ok(top + tooltip.height <= viewport.viewportHeight - 8);
  }
});

test('scatter and single-metric tooltips render outside their clipped plot groups', () => {
  const safeTooltipRender = /<\/g>\s*\{\s*activePoint && visiblePoints\.some[\s\S]*?<PointTooltip/;
  assert.equal((chartComponent.match(new RegExp(safeTooltipRender.source, 'g')) ?? []).length, 2);
});

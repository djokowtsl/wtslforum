import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  axisTicks,
  NORMALIZED_DOMAIN,
  radarCoordinates,
  radarProfileValues,
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

test('radar profile uses the selected character and normalizes each existing metric', () => {
  const characters = [
    { character: 'Ace', metrics: { Serve: 90, Forehand: 50, Backhand: 'unknown' } },
    { character: 'Baseline', metrics: { Serve: 70, Forehand: 50, Backhand: 60 } },
    { character: 'Counter', metrics: { Serve: 60, Forehand: 70, Backhand: 40 } },
  ];

  assert.deepEqual(
    radarProfileValues(characters, 'baseline', ['Serve', 'Forehand', 'Backhand', 'Missing']),
    [
      { name: 'Serve', value: 70, score: 33.33333333333333 },
      { name: 'Forehand', value: 50, score: 0 },
      { name: 'Backhand', value: 60, score: 100 },
    ],
  );
  assert.deepEqual(
    radarProfileValues(
      [{ character: 'Same', metrics: { Serve: 8 } }, { character: 'Same 2', metrics: { Serve: 8 } }],
      'Same',
      ['Serve'],
    ),
    [{ name: 'Serve', value: 8, score: 50 }],
  );
  assert.deepEqual(radarProfileValues(characters, 'not in roster', ['Serve']), []);
});

test('radar coordinates start at the top and handle an incomplete profile', () => {
  const points = radarCoordinates([100, 50, 0], 100, 100, 20);
  assert.equal(points.length, 3);
  assert.ok(Math.abs(points[0].x - 100) < 0.001);
  assert.ok(Math.abs(points[0].y - 80) < 0.001);
  assert.ok(Math.abs(points[2].x - 100) < 0.001);
  assert.ok(Math.abs(points[2].y - 100) < 0.001);
  assert.deepEqual(radarCoordinates([100, 50], 100, 100, 20), []);
});

test('the radar chart follows the selected character on the character page', () => {
  const explorer = readFileSync(
    new URL('../components/CharacterStatsExplorer.tsx', import.meta.url),
    'utf8',
  );
  const radar = readFileSync(
    new URL('../components/CharacterRadarChart.tsx', import.meta.url),
    'utf8',
  );

  assert.match(explorer, /selectedCharacter=\{character\}/);
  assert.match(radar, /radarProfileValues\(characters, selectedCharacter, metricNames\)/);
  assert.match(radar, /Values use the same measures as the roster charts/);
});

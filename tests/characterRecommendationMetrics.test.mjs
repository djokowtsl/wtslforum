import test from 'node:test';
import assert from 'node:assert/strict';
import { formatRecommendationMetricValue } from '../lib/characterRecommendationMetrics.mjs';

test('floors ratio percentages to whole dashboard percents', () => {
  assert.equal(formatRecommendationMetricValue('Return Points Won %', 0.39426800329354156), '39%');
  assert.equal(formatRecommendationMetricValue('1st Serve %', 0.6753817977418095), '67%');
  assert.equal(formatRecommendationMetricValue('First Serve %', 0.4), '40%');
});

test('preserves non-percentage recommendation values and handles missing data', () => {
  assert.equal(formatRecommendationMetricValue('Aces', 12), '12');
  assert.equal(formatRecommendationMetricValue('Return Points Won %', null), '');
  assert.equal(formatRecommendationMetricValue('Return Points Won %', Number.NaN), '');
});

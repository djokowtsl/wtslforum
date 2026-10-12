import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const component = readFileSync(
  new URL('../components/CharacterStatsExplorer.tsx', import.meta.url),
  'utf8',
);

test('character profiles render Core descriptions and game-plan guidance', () => {
  for (const marker of [
    'profile.style_description',
    '<p className="character-style-description">{styleDescription}</p>',
    'profile.selection_guidance',
    'character-selection-guidance',
    'profile.mechanics_insights',
    'className="panel character-guidance-panel"',
    'profile.technical_interactions',
  ]) {
    assert.ok(component.includes(marker), `character copy binding missing: ${marker}`);
  }
});

test('character comparisons retain mechanics and selection explanations', () => {
  for (const marker of [
    'comparison.first_mechanics',
    'comparison.first_guidance',
    'className="character-comparison-choices"',
  ]) {
    assert.ok(component.includes(marker), `comparison copy binding missing: ${marker}`);
  }
});

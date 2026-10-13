import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dashboard = readFileSync(
  new URL('../app/dashboard/page.tsx', import.meta.url),
  'utf8',
);
const suggestions = readFileSync(
  new URL('../components/CharacterSuggestions.tsx', import.meta.url),
  'utf8',
);
const coreClient = readFileSync(
  new URL('../lib/wtsl-core.ts', import.meta.url),
  'utf8',
);

test('verified TE4 dashboard cards request player-specific suggestions from Core', () => {
  assert.ok(dashboard.includes("c.tour === 'TE4' || c.tour === 'TE4_(F)'"));
  assert.ok(dashboard.includes("c.tour === 'TE4_(F)' ? 'wta' : 'atp'"));
  assert.ok(dashboard.includes('metrics: insights.metrics'));
  assert.ok(dashboard.includes('wtslCore.characterRecommendations'));
  assert.ok(dashboard.includes('<CharacterSuggestions'));
  assert.ok(coreClient.includes("'/api/core/character-recommendations'"));
});

test('suggestions show character fit, player evidence, mechanics, and trade-offs', () => {
  for (const marker of [
    'Character suggestions',
    'same character-fit scorer as Discord',
    'strength_group',
    'development_group',
    'mechanics_reason',
    'development_route',
    'edge_details',
    'Trade-off:',
    'fuller MatchLog data',
  ]) {
    assert.ok(suggestions.includes(marker), `suggestion detail missing: ${marker}`);
  }
});

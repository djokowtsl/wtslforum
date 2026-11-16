#!/usr/bin/env node
/**
 * Regenerates public/dmo-character-gestures.json from the XKT(WTSL) mod's
 * character files: which style of each Tennis Elbow gesture every character
 * uses (for example CheerFist 7, RagingFist 4).
 *
 *   node scripts/update-character-gestures.mjs "<path to XKT(WTSL)/Profiles>"
 *
 * A gesture left blank in the mod uses the game's default style and is left
 * out here. When a character has several versions (v2, v3…), the highest
 * version wins, matching how the Forum keys characters by name.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DMO_GESTURE_TYPES, dmoGestureNameKey } from '../lib/dmoGestureTypes.mjs';

const root = process.argv[2];
if (!root) {
  console.error('Usage: node scripts/update-character-gestures.mjs "<path to XKT(WTSL)/Profiles>"');
  process.exit(1);
}

// The mod spells the racket throw both ways.
const FIELDS = new Map([
  ...DMO_GESTURE_TYPES.map((type) => [`Anim${type}`, type]),
  ['AnimThrowRacquet', 'ThrowRacket'],
]);

function iniFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return iniFiles(path);
    return name.toLowerCase().endsWith('.ini') ? [path] : [];
  });
}

const version = (file) => Number(/\bv(\d+)\b/i.exec(file)?.[1] ?? 1);
const chosen = new Map();
for (const file of iniFiles(root).sort()) {
  const text = readFileSync(file, 'latin1');
  // The playable profile's name is the last non-zero Name field.
  const names = [...text.matchAll(/^Name[ \t]*=[ \t]*(.+?)[ \t]*$/gm)].map((match) => match[1]).filter((name) => name !== '0');
  const name = names.at(-1);
  const key = name ? dmoGestureNameKey(name) : '';
  if (!key) continue;
  const gestures = {};
  for (const match of text.matchAll(/^(Anim[A-Za-z]+)[ \t]*=[ \t]*(\d+)[ \t]*$/gm)) {
    const type = FIELDS.get(match[1]);
    if (type) gestures[type] = Number(match[2]);
  }
  const previous = chosen.get(key);
  if (!previous || version(file) >= previous.version) chosen.set(key, { version: version(file), name, gestures });
}

const characters = Object.fromEntries([...chosen.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([key, { name, gestures }]) => [key, { name, gestures }]));
writeFileSync(
  new URL('../public/dmo-character-gestures.json', import.meta.url),
  `${JSON.stringify({ source: 'XKT(WTSL)', types: DMO_GESTURE_TYPES, characters }, null, 2)}\n`,
);
console.log(`Wrote gesture styles for ${Object.keys(characters).length} characters.`);

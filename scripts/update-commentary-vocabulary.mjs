// Rewrites DMO_COMMENTARY_VOCABULARY in lib/dmoCommentaryVocabulary.mjs from
// the sentence templates in lib/dmoCommentary.mjs. Run after changing wording.
import { readFileSync, writeFileSync } from 'node:fs';
import { extractDmoCommentaryVocabulary } from '../lib/dmoCommentaryVocabulary.mjs';

const target = new URL('../lib/dmoCommentaryVocabulary.mjs', import.meta.url);
const words = extractDmoCommentaryVocabulary(
  readFileSync(new URL('../lib/dmoCommentary.mjs', import.meta.url), 'utf8'),
);
const lines = [];
let line = '';
for (const word of words) {
  const item = `'${word.replace(/'/g, "\\'")}', `;
  if ((line + item).length > 96) {
    lines.push(`  ${line.trimEnd()}`);
    line = '';
  }
  line += item;
}
if (line) lines.push(`  ${line.trimEnd()}`);
const source = readFileSync(target, 'utf8').replace(
  /export const DMO_COMMENTARY_VOCABULARY = Object\.freeze\(\[[\s\S]*?\]\);/,
  `export const DMO_COMMENTARY_VOCABULARY = Object.freeze([\n${lines.join('\n')}\n]);`,
);
writeFileSync(target, source);
console.log(`${words.length} words written to lib/dmoCommentaryVocabulary.mjs`);

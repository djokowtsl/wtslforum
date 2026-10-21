import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const header = readFileSync(
  new URL('../components/ForumHeader.tsx', import.meta.url),
  'utf8',
);
const css = readFileSync(
  new URL('../app/globals.css', import.meta.url),
  'utf8',
);

test('desktop navigation exposes every primary destination in its own row', () => {
  assert.match(header, /<nav className="desktop-nav" aria-label="Main">/);
  assert.match(header, /const navItems = u \? \[\.\.\.NAV, \{ href: '\/live-dmo', label: 'Live Broadcast' \}\] : NAV;/);
  assert.match(header, /<div className="desktop-nav-links">\s*\{navItems\.map/);
  assert.match(css, /\.desktop-nav-inner\s*\{[^}]*display:\s*flex/);
  assert.match(css, /\.desktop-nav-links\s*\{[^}]*flex-wrap:\s*wrap/);
});

test('mobile and tablet widths retain the existing dropdown navigation', () => {
  assert.match(header, /<MobileNav[\s\S]*?items=\{navItems\}/);
  const responsiveHeader = css.slice(
    css.indexOf('@media (max-width: 960px)'),
    css.indexOf('@media (max-width: 700px)'),
  );
  assert.match(responsiveHeader, /\.desktop-nav\s*\{\s*display:\s*none;/);
  assert.match(responsiveHeader, /\.mobile-menu\s*\{\s*display:\s*block;/);
});

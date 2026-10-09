import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import Module from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { transformSync } = require('next/dist/build/swc');
const source = await readFile(new URL('../components/ReactionChip.tsx', import.meta.url), 'utf8');

// Exercise the actual component's handlers and effects with controlled hooks
// and DOM geometry; no live user session or reaction API writes are involved.
function harness(overrides = {}) {
  const slots = [];
  let cursor = 0, dirty = false, effects = [], tree, calls = 0;
  const listeners = new Map();
  const rect = { left: 330, top: 100, bottom: 132 };
  const countNode = {};
  const itemNode = { getBoundingClientRect: () => rect, contains: (n) => n === itemNode || n === countNode };
  const popupNode = { getBoundingClientRect: () => ({ height: 80 }), contains: (n) => n === popupNode };
  const events = (prefix) => ({
    addEventListener: (name, fn) => listeners.set(prefix + name, fn),
    removeEventListener: (name, fn) => { if (listeners.get(prefix + name) === fn) listeners.delete(prefix + name); },
  });
  globalThis.window = { innerWidth: 390, innerHeight: 844, ...events('window:') };
  globalThis.document = { body: {}, activeElement: null, ...events('document:') };
  const effect = (run, deps) => {
    const i = cursor++;
    const previous = slots[i];
    if (!previous || deps.some((d, n) => !Object.is(d, previous.deps[n]))) {
      slots[i] = { deps, cleanup: previous?.cleanup };
      effects.push(() => { slots[i].cleanup?.(); slots[i].cleanup = run(); });
    }
  };
  const hooks = {
    ...React,
    useId: () => 'reaction-tooltip-test',
    useRef: (value) => { const i = cursor++; return slots[i] ??= { current: value }; },
    useState: (initial) => {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], (update) => {
        const next = typeof update === 'function' ? update(slots[i]) : update;
        if (!Object.is(next, slots[i])) { slots[i] = next; dirty = true; }
      }];
    },
    useEffect: effect,
    useLayoutEffect: effect,
  };
  const mod = new Module(import.meta.url);
  mod.require = (name) => name === 'react' ? hooks
    : name === 'react-dom' ? { createPortal: (children) => children } : require(name);
  mod._compile(transformSync(source, {
    filename: 'ReactionChip.tsx',
    jsc: { parser: { syntax: 'typescript', tsx: true }, transform: { react: { runtime: 'automatic' } } },
    module: { type: 'commonjs' },
  }).code, 'ReactionChip.js');
  let props = { emoji: '😂', count: 2, reactors: ['Alice', 'Bob'], reacted: false,
    disabled: false, updating: false, onToggle: () => { calls++; }, ...overrides };
  const all = (node, predicate) => {
    if (!node || typeof node !== 'object') return [];
    const children = React.Children.toArray(node.props?.children);
    return [...(predicate(node) ? [node] : []), ...children.flatMap((child) => all(child, predicate))];
  };
  const find = (predicate) => all(tree, predicate)[0];
  const render = () => {
    let attempts = 0;
    do {
      dirty = false; cursor = 0; effects = [];
      tree = mod.exports.default(props);
      find((n) => n.props?.className === 'reaction-item').props.ref.current = itemNode;
      const tip = find((n) => n.props?.role === 'tooltip');
      if (tip) tip.props.ref.current = popupNode;
      effects.forEach((run) => run());
      assert.ok(++attempts < 10, 'render settles without an effect loop');
    } while (dirty);
    return tree;
  };
  render();
  return {
    render, rect, itemNode, countNode, popupNode, listeners,
    update: (next) => { props = { ...props, ...next }; render(); },
    item: () => find((n) => n.props?.className === 'reaction-item'),
    toggle: () => find((n) => n.props?.className?.startsWith('reaction-toggle')),
    count: () => find((n) => n.props?.className === 'reaction-count'),
    tooltip: () => find((n) => n.props?.role === 'tooltip'),
    html: () => renderToStaticMarkup(tree),
    calls: () => calls,
    cleanup: () => { slots.forEach((slot) => slot?.cleanup?.()); },
  };
}
test.afterEach(() => { delete globalThis.window; delete globalThis.document; });

test('initial chips show only emoji/count, not a separate Names control', () => {
  const h = harness();
  assert.doesNotMatch(h.html(), />Names<|<details|<summary/);
  assert.equal(h.tooltip(), undefined);
  assert.equal(h.count().props['aria-expanded'], false);
  h.cleanup();
});
test('hover shows real reactor names in a viewport-clamped tooltip, including for guests', () => {
  const h = harness({ disabled: true });
  h.item().props.onMouseEnter(); h.render();
  assert.match(h.html(), /Alice, Bob/);
  assert.equal(renderToStaticMarkup(h.tooltip()).replace(/<[^>]*>/g, ''), 'Alice, Bob');
  assert.equal(h.toggle().props.disabled, true);
  assert.equal(h.count().props.disabled, undefined);
  assert.equal(h.tooltip().props.style.left, 98);
  assert.equal(h.tooltip().props.style.width, 280);
  assert.equal(h.calls(), 0);
  h.cleanup();
});
test('a single-reactor popup contains only the name, not an emoji or reaction heading', () => {
  const h = harness({ emoji: '❤️', count: 1, reactors: ['Squeaky'] });
  h.item().props.onMouseEnter(); h.render();
  assert.equal(renderToStaticMarkup(h.tooltip()).replace(/<[^>]*>/g, ''), 'Squeaky');
  h.cleanup();
});
test('tapping the count pins details without toggling a reaction; tapping again closes it', () => {
  const h = harness();
  h.count().props.onClick(); h.render();
  h.item().props.onMouseLeave(); h.render();
  assert.ok(h.tooltip());
  assert.equal(h.calls(), 0);
  h.count().props.onClick(); h.render();
  assert.equal(h.tooltip(), undefined);
  h.toggle().props.onClick();
  assert.equal(h.calls(), 1);
  h.cleanup();
});
test('keyboard focus opens details and Escape or outside tap dismisses them', () => {
  const h = harness();
  document.activeElement = h.countNode;
  h.item().props.onFocus(); h.render();
  assert.equal(h.count().props['aria-expanded'], true);
  assert.equal(h.count().props['aria-describedby'], h.tooltip().props.id);
  h.listeners.get('document:keydown')({ key: 'Escape' }); h.render();
  assert.equal(h.tooltip(), undefined);
  h.count().props.onClick(); h.render();
  h.listeners.get('document:pointerdown')({ target: {} }); h.render();
  assert.equal(h.tooltip(), undefined);
  h.cleanup();
});
test('tooltip remains open across the hover gap, but closes on pointer leave', async () => {
  const h = harness();
  h.item().props.onMouseEnter(); h.render();
  h.item().props.onMouseLeave();
  h.tooltip().props.onMouseEnter();
  await new Promise((r) => setTimeout(r, 170)); h.render();
  assert.ok(h.tooltip());
  h.tooltip().props.onMouseLeave();
  await new Promise((r) => setTimeout(r, 170)); h.render();
  assert.equal(h.tooltip(), undefined);
  h.cleanup();
});
test('long names are escaped, pending reactions do not show stale names, and missing details stay honest', () => {
  const h = harness({ reactors: ['<script>bad()</script>'] });
  h.item().props.onMouseEnter(); h.render();
  assert.match(h.html(), /&lt;script&gt;/);
  assert.doesNotMatch(h.html(), /<script>/);
  h.update({ updating: true });
  assert.match(h.html(), /Updating reaction/);
  assert.doesNotMatch(h.html(), /bad\(\)/);
  h.update({ updating: false, reactors: [] });
  assert.match(h.html(), /Reaction details unavailable/);
  h.cleanup();
});
test('details flip above a chip near the bottom and follow resize/scroll', () => {
  const h = harness();
  h.rect.top = 780; h.rect.bottom = 812;
  h.item().props.onMouseEnter(); h.render();
  assert.equal(h.tooltip().props.style.top, 692);
  window.innerWidth = 320;
  h.listeners.get('window:resize')(); h.render();
  assert.equal(h.tooltip().props.style.left, 28);
  h.rect.top = 100; h.rect.bottom = 132;
  h.listeners.get('window:scroll')(); h.render();
  assert.equal(h.tooltip().props.style.top, 140);
  h.cleanup();
});
test('removing the last reaction hides the count and any open details', () => {
  const h = harness();
  h.count().props.onClick(); h.render();
  h.update({ count: 0, reactors: [] });
  assert.equal(h.count(), undefined);
  assert.equal(h.tooltip(), undefined);
  h.cleanup();
});
test('reaction toggles keep the existing API and rollback path; names are mounted outside clipped posts', async () => {
  const bar = await readFile(new URL('../components/ReactionBar.tsx', import.meta.url), 'utf8');
  const css = await readFile(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(bar, /fetch\('\/api\/reactions'/);
  assert.match(bar, /setCounts\(previous\)/);
  assert.match(bar, /onToggle=\{\(\) => toggle\(c\.emoji\)\}/);
  assert.doesNotMatch(bar, /<summary|>Names</);
  assert.match(source, /createPortal\([\s\S]*document\.body/);
  assert.match(css, /\.reaction-tooltip \{ position: fixed/);
  assert.match(css, /focus-visible/);
});

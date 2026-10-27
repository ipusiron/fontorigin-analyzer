'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

// Run theme-init.js in a fake window with a chosen saved value and OS setting;
// return whether <html> got the "dark" class.
function run({ saved = null, prefersDark = false, storageThrows = false, noMatchMedia = false } = {}) {
  const classes = new Set();
  const window = {
    localStorage: { getItem: () => { if (storageThrows) throw new Error('blocked'); return saved; } },
    document: { documentElement: { classList: { add: (c) => classes.add(c) } } },
  };
  if (!noMatchMedia) window.matchMedia = () => ({ matches: prefersDark });
  vm.runInNewContext(read('theme-init.js'), { window });
  return classes.has('dark');
}

test('theme-init: follows the OS setting when nothing is saved', () => {
  assert.equal(run({ prefersDark: true }), true);
  assert.equal(run({ prefersDark: false }), false);
  assert.equal(run({ noMatchMedia: true }), false);
});

test('theme-init: the saved choice wins over the OS setting', () => {
  assert.equal(run({ saved: 'dark', prefersDark: false }), true);
  assert.equal(run({ saved: 'light', prefersDark: true }), false);
});

test('theme-init: an unexpected saved value is ignored', () => {
  assert.equal(run({ saved: 'blue', prefersDark: true }), true);
  assert.equal(run({ saved: 'blue', prefersDark: false }), false);
});

test('theme-init: blocked localStorage does not throw and follows the OS', () => {
  assert.equal(run({ storageThrows: true, prefersDark: true }), true);
});

test('theme-init: loaded synchronously in <head> after style.css', () => {
  const html = read('index.html');
  const head = html.slice(0, html.indexOf('</head>'));
  assert.ok(head.includes('<script src="theme-init.js"></script>'), 'theme-init.js is not in <head> (or has defer/async/module)');
  assert.ok(head.indexOf('style.css') < head.indexOf('theme-init.js'));
});

test('theme-init: uses the same storage key as script.js', () => {
  assert.ok(read('theme-init.js').includes("getItem('theme')"));
  assert.ok(read('script.js').includes("const LS = 'theme';"));
});

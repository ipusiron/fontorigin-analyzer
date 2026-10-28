'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
const block = script.slice(script.indexOf('/* ===== Theme Toggle ===== */'), script.indexOf('/* ===== Language toggle wiring ===== */'));

// Run the theme toggle block of script.js with a fake button, storage and OS setting.
// "dark" is the class theme-init.js would have put on <html> before the first paint.
function setup({ dark = false, saved = null, storageThrows = false } = {}) {
  const classes = new Set(dark ? ['dark'] : []);
  const store = saved === null ? {} : { theme: saved };
  const clicks = [];
  const osListeners = [];
  const btn = {
    setAttribute() {}, title: '', querySelector: () => ({ innerHTML: '' }),
    addEventListener: (type, fn) => { if (type === 'click') clicks.push(fn); },
  };
  const localStorage = {
    getItem: (k) => { if (storageThrows) throw new Error('blocked'); return k in store ? store[k] : null; },
    setItem: (k, v) => { if (storageThrows) throw new Error('blocked'); store[k] = v; },
  };
  const window = { matchMedia: () => ({ addEventListener: (type, fn) => osListeners.push(fn) }) };
  const document = {
    getElementById: () => btn,
    documentElement: { classList: {
      contains: (c) => classes.has(c),
      toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
    } },
    addEventListener() {},
  };
  vm.runInNewContext(block, { window, document, localStorage, t: (k) => k });
  return {
    store,
    dark: () => classes.has('dark'),
    click: () => clicks[0](),
    osChange: (matches) => osListeners.forEach((fn) => fn({ matches })),
  };
}

test('theme toggle: opening the page does not save the theme that came from the OS', () => {
  const page = setup({ dark: true });
  assert.equal(page.store.theme, undefined);
});

test('theme toggle: with nothing saved, a change of the OS setting is followed', () => {
  const page = setup({ dark: false });
  page.osChange(true);
  assert.equal(page.dark(), true);
  page.osChange(false);
  assert.equal(page.dark(), false);
  assert.equal(page.store.theme, undefined);
});

test('theme toggle: a click saves the choice, and the OS is no longer followed', () => {
  const page = setup({ dark: false });
  page.click();
  assert.equal(page.store.theme, 'dark');
  assert.equal(page.dark(), true);
  page.osChange(false);
  assert.equal(page.dark(), true);
});

test('theme toggle: a saved choice is not overridden by an OS change', () => {
  const page = setup({ dark: false, saved: 'light' });
  page.osChange(true);
  assert.equal(page.dark(), false);
});

test('theme toggle: blocked storage still switches, and the click is kept for this page', () => {
  const page = setup({ dark: false, storageThrows: true });
  page.click();
  assert.equal(page.dark(), true);
  page.osChange(false);
  assert.equal(page.dark(), true);
});

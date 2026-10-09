'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const messages = require('../messages.js');

test('both locales exist', () => {
  assert.ok(messages.ja && messages.en);
});

test('key parity between ja and en', () => {
  const ja = Object.keys(messages.ja).sort();
  const en = Object.keys(messages.en).sort();
  const missingInEn = ja.filter(k => !(k in messages.en));
  const missingInJa = en.filter(k => !(k in messages.ja));
  assert.deepEqual(missingInEn, [], 'keys missing in en: ' + missingInEn.join(', '));
  assert.deepEqual(missingInJa, [], 'keys missing in ja: ' + missingInJa.join(', '));
});

test('no empty strings', () => {
  for (const lang of ['ja', 'en']) {
    for (const [k, v] of Object.entries(messages[lang])) {
      assert.equal(typeof v, 'string', `${lang}.${k} should be a string`);
      assert.ok(v.length > 0, `${lang}.${k} should not be empty`);
    }
  }
});

test('placeholder parity ({x} tokens match across locales)', () => {
  const tokens = s => (s.match(/\{(\w+)\}/g) || []).sort();
  for (const k of Object.keys(messages.ja)) {
    assert.deepEqual(tokens(messages.ja[k]), tokens(messages.en[k]), `placeholder mismatch for key: ${k}`);
  }
});

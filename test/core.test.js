'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../core.js');

test('median', () => {
  assert.equal(core.median([]), 0);
  assert.equal(core.median([3, 1, 2]), 2);
  assert.equal(core.median([1, 2, 3, 4]), 2.5);
  assert.equal(core.median([5]), 5);
});

test('diffs', () => {
  assert.deepEqual(core.diffs([10, 14, 20]), [4, 6]);
  assert.deepEqual(core.diffs([7]), []);
  assert.deepEqual(core.diffs([]), []);
});

test('clusterLines merges within threshold', () => {
  assert.deepEqual(core.clusterLines([10, 12, 30, 31, 50]), [10, 30, 50]);
  assert.deepEqual(core.clusterLines([50, 10, 12], 4), [10, 50]);
});

test('clusterLines is order independent', () => {
  assert.deepEqual(core.clusterLines([50, 31, 30, 12, 10]), [10, 30, 50]);
});

test('unit conversions', () => {
  assert.equal(core.pxToMm(96), 25.4);
  assert.equal(core.pxToMm(48), 12.7);
  assert.equal(core.ptToPx(72), 96);
  assert.equal(core.ptToPx(12), 16);
  assert.equal(core.ptToMm(72), 25.4);
  assert.equal(core.ptToMm(10), 3.5);
});

test('round1 handles non-finite', () => {
  assert.equal(core.round1(3.14159), 3.1);
  assert.equal(core.round1(Infinity), null);
  assert.equal(core.round1(NaN), null);
});

test('guessFont leans serif for narrow glyphs', () => {
  const g = core.guessFont(0.8);
  assert.equal(g.lean, 'serif');
  assert.equal(g.candidates[0].name, 'Serif-like');
});

test('guessFont leans sans for wide glyphs', () => {
  const g = core.guessFont(1.2);
  assert.equal(g.lean, 'sans');
  assert.equal(g.candidates[0].name, 'Sans-like');
});

test('guessFont neutral near 1.0', () => {
  assert.equal(core.guessFont(1.0).lean, 'neutral');
});

test('cosineSimilarity', () => {
  assert.equal(core.cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(core.cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(core.cosineSimilarity([3, 4], [3, 4]), 1);
  assert.equal(core.cosineSimilarity([1, 2, 3], [2, 4, 6]), 1); // parallel vectors
  assert.equal(core.cosineSimilarity([], []), 0);
});

test('TXT vectors differ by content (no longer constant)', () => {
  // The old bug returned [16,1.6,56] for every TXT, forcing 100% similarity.
  const a = [17, 10, 400];
  const b = [17, 25, 560];
  assert.ok(core.cosineSimilarity(a, b) < 1);
});

test('parseCorpus rejects bad input', () => {
  assert.equal(core.parseCorpus('not json').error, 'invalid-json');
  assert.equal(core.parseCorpus('{"a":1}').error, 'not-array');
  assert.equal(core.parseCorpus('123').error, 'not-array');
});

test('parseCorpus keeps only valid, sanitized entries', () => {
  const input = JSON.stringify([
    { id: 'foa-1', source: 'PDF/IMG', created_at: '2026-01-01T00:00:00Z', features: { avg_font_size_px: 12, line_gap_px: 5 }, vector: [1, 2] },
    { id: 'foa-2', source: 'EVIL', features: {} },               // bad source → dropped
    { source: 'TXT' },                                           // minimal valid
    'garbage'                                                    // not an object → dropped
  ]);
  const { ok, list } = core.parseCorpus(input);
  assert.equal(ok, true);
  assert.equal(list.length, 2);
  assert.equal(list[0].source, 'PDF/IMG');
  assert.equal(list[1].source, 'TXT');
});

test('sanitizeFontPrint neutralizes injected markup by forcing primitives', () => {
  const evil = {
    id: '<img src=x onerror=alert(1)>',
    source: 'PDF/IMG',
    features: { avg_font_size_px: '13', __proto__: { polluted: true }, font_candidates: [{ name: '<b>x</b>', score: '0.5' }] },
    vector: ['9', 'x', 3]
  };
  const clean = core.sanitizeFontPrint(evil);
  // id stays a string (rendered via textContent in the UI, so the markup is inert)
  assert.equal(typeof clean.id, 'string');
  assert.equal(clean.features.avg_font_size_px, 13);        // coerced number
  assert.equal(clean.features.font_candidates[0].score, 0.5); // coerced number
  assert.deepEqual(clean.vector, [9, 0, 3]);                // non-numeric → 0
  assert.equal('polluted' in clean, false);
});

test('cleanFontName strips the subset prefix', () => {
  assert.equal(core.cleanFontName('ABCDEE+TimesNewRomanPSMT'), 'TimesNewRomanPSMT');
  assert.equal(core.cleanFontName('XYZQWE+Arial-BoldMT'), 'Arial-BoldMT');
  assert.equal(core.cleanFontName('Helvetica'), 'Helvetica');
  assert.equal(core.cleanFontName('g_d0_f1'), 'g_d0_f1'); // unresolved id unchanged
  assert.equal(core.cleanFontName(''), '');
});

test('fontCandidatesFromNames counts by frequency', () => {
  const c = core.fontCandidatesFromNames(['ABCDEE+Arial', 'XYZQWE+Arial', 'Times']);
  assert.equal(c[0].name, 'Arial');
  assert.ok(Math.abs(c[0].score - 2 / 3) < 1e-9);
  assert.equal(c[1].name, 'Times');
  assert.equal(core.fontCandidatesFromNames([]).length, 0);
  assert.equal(core.fontCandidatesFromNames([null, '']).length, 0);
});

test('compareEntries: identical PDF features score 1', () => {
  const e = { source: 'PDF/IMG', features: { avg_font_size_px: 20, line_gap_px: 30, margin_mm: { top: 25, bottom: 25, left: 20, right: 20 }, font_candidates: [{ name: 'Helvetica', score: 1 }] } };
  const r = core.compareEntries(e, JSON.parse(JSON.stringify(e)));
  assert.equal(r.comparable, true);
  assert.equal(r.sameSource, true);
  assert.equal(r.score, 1);
  assert.deepEqual(r.breakdown.fontOverlap, ['Helvetica']);
  assert.equal(r.breakdown.marginDelta, 0);
});

test('compareEntries: margins no longer dominate font difference', () => {
  // Same margins, very different font height -> score must drop well below 1.
  const a = { source: 'PDF/IMG', features: { avg_font_size_px: 12, line_gap_px: 18, margin_mm: { top: 25, bottom: 25, left: 20, right: 20 } } };
  const b = { source: 'PDF/IMG', features: { avg_font_size_px: 40, line_gap_px: 60, margin_mm: { top: 25, bottom: 25, left: 20, right: 20 } } };
  const r = core.compareEntries(a, b);
  assert.ok(r.score < 0.9, 'font/gap difference should move the score, got ' + r.score);
  assert.equal(r.breakdown.fontDelta, -28);
});

test('compareEntries: PDF vs DOCX is comparable on shared features', () => {
  const pdf = { source: 'PDF/IMG', features: { avg_font_size_px: 15, line_gap_px: 20, margin_mm: { top: 25, bottom: 25, left: 20, right: 20 } } };
  const docx = { source: 'DOCX', features: { avg_font_size_px: 15, line_gap_px: 20, margin_mm: { top: 25, bottom: 25, left: 20, right: 20 } } };
  const r = core.compareEntries(pdf, docx);
  assert.equal(r.comparable, true);
  assert.equal(r.sameSource, false);
  assert.equal(r.score, 1);
});

test('compareEntries: TXT only compares with TXT', () => {
  const txt = { source: 'TXT', vector: [17, 10, 400], features: {} };
  const pdf = { source: 'PDF/IMG', features: { avg_font_size_px: 15, line_gap_px: 20, margin_mm: { top: 25, left: 20 } } };
  assert.equal(core.compareEntries(txt, pdf).comparable, false);
  assert.equal(core.compareEntries(txt, pdf).reason, 'txt-mismatch');
  const r = core.compareEntries(txt, { source: 'TXT', vector: [17, 25, 560], features: {} });
  assert.equal(r.comparable, true);
  assert.ok(r.score < 1 && r.score > 0);
});

test('compareEntries: refuses when too few shared dimensions', () => {
  const a = { source: 'PDF/IMG', features: { avg_font_size_px: 15 } };
  const b = { source: 'DOCX', features: { margin_mm: { top: 25 } } };
  const r = core.compareEntries(a, b);
  assert.equal(r.comparable, false);
  assert.equal(r.reason, 'insufficient');
});

test('aggregatePageMetrics: uniform pages -> no spread, no outliers', () => {
  const m = { top: 25, bottom: 25, left: 20, right: 20 };
  const r = core.aggregatePageMetrics([
    { fontSizePt: 11, lineGapPt: 6, margins: { ...m } },
    { fontSizePt: 11, lineGapPt: 6, margins: { ...m } },
    { fontSizePt: 11, lineGapPt: 6, margins: { ...m } }
  ]);
  assert.equal(r.pageCount, 3);
  assert.equal(r.spreadMm, 0);
  assert.deepEqual(r.outliers, []);
  assert.deepEqual(r.marginsMM, { top: 25, bottom: 25, left: 20, right: 20 });
});

test('aggregatePageMetrics: flags a spliced page', () => {
  const normal = { top: 25, bottom: 25, left: 20, right: 20 };   // avg 22.5
  const tampered = { top: 40, bottom: 40, left: 35, right: 35 }; // avg 37.5 (dev 15 > 3)
  const r = core.aggregatePageMetrics([
    { fontSizePt: 11, lineGapPt: 6, margins: { ...normal } },
    { fontSizePt: 11, lineGapPt: 6, margins: { ...normal } },
    { fontSizePt: 11, lineGapPt: 6, margins: { ...tampered } }
  ]);
  assert.deepEqual(r.outliers, [3]);
  assert.ok(r.spreadMm > 3);
});

test('corpusSummary is a safe primitive string', () => {
  assert.equal(core.corpusSummary({ features: { avg_font_size_px: 12, line_gap_px: 5 } }), 'font 12px / gap 5px');
  assert.equal(core.corpusSummary({ features: {} }), 'font –px / gap –px');
  assert.equal(typeof core.corpusSummary({}), 'string');
});

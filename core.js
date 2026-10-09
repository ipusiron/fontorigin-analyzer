/**
 * ===== FontOrigin Analyzer - Core (pure logic) =====
 *
 * UMD module: usable in the browser (window.FontOriginCore) and in Node
 * (require('./core.js')) so the same functions can be unit-tested headlessly.
 *
 * This file holds the DOM-free analysis helpers. Anything that touches the
 * canvas, OCR, or the page lives in script.js.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FontOriginCore = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  /** Sources we accept in a FontPrint. Anything else is rejected on import. */
  const SOURCES = Object.freeze(['PDF/IMG', 'DOCX', 'TXT']);

  /** Clamp a value into [min, max]. */
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

  /** Round to one decimal place; non-finite input becomes null. */
  function round1(value) { return Number.isFinite(value) ? Math.round(value * 10) / 10 : null; }

  /** Median of a numeric array (0 for an empty array). */
  function median(values) {
    if (!values || !values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  /** Differences between consecutive elements (used for line-gap analysis). */
  function diffs(values) {
    const out = [];
    for (let i = 1; i < values.length; i++) out.push(values[i] - values[i - 1]);
    return out;
  }

  /**
   * Merge near-duplicate line Y-centres so OCR noise does not create phantom
   * lines. Values closer than `threshold` px are collapsed into one.
   */
  function clusterLines(yCenters, threshold = 4) {
    const sorted = [...yCenters].sort((a, b) => a - b);
    const merged = [];
    for (const y of sorted) {
      if (!merged.length || y - merged[merged.length - 1] > threshold) merged.push(y);
    }
    return merged;
  }

  /** px → mm at a given PPI (default 96, the CSS reference). */
  function pxToMm(px, ppi = 96) { return round1((px / ppi) * 25.4); }

  /** pt → px at a given PPI. 1pt = 1/72 inch. */
  function ptToPx(pt, ppi = 96) { return (pt / 72) * ppi; }

  /** pt → mm. 1pt = 0.3528mm. Rounded to 0.1mm. */
  function ptToMm(pt) { return round1(pt * 0.3528); }

  /**
   * Heuristic font-family guess from the mean glyph aspect ratio (width/height).
   * Serif faces tend to be narrower (aspect < 1); sans-serif wider.
   * Returns candidates sorted by score plus a human-readable reason so the
   * learner can see *why* the tool leans one way.
   */
  function guessFont(aspect) {
    const serifScore = clamp(1.1 - aspect, 0, 1);
    const sansScore = clamp(aspect - 0.9, 0, 1);
    const norm = serifScore + sansScore || 1;
    const candidates = [
      { name: 'Serif-like', score: serifScore / norm },
      { name: 'Sans-like', score: (sansScore / norm) * 0.9 },
      { name: 'Mono-like', score: 0.1 }
    ].sort((a, b) => b.score - a.score);
    const lean = aspect < 0.95 ? 'serif' : aspect > 1.05 ? 'sans' : 'neutral';
    return { candidates, aspect: round1(aspect), lean };
  }

  /** Cosine similarity of two numeric vectors (0 when either is all-zero). */
  function cosineSimilarity(v1 = [], v2 = []) {
    const n = Math.max(v1.length, v2.length);
    let dot = 0, a = 0, b = 0;
    for (let i = 0; i < n; i++) {
      const x = v1[i] || 0, y = v2[i] || 0;
      dot += x * y; a += x * x; b += y * y;
    }
    return (a && b) ? dot / Math.sqrt(a * b) : 0;
  }

  /**
   * Keep only the known, correctly-typed fields of one FontPrint entry.
   * This is the defence against stored XSS: an imported object can carry
   * arbitrary keys/values, so we rebuild a clean object with primitives only.
   * Returns null if the entry is not a usable FontPrint.
   */
  function sanitizeFontPrint(entry) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const source = typeof entry.source === 'string' && SOURCES.includes(entry.source) ? entry.source : null;
    if (!source) return null;

    const srcFeatures = (entry.features && typeof entry.features === 'object') ? entry.features : {};
    const features = {
      avg_font_size_px: round1(Number(srcFeatures.avg_font_size_px)),
      line_gap_px: round1(Number(srcFeatures.line_gap_px)),
      kerning_signature: typeof srcFeatures.kerning_signature === 'string' ? srcFeatures.kerning_signature.slice(0, 64) : ''
    };
    const margin = srcFeatures.margin_mm;
    if (margin && typeof margin === 'object') {
      features.margin_mm = {
        top: round1(Number(margin.top)),
        bottom: round1(Number(margin.bottom)),
        left: round1(Number(margin.left)),
        right: round1(Number(margin.right))
      };
    }
    if (Array.isArray(srcFeatures.font_candidates)) {
      features.font_candidates = srcFeatures.font_candidates
        .filter(c => c && typeof c === 'object')
        .slice(0, 5)
        .map(c => ({
          name: typeof c.name === 'string' ? c.name.slice(0, 64) : '?',
          score: Number.isFinite(Number(c.score)) ? Number(c.score) : 0
        }));
    }

    const clean = {
      id: typeof entry.id === 'string' ? entry.id.slice(0, 80) : `foa-${Date.now()}`,
      created_at: typeof entry.created_at === 'string' ? entry.created_at.slice(0, 40) : new Date().toISOString(),
      source,
      features,
      fingerprint_hash: typeof entry.fingerprint_hash === 'string' ? entry.fingerprint_hash.slice(0, 128) : '',
      vector: Array.isArray(entry.vector) ? entry.vector.map(x => Number.isFinite(Number(x)) ? Number(x) : 0).slice(0, 16) : []
    };
    return clean;
  }

  /**
   * Validate and sanitize an imported corpus (array of FontPrints).
   * `raw` may be a JSON string or an already-parsed value.
   * Returns { ok, list, error }.
   */
  function parseCorpus(raw) {
    let data = raw;
    if (typeof raw === 'string') {
      try { data = JSON.parse(raw); }
      catch (e) { return { ok: false, list: [], error: 'invalid-json' }; }
    }
    if (!Array.isArray(data)) return { ok: false, list: [], error: 'not-array' };
    const list = data.map(sanitizeFontPrint).filter(Boolean);
    return { ok: true, list, error: null };
  }

  /** One-line summary used in the corpus table (safe primitive string). */
  function corpusSummary(entry) {
    const f = (entry && entry.features) || {};
    const font = f.avg_font_size_px == null ? '–' : f.avg_font_size_px;
    const gap = f.line_gap_px == null ? '–' : f.line_gap_px;
    return `font ${font}px / gap ${gap}px`;
  }

  /**
   * Strip the 6-letter subset prefix PDF embeds on subsetted fonts
   * (e.g. "ABCDEE+TimesNewRomanPSMT" → "TimesNewRomanPSMT") and trim.
   * Unresolved internal ids (e.g. "g_d0_f1") are returned unchanged.
   */
  function cleanFontName(name) {
    if (typeof name !== 'string' || !name) return '';
    return name.replace(/^[A-Z]{6}\+/, '').trim();
  }

  /**
   * Build font candidates from a list of (real) font names by frequency.
   * Returns up to 5 `{name, score}` sorted by score (count / total).
   */
  function fontCandidatesFromNames(names) {
    const counts = new Map();
    let total = 0;
    for (const raw of (names || [])) {
      const n = cleanFontName(raw);
      if (!n) continue;
      counts.set(n, (counts.get(n) || 0) + 1);
      total++;
    }
    if (!total) return [];
    return [...counts.entries()]
      .map(([name, count]) => ({ name, score: count / total }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }

  return Object.freeze({
    SOURCES,
    clamp, round1, median, diffs, clusterLines,
    pxToMm, ptToPx, ptToMm,
    guessFont, cosineSimilarity,
    cleanFontName, fontCandidatesFromNames,
    sanitizeFontPrint, parseCorpus, corpusSummary
  });
});

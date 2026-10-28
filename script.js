/**
 * ===== FontOrigin Analyzer - Main Script =====
 *
 * Purpose: Document forensic learning tool that extracts font, margin and
 *          layout features. Runs 100% in the browser (no server upload).
 *
 * Libraries (loaded in index.html with SRI):
 * - Tesseract.js 5.1.0 (OCR), PDF.js 3.11.174 (render), JSZip 3.10.1 (DOCX)
 *
 * Pure, DOM-free helpers live in core.js (window.FontOriginCore) and are unit
 * tested in test/. UI strings live in messages.js (window.FontOriginMessages).
 *
 * Security:
 * - All processing in browser memory; corpus in localStorage (device only).
 * - Corpus import is schema-validated and rendered via DOM API + textContent.
 */

'use strict';

/* Debug logging is off by default; set localStorage.foa_debug = '1' to enable. */
const DEBUG = (() => { try { return localStorage.getItem('foa_debug') === '1'; } catch (e) { return false; } })();
const log = (...a) => { if (DEBUG) console.log(...a); };
const warn = (...a) => { if (DEBUG) console.warn(...a); };

const Core = window.FontOriginCore;

/* ===== i18n ===== */
const I18N = (function () {
  const MESSAGES = window.FontOriginMessages;
  const LS = 'foa_lang';
  let lang = (() => {
    try { const s = localStorage.getItem(LS); if (s === 'ja' || s === 'en') return s; } catch (e) {}
    return (navigator.language || 'ja').toLowerCase().startsWith('en') ? 'en' : 'ja';
  })();

  function t(key, args = {}) {
    const dict = MESSAGES[lang] || MESSAGES.ja;
    const raw = dict[key] != null ? dict[key] : (MESSAGES.ja[key] != null ? MESSAGES.ja[key] : key);
    return String(raw).replace(/\{(\w+)\}/g, (_, name) => (args[name] != null ? String(args[name]) : ''));
  }

  function localizeStatic() {
    document.documentElement.lang = lang;
    document.title = t('pageTitle');
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.content = t('metaDescription');
    document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-html]').forEach(el => { el.innerHTML = t(el.dataset.i18nHtml); });
    const langBtn = document.getElementById('langToggle');
    if (langBtn) langBtn.textContent = t('languageSwitch');
  }

  function set(next) {
    if (next !== 'ja' && next !== 'en') return;
    lang = next;
    try { localStorage.setItem(LS, lang); } catch (e) {}
    localizeStatic();
    document.dispatchEvent(new CustomEvent('foa:lang'));
  }

  return {
    get lang() { return lang; },
    t,
    localizeStatic,
    set,
    toggle() { set(lang === 'ja' ? 'en' : 'ja'); }
  };
})();
const t = I18N.t;

/* ===== PDF.js worker / CMap config ===== */
if (typeof pdfjsLib === 'undefined') {
  console.error('[Init] PDF.js is not loaded! PDFs will not work.');
} else {
  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }
  pdfjsLib.GlobalWorkerOptions.cMapUrl = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/';
  pdfjsLib.GlobalWorkerOptions.cMapPacked = true;
  log('[Init] PDF.js worker + CJK CMap configured');
}

/* ===== Theme Toggle ===== */
(function () {
  const btn = document.getElementById('themeToggle');
  const root = document.documentElement;
  const LS = 'theme';
  const sun = '<path d="M12 4V2m0 20v-2M4 12H2m20 0h-2M5.64 5.64 4.22 4.22m15.56 15.56-1.42-1.42M18.36 5.64l1.42-1.42M5.64 18.36l-1.42 1.42M12 7a5 5 0 100 10 5 5 0 000-10z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>';
  const moon = '<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>';

  // The initial theme (saved choice, else the OS setting) is set in <head> by
  // theme-init.js before the first paint; here we only read it to sync the button.
  function current() {
    return root.classList.contains('dark') ? 'dark' : 'light';
  }
  // Draw the theme and sync the button. This does not save: only a click saves,
  // so a theme that merely came from the OS keeps following the OS.
  function apply(theme) {
    const isDark = theme === 'dark';
    root.classList.toggle('dark', isDark);
    const next = isDark ? 'light' : 'dark';
    btn.setAttribute('aria-label', t(next === 'dark' ? 'themeToDark' : 'themeToLight'));
    btn.title = t('themeTitle');
    btn.querySelector('svg').innerHTML = (next === 'dark') ? moon : sun;
  }
  function hasSavedChoice() {
    try { const s = localStorage.getItem(LS); return s === 'light' || s === 'dark'; } catch (e) { return false; }
  }
  let chosen = hasSavedChoice();
  apply(current());
  btn.addEventListener('click', () => {
    const next = current() === 'dark' ? 'light' : 'dark';
    chosen = true;
    try { localStorage.setItem(LS, next); } catch (e) {}
    apply(next);
  });
  // Until the user picks a theme, follow OS changes while the page is open.
  const osDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
  if (osDark && osDark.addEventListener) {
    osDark.addEventListener('change', (e) => { if (!chosen) apply(e.matches ? 'dark' : 'light'); });
  }
  // Keep the theme button label in the active language.
  document.addEventListener('foa:lang', () => apply(root.classList.contains('dark') ? 'dark' : 'light'));
  window.__foaApplyTheme = apply;
})();

/* ===== Language toggle wiring ===== */
(function () {
  const btn = document.getElementById('langToggle');
  if (btn) btn.addEventListener('click', () => I18N.toggle());
  // Initial static localization once DOM is ready.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => I18N.localizeStatic());
  else I18N.localizeStatic();
})();

/* ===== Tab Navigation ===== */
(function () {
  const tabs = document.querySelectorAll('.tab');
  const panes = {
    analyze: document.getElementById('tab-analyze'),
    compare: document.getElementById('tab-compare'),
    corpus: document.getElementById('tab-corpus'),
    guide: document.getElementById('tab-guide')
  };
  function activate(b) {
    tabs.forEach(x => { x.classList.remove('is-active'); x.setAttribute('aria-selected', 'false'); });
    b.classList.add('is-active'); b.setAttribute('aria-selected', 'true');
    const target = b.dataset.tab;
    Object.entries(panes).forEach(([k, el]) => el.classList.toggle('hidden', k !== target));
  }
  tabs.forEach((b, i) => {
    b.addEventListener('click', () => activate(b));
    // WAI-ARIA tabs: arrow keys move focus+selection, Home/End jump to ends.
    b.addEventListener('keydown', e => {
      let j = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % tabs.length;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = tabs.length - 1;
      if (j === null) return;
      e.preventDefault(); activate(tabs[j]); tabs[j].focus();
    });
  });
})();

/* ===== Tooltip (portal rendering) ===== */
(function () {
  const portal = document.body;
  function moveTooltipsToBody() {
    document.querySelectorAll('.tooltip').forEach(tip => { if (tip.parentElement !== portal) portal.appendChild(tip); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', moveTooltipsToBody);
  else moveTooltipsToBody();

  function place(btn, tip) {
    const r = btn.getBoundingClientRect(), m = 10;
    let top = r.bottom + m;
    // Clamp horizontally so the bubble never spills off a narrow screen.
    let left = Math.min(Math.max(m, r.left), Math.max(m, innerWidth - tip.offsetWidth - m));
    if (top + tip.offsetHeight > innerHeight - m) top = r.top - tip.offsetHeight - m;
    tip.style.top = `${top}px`; tip.style.left = `${left}px`;
  }
  function show(btn, tip) {
    if (!tip.isConnected || tip.parentElement !== portal) portal.appendChild(tip);
    tip.hidden = false; tip.style.opacity = 0; place(btn, tip);
    requestAnimationFrame(() => tip.style.opacity = 1);
  }
  function hideAll() { document.querySelectorAll('.tooltip:not([hidden])').forEach(x => x.hidden = true); }
  document.addEventListener('click', e => {
    const btn = e.target.closest('.qmark'); hideAll();
    if (!btn) return;
    const tip = document.getElementById(btn.getAttribute('aria-describedby')); if (!tip) return;
    show(btn, tip); e.stopPropagation();
  });
  document.addEventListener('mouseover', e => {
    const btn = e.target.closest('.qmark'); if (!btn) return;
    const tip = document.getElementById(btn.getAttribute('aria-describedby')); if (!tip) return;
    show(btn, tip);
  });
  document.addEventListener('mouseout', e => {
    const btn = e.target.closest('.qmark'); if (!btn) return;
    const tip = document.getElementById(btn.getAttribute('aria-describedby')); if (!tip) return;
    setTimeout(() => { if (!tip.matches(':hover')) tip.hidden = true; }, 120);
  });
  ['resize', 'scroll'].forEach(ev => addEventListener(ev, () => {
    document.querySelectorAll('.tooltip:not([hidden])').forEach(tip => {
      const btn = [...document.querySelectorAll('.qmark')].find(b => b.getAttribute('aria-describedby') === tip.id);
      if (btn) place(btn, tip);
    });
  }));
  addEventListener('keydown', e => { if (e.key === 'Escape') hideAll(); });
})();

/* ===== Shared file + metric helpers ===== */
function readFileAsArrayBuffer(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsArrayBuffer(file); });
}
function readFileAsDataURL(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
}
function readFileAsText(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => {
      const text = r.result;
      const hasMojibake = /[�]|縺|�/.test(text);
      if (hasMojibake) {
        warn('[Text] UTF-8 mojibake detected, retrying with Shift_JIS');
        const r2 = new FileReader();
        r2.onload = () => res(r2.result);
        r2.onerror = () => res(text);
        r2.readAsText(file, 'Shift_JIS');
      } else { res(text); }
    };
    r.onerror = rej;
    r.readAsText(file, 'UTF-8');
  });
}
async function sha256(str) {
  const enc = new TextEncoder().encode(str);
  const h = await crypto.subtle.digest('SHA-256', enc);
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function extOf(file) { return file.name.toLowerCase().split('.').pop(); }
const ALLOWED_EXT = ['pdf', 'png', 'jpg', 'jpeg', 'docx', 'txt'];

/* CJK-aware line wrapping (character by character). */
function wrapTextCJK(context, text, maxWidth) {
  const lines = []; let line = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], test = line + ch;
    if (context.measureText(test).width > maxWidth && line.length > 0) { lines.push(line); line = ch; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines.slice(0, 200);
}

/**
 * Parse a DOCX ArrayBuffer into { margin (pt), sizePt, bodyLines }.
 * Shared by the analyze preview, analyze metrics and compare paths so the
 * regex-based extraction lives in exactly one place.
 */
async function parseDocx(ab) {
  const zip = await JSZip.loadAsync(ab);
  const docXml = await zip.file('word/document.xml')?.async('text') || '';
  const stylesXml = await zip.file('word/styles.xml')?.async('text') || '';
  // Real font names from <w:rFonts w:ascii="..." w:eastAsia="..."> (B).
  const fontNames = [];
  for (const xml of [docXml, stylesXml]) {
    for (const m of xml.matchAll(/<w:rFonts\b[^>]*>/g)) {
      const asc = /w:ascii="([^"]+)"/.exec(m[0]); if (asc) fontNames.push(asc[1]);
      const ea = /w:eastAsia="([^"]+)"/.exec(m[0]); if (ea) fontNames.push(ea[1]);
    }
  }
  const sectPr = /<w:sectPr[\s\S]*?<\/w:sectPr>/.exec(docXml)?.[0] || '';
  const num = re => Number(re.exec(sectPr)?.[1] || 0) / 20; // twips → pt
  const margin = {
    top: num(/w:pgMar[^>]*w:top="(\d+)"/),
    bottom: num(/w:pgMar[^>]*w:bottom="(\d+)"/),
    left: num(/w:pgMar[^>]*w:left="(\d+)"/),
    right: num(/w:pgMar[^>]*w:right="(\d+)"/)
  };
  const szs = [...docXml.matchAll(/<w:sz w:val="(\d+)"\/>/g)].map(m => Number(m[1]) * 0.5);
  const sizePt = szs.length ? (szs.reduce((a, b) => a + b, 0) / szs.length) : 11;
  const bodyLines = [];
  [...docXml.matchAll(/<w:p[^>]*>[\s\S]*?<\/w:p>/g)].slice(0, 50).forEach(pMatch => {
    const paraText = [...pMatch[0].matchAll(/<w:t[^>]*>(.*?)<\/w:t>/g)].map(m => m[1]).join('');
    if (paraText.trim()) bodyLines.push(paraText.trim());
  });
  return { margin, sizePt, bodyLines, fontNames };
}

/** Render a DOCX first-page preview with margin guide onto ctx/canvas. */
function renderDocxPreview(ctx, canvas, parsed, w = 900) {
  const { margin, sizePt, bodyLines } = parsed;
  const h = Math.round(w * 1.414);
  canvas.width = w; canvas.height = h;
  const theme = getComputedStyle(document.documentElement);
  ctx.fillStyle = theme.getPropertyValue('--card'); ctx.fillRect(0, 0, w, h);
  const s = w / 595; // A4 width 595pt → canvas px
  const mp = { top: margin.top * s, bottom: margin.bottom * s, left: margin.left * s, right: margin.right * s };
  ctx.strokeStyle = theme.getPropertyValue('--acc-sky'); ctx.setLineDash([4, 4]);
  ctx.strokeRect(mp.left, mp.top, w - mp.left - mp.right, h - mp.top - mp.bottom);
  ctx.setLineDash([]);
  ctx.fillStyle = theme.getPropertyValue('--text');
  const fontSize = Math.max(12, Math.round(sizePt * 1.33)), lineHeight = fontSize * 1.6;
  ctx.font = `${fontSize}px "Noto Sans JP", "Yu Gothic", "Hiragino Sans", "MS PGothic", sans-serif`;
  const contentWidth = w - mp.left - mp.right - 20, startY = mp.top + 25;
  const maxLines = Math.floor((h - mp.top - mp.bottom - 60) / lineHeight);
  let line = 0;
  for (const para of bodyLines) {
    if (line >= maxLines) break;
    for (const wrapped of wrapTextCJK(ctx, para, contentWidth)) {
      if (line >= maxLines) break;
      ctx.fillText(wrapped, mp.left + 10, startY + line * lineHeight); line++;
    }
    line++;
  }
  ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillRect(0, 0, w, 32);
  ctx.fillStyle = theme.getPropertyValue('--acc-sky');
  ctx.font = '13px "Noto Sans JP", "Yu Gothic", "Hiragino Sans", "MS PGothic", sans-serif';
  ctx.fillText(`DOCX: 余白 上${margin.top.toFixed(1)} 下${margin.bottom.toFixed(1)} 左${margin.left.toFixed(1)} 右${margin.right.toFixed(1)}pt / 文字${sizePt.toFixed(1)}pt`, 12, 20);
}

/**
 * Try to read a PDF page's text layer directly (no OCR).
 * Electronic PDFs carry positioned glyph runs with real font names, which are
 * far more accurate than OCR. Returns a normalized feature bundle, or null when
 * there is no usable text layer (scanned / image-only PDF → caller falls to OCR).
 * The page must already have been rendered once so `commonObjs` holds the fonts.
 */
async function extractPdfTextFeatures(page) {
  const vp = page.getViewport({ scale: 1 }); // 1 unit = 1pt, top-left origin
  const tc = await page.getTextContent();
  const items = (tc.items || []).filter(it => it.str && it.str.trim());
  // Judge by character count, not item count: a scanned/image PDF has ~0 chars,
  // while even a short electronic PDF has a handful.
  const totalChars = items.reduce((a, it) => a + it.str.trim().length, 0);
  if (!items.length || totalChars < 6) return null; // no usable text layer → OCR

  const baselines = [], fontHeights = [], aspects = [], fontNames = [], glyphs = [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const it of items) {
    const m = pdfjsLib.Util.transform(vp.transform, it.transform);
    const x = m[4], y = m[5];              // top-left coords (pt)
    const fh = Math.hypot(m[2], m[3]);     // glyph height (pt)
    const w = it.width || 0;               // advance width (pt)
    if (fh <= 0) continue;
    baselines.push(y);
    fontHeights.push(fh);
    aspects.push((w / Math.max(1, it.str.length)) / fh); // per-character aspect
    if (it.fontName) fontNames.push(it.fontName);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x + w);
    minY = Math.min(minY, y - fh); maxY = Math.max(maxY, y);
    glyphs.push({ str: it.str, xPt: x, yPt: y - fh, wPt: w, hPt: fh });
  }
  if (!fontHeights.length) return null;

  // Resolve internal font ids (e.g. g_d0_f1) to real names via commonObjs.
  const realNames = fontNames.map(fn => {
    try { const o = page.commonObjs.get(fn); return (o && o.name) ? o.name : fn; }
    catch (e) { return fn; }
  });

  const pageWPt = vp.width, pageHPt = vp.height;
  const fontSizePt = Core.median(fontHeights);
  const lineGapPt = Core.median(Core.diffs(Core.clusterLines(baselines)).filter(d => d > 1));
  const marginsMM = {
    left: Core.ptToMm(minX), right: Core.ptToMm(pageWPt - maxX),
    top: Core.ptToMm(minY), bottom: Core.ptToMm(pageHPt - maxY)
  };
  const candidates = Core.fontCandidatesFromNames(realNames);
  const fontLean = Core.guessFont(Core.median(aspects));
  return {
    pageWPt, pageHPt, fontSizePt, lineGapPt, marginsMM, candidates, fontLean, glyphs,
    vecPx: [
      Core.ptToPx(fontSizePt), Core.ptToPx(lineGapPt),
      Core.ptToPx(minX), Core.ptToPx(pageWPt - maxX), Core.ptToPx(minY), Core.ptToPx(pageHPt - maxY)
    ]
  };
}

/** Crop representative glyph thumbnails from the rendered PDF canvas using the
 *  text-layer positions (points → canvas px). Mirrors sampleGlyphs() output. */
function cropGlyphsFromText(cnv, glyphs, pageWPt) {
  const target = ['a', 'e', 'g', '1', 'l', '"', '‘', '’', '“', '”'];
  const scale = cnv.width / pageWPt;
  const out = [];
  for (const g of glyphs) {
    const s = (g.str || '').trim();
    const idx = [...s].findIndex(ch => target.includes(ch));
    if (idx < 0) continue;
    const padPt = Math.max(1, g.hPt * 0.12);
    const sx = Math.max(0, (g.xPt - padPt) * scale), sy = Math.max(0, (g.yPt - padPt) * scale);
    const sw = Math.min(cnv.width - sx, (g.wPt + padPt * 2) * scale);
    const sh = Math.min(cnv.height - sy, (g.hPt + padPt * 2) * scale);
    if (sw <= 1 || sh <= 1) continue;
    const size = 72;
    const tc = document.createElement('canvas'); tc.width = size; tc.height = size;
    const tctx = tc.getContext('2d');
    tctx.fillStyle = '#ffffff'; tctx.fillRect(0, 0, size, size);
    const sc = Math.min(size / sw, size / sh), dw = sw * sc, dh = sh * sc;
    try { tctx.drawImage(cnv, sx, sy, sw, sh, (size - dw) / 2, (size - dh) / 2, dw, dh); } catch (e) { continue; }
    out.push({ glyph: s[idx], box: [g.xPt, g.yPt, g.wPt, g.hPt], thumb: tc.toDataURL('image/png') });
    if (out.length >= 18) break;
  }
  return out;
}

/* ===== Analyze tab ===== */
(function () {
  const fileInput = document.getElementById('fileAnalyze');
  const dropArea = document.getElementById('dropAnalyze');
  const canvas = document.getElementById('canvasAnalyze');
  const ctx = canvas.getContext('2d');
  const btn = document.getElementById('btnAnalyze');
  const prog = document.getElementById('analyzeProgress');
  const spinner = document.getElementById('analyzeSpinner');
  const emptyState = document.getElementById('emptyState');
  const modeBtns = [document.getElementById('modeBalanced'), document.getElementById('modeFast'), document.getElementById('modeAccurate')];
  let mode = 'balanced', currentFile = null, lastFeatures = null;

  modeBtns.forEach(b => b.addEventListener('click', () => {
    modeBtns.forEach(x => x.classList.remove('seg-on')); b.classList.add('seg-on'); mode = b.dataset.mode;
  }));

  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(ev => dropArea.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); }));
  ['dragenter', 'dragover'].forEach(ev => dropArea.addEventListener(ev, () => dropArea.classList.add('ring')));
  ['dragleave', 'drop'].forEach(ev => dropArea.addEventListener(ev, () => dropArea.classList.remove('ring')));
  dropArea.addEventListener('drop', e => {
    if (e.dataTransfer.files?.length) { fileInput.files = e.dataTransfer.files; currentFile = fileInput.files[0]; showPreview(); }
  });
  dropArea.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => { currentFile = fileInput.files[0]; showPreview(); });

  function validExt(file) {
    if (!ALLOWED_EXT.includes(extOf(file))) { showToast(t('toastBadType'), 'error'); return false; }
    return true;
  }

  async function showPreview() {
    if (!currentFile || !validExt(currentFile)) return;
    emptyState.classList.add('hidden');
    canvas.classList.remove('hidden');
    const ext = extOf(currentFile);
    prog.textContent = t('loaded', { name: currentFile.name });

    if (ext === 'pdf') {
      if (typeof pdfjsLib === 'undefined') { showToast(t('toastPdfMissing'), 'error'); prog.textContent = ''; return; }
      const ab = await readFileAsArrayBuffer(currentFile);
      const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 1.2 });
      canvas.width = viewport.width; canvas.height = viewport.height;
      await page.render({ canvasContext: ctx, viewport }).promise;
    } else if (['png', 'jpg', 'jpeg'].includes(ext)) {
      const url = await readFileAsDataURL(currentFile);
      const img = new Image(); img.src = url; await img.decode();
      const scale = Math.min(1, (canvas.parentElement.clientWidth - 4) / img.width);
      canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    } else if (ext === 'docx') {
      const ab = await readFileAsArrayBuffer(currentFile);
      renderDocxPreview(ctx, canvas, await parseDocx(ab), 640);
    } else if (ext === 'txt') {
      const text = await readFileAsText(currentFile);
      const w = 640, pad = 56;
      canvas.width = w; canvas.height = Math.max(360, Math.min(1600, Math.ceil(text.length / 50) * 24 + pad * 2));
      const theme = getComputedStyle(document.documentElement);
      ctx.fillStyle = theme.getPropertyValue('--card'); ctx.fillRect(0, 0, w, canvas.height);
      ctx.fillStyle = theme.getPropertyValue('--text');
      ctx.font = '14px "Noto Sans JP", "Yu Gothic", "Hiragino Sans", "MS PGothic", sans-serif';
      wrapTextCJK(ctx, text.replace(/\r/g, ''), w - pad * 2).slice(0, 60)
        .forEach((line, i) => ctx.fillText(line, pad, pad + 20 + i * 24));
    }
  }

  document.getElementById('btnCopyJson').addEventListener('click', async () => {
    const ta = document.getElementById('jsonOut');
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(ta.value);
      else { ta.focus(); ta.select(); document.execCommand('copy'); }
      showToast(t('toastCopied'), 'success');
    } catch (e) { showToast(t('toastCopyFailed'), 'error'); }
  });

  document.getElementById('btnSaveCorpus').addEventListener('click', () => {
    if (!lastFeatures) { showToast(t('toastAnalyzeFirst'), 'warning'); return; }
    const key = 'foa_corpus';
    let list = []; try { list = JSON.parse(localStorage.getItem(key) || '[]'); if (!Array.isArray(list)) list = []; } catch (e) { list = []; }
    list.push(lastFeatures);
    try { localStorage.setItem(key, JSON.stringify(list)); } catch (e) {}
    showToast(t('toastSaved'), 'success');
    renderCorpus();
  });

  btn.addEventListener('click', analyzeNow);

  async function analyzeNow() {
    if (!currentFile) { showToast(t('toastSelectFile'), 'warning'); return; }
    if (!validExt(currentFile)) return;

    spinner.classList.remove('hidden');
    prog.textContent = t('prePrep');
    emptyState.classList.add('hidden');
    canvas.classList.remove('hidden');
    const ext = extOf(currentFile);
    document.getElementById('sourceType').textContent = ext.toUpperCase();

    let imgBitmap = null, pdfPage = null, pdfDoc = null, pdfMeta = null;
    if (ext === 'pdf') {
      if (typeof pdfjsLib === 'undefined') { showToast(t('toastPdfMissing'), 'error'); spinner.classList.add('hidden'); prog.textContent = ''; return; }
      prog.textContent = t('pdfLoading');
      const ab = await readFileAsArrayBuffer(currentFile);
      const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
      pdfDoc = pdf;
      try {
        const md = await pdf.getMetadata();
        const info = (md && md.info) || {};
        pdfMeta = {
          producer: info.Producer || info.Creator || '',
          created: Core.formatPdfDate(info.CreationDate || '')
        };
      } catch (e) { warn('[PDF metadata]', e); }
      const page = await pdf.getPage(1);
      pdfPage = page;
      const viewport = page.getViewport({ scale: 1.5 });
      const tmp = document.createElement('canvas'); tmp.width = viewport.width; tmp.height = viewport.height;
      await page.render({ canvasContext: tmp.getContext('2d'), viewport }).promise;
      imgBitmap = await createImageBitmap(tmp);
    } else if (['png', 'jpg', 'jpeg'].includes(ext)) {
      prog.textContent = t('imgLoading');
      const url = await readFileAsDataURL(currentFile);
      const img = new Image(); img.src = url; await img.decode();
      imgBitmap = await createImageBitmap(img);
    } else if (ext === 'docx') {
      const ab = await readFileAsArrayBuffer(currentFile);
      const parsed = await parseDocx(ab);
      renderDocxPreview(ctx, canvas, parsed, 900);
      const { margin, sizePt } = parsed;
      const marginMM = { top: Core.ptToMm(margin.top), bottom: Core.ptToMm(margin.bottom), left: Core.ptToMm(margin.left), right: Core.ptToMm(margin.right) };
      const docxCands = Core.fontCandidatesFromNames(parsed.fontNames);
      lastFeatures = await buildFeatures({
        source: 'DOCX', fontCandidates: docxCands.length ? docxCands : [{ name: '(docx-styles)', score: 1 }], fontLean: null,
        fontSizePx: Core.ptToPx(sizePt), lineGapPx: Core.ptToPx(sizePt) * 0.5, kerningSig: 'docx-xml',
        marginsMM: marginMM, glyphSigs: [],
        layoutVec: [sizePt, margin.top, margin.bottom, margin.left, margin.right],
        extras: { docxMarginsPt: margin, docxFontSizePt: sizePt }
      });
      spinner.classList.add('hidden'); prog.textContent = t('done');
      return;
    } else if (ext === 'txt') {
      const text = await readFileAsText(currentFile);
      const w = 900, pad = 72, fontSize = 17, lh = 1.6;
      canvas.width = w; canvas.height = Math.max(600, Math.min(2200, Math.ceil(text.length / 60) * 28 + pad * 2));
      const theme = getComputedStyle(document.documentElement);
      ctx.fillStyle = theme.getPropertyValue('--card'); ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = theme.getPropertyValue('--text');
      ctx.font = `${fontSize}px "Noto Sans JP", "Yu Gothic", "Hiragino Sans", system-ui`;
      // CJK-aware wrap so a Japanese paragraph with no spaces does not collapse to one line.
      const lines = wrapTextCJK(ctx, text.replace(/\r/g, '').replace(/\n/g, ' '), w - pad * 2);
      lines.forEach((ln, i) => ctx.fillText(ln, pad, pad + i * (fontSize * lh)));
      // Content-derived metrics so different TXT files differ (honest "low" signal).
      const measuredWidth = Math.max(1, ...lines.map(ln => ctx.measureText(ln).width));
      lastFeatures = await buildFeatures({
        source: 'TXT', fontCandidates: [{ name: '(virtual-render)', score: 1 }], fontLean: null,
        fontSizePx: fontSize, lineGapPx: fontSize * (lh - 1), kerningSig: 'approx',
        marginsMM: { top: Core.pxToMm(pad), bottom: Core.pxToMm(pad), left: Core.pxToMm(pad), right: Core.pxToMm(pad) },
        glyphSigs: [],
        layoutVec: [fontSize, lines.length, Math.round(measuredWidth)],
        extras: { virtual: true }
      });
      spinner.classList.add('hidden'); prog.textContent = t('doneVirtual');
      return;
    }

    // PDF / image: draw preview.
    resizeCanvasToBitmap(canvas, imgBitmap);
    ctx.drawImage(imgBitmap, 0, 0, canvas.width, canvas.height);

    // Prefer the PDF text layer (electronic PDFs) over OCR — far more accurate,
    // and it yields real font names. Fall back to OCR for scanned/image PDFs.
    if (ext === 'pdf' && pdfPage) {
      try {
        const tf = await extractPdfTextFeatures(pdfPage);
        if (tf) {
          const glyphSigs = cropGlyphsFromText(canvas, tf.glyphs, tf.pageWPt);

          // Multi-page aggregation (D): process remaining pages via the text
          // layer (no render needed) and compute page-to-page margin spread.
          const CAP = 20;
          const nPages = pdfDoc ? pdfDoc.numPages : 1;
          const perPage = [{ fontSizePt: tf.fontSizePt, lineGapPt: tf.lineGapPt, margins: tf.marginsMM }];
          for (let p = 2; p <= Math.min(nPages, CAP); p++) {
            try {
              const pg = await pdfDoc.getPage(p);
              const tfp = await extractPdfTextFeatures(pg);
              if (tfp) perPage.push({ fontSizePt: tfp.fontSizePt, lineGapPt: tfp.lineGapPt, margins: tfp.marginsMM });
            } catch (e) { warn('[PDF page ' + p + ']', e); }
          }
          const agg = Core.aggregatePageMetrics(perPage);
          const marginsMM = agg ? agg.marginsMM : tf.marginsMM;
          const fontSizePt = agg ? agg.fontSizePt : tf.fontSizePt;
          const lineGapPt = agg ? agg.lineGapPt : tf.lineGapPt;
          const mmToPx = mm => (mm / 25.4) * 96;

          lastFeatures = await buildFeatures({
            source: 'PDF/IMG',
            fontCandidates: tf.candidates.length ? tf.candidates : tf.fontLean.candidates,
            fontLean: tf.fontLean,
            fontSizePx: Core.ptToPx(fontSizePt), lineGapPx: Core.ptToPx(lineGapPt),
            kerningSig: 'pdf-text', marginsMM, glyphSigs,
            layoutVec: [Core.ptToPx(fontSizePt), Core.ptToPx(lineGapPt), mmToPx(marginsMM.left), mmToPx(marginsMM.right), mmToPx(marginsMM.top), mmToPx(marginsMM.bottom)],
            extras: {
              method: 'text-layer', pages: nPages, analyzedPages: perPage.length,
              marginSpreadMm: agg ? agg.spreadMm : 0, outlierPages: agg ? agg.outliers : [],
              pdfMeta: pdfMeta || undefined
            }
          });
          spinner.classList.add('hidden'); prog.textContent = t('done');
          return;
        }
      } catch (e) { warn('[PDF text layer] falling back to OCR:', e); }
    }

    prog.textContent = t('ocrPrep');

    try {
      const ocr = await Tesseract.recognize(canvas, 'eng+jpn', {
        tessedit_pageseg_mode: mode === 'fast' ? 3 : 6,
        logger: info => { if (info.status === 'recognizing text') prog.textContent = t('ocrProgress', { percent: Math.round(info.progress * 100) }); }
      });
      const words = ocr.data.words?.filter(w => w.text?.trim()) || [];
      log('[OCR] words =', words.length);

      if (words.length === 0) {
        // No words → stop; computing metrics on an empty set yields Infinity/NaN.
        showToast(t('toastNoText'), 'warning');
        spinner.classList.add('hidden'); prog.textContent = '';
        return;
      }

      const fontSizePx = Core.median(words.map(w => w.bbox.y1 - w.bbox.y0));
      const lineYs = Core.clusterLines(words.map(w => (w.bbox.y0 + w.bbox.y1) / 2));
      const lineGapPx = Core.median(Core.diffs(lineYs).filter(x => x > 1));
      const leftMarginPx = Math.min(...words.map(w => w.bbox.x0));
      const rightMarginPx = canvas.width - Math.max(...words.map(w => w.bbox.x1));
      const topMarginPx = Math.min(...words.map(w => w.bbox.y0));
      const bottomMarginPx = canvas.height - Math.max(...words.map(w => w.bbox.y1));
      // Per-character aspect (width/chars ÷ height): a word-level ratio would
      // just track word length, not glyph shape (E).
      const aspect = Core.median(words.map(w => {
        const chars = Math.max(1, (w.text || '').trim().length);
        return ((w.bbox.x1 - w.bbox.x0) / chars) / (w.bbox.y1 - w.bbox.y0 + 1);
      }));
      const fontGuess = Core.guessFont(aspect);

      lastFeatures = await buildFeatures({
        source: 'PDF/IMG', fontCandidates: fontGuess.candidates, fontLean: fontGuess,
        fontSizePx, lineGapPx, kerningSig: 'approx',
        marginsMM: { left: Core.pxToMm(leftMarginPx), right: Core.pxToMm(rightMarginPx), top: Core.pxToMm(topMarginPx), bottom: Core.pxToMm(bottomMarginPx) },
        glyphSigs: sampleGlyphs(canvas, words),
        layoutVec: [fontSizePx, lineGapPx, leftMarginPx, rightMarginPx, topMarginPx, bottomMarginPx],
        extras: { method: 'ocr', pdfMeta: pdfMeta || undefined }
      });
      spinner.classList.add('hidden'); prog.textContent = t('done');
    } catch (error) {
      console.error('[OCR Error]', error);
      spinner.classList.add('hidden'); prog.textContent = '';
      showToast(t('toastOcrFailed', { msg: error.message }), 'error');
    }
  }

  function resizeCanvasToBitmap(c, bmp) {
    const maxW = c.parentElement.clientWidth - 4;
    const scale = Math.min(1, maxW / bmp.width);
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
  }

  /**
   * Crop the ACTUAL glyph images from the OCR canvas (not a re-rendered font).
   * The OCR ran on `canvas`, so word bounding boxes are already in its pixel
   * space. Each glyph is stored as a small data-URL thumbnail so it survives a
   * corpus save/reload. (Thumbnails are excluded from the fingerprint hash.)
   */
  function sampleGlyphs(cnv, words) {
    const target = ['a', 'e', 'g', '1', 'l', '"', '‘', '’', '“', '”'];
    const out = [];
    for (const w of words.slice(0, 160)) {
      const text = (w.text || '').trim();
      if (!target.some(ch => text.includes(ch))) continue;
      const { x0, x1, y0, y1 } = w.bbox;
      const wdt = x1 - x0, hgt = y1 - y0;
      if (wdt <= 0 || hgt <= 0) continue;
      const pad = Math.max(2, Math.round(hgt * 0.12));
      const sx = Math.max(0, x0 - pad), sy = Math.max(0, y0 - pad);
      const sw = Math.min(cnv.width - sx, wdt + pad * 2), sh = Math.min(cnv.height - sy, hgt + pad * 2);
      const size = 72;
      const tc = document.createElement('canvas'); tc.width = size; tc.height = size;
      const tctx = tc.getContext('2d');
      tctx.fillStyle = '#ffffff'; tctx.fillRect(0, 0, size, size);
      const scale = Math.min(size / sw, size / sh);
      const dw = sw * scale, dh = sh * scale;
      tctx.imageSmoothingEnabled = true;
      tctx.drawImage(cnv, sx, sy, sw, sh, (size - dw) / 2, (size - dh) / 2, dw, dh);
      out.push({ glyph: text[0], box: [x0, y0, wdt, hgt], thumb: tc.toDataURL('image/png') });
      if (out.length >= 18) break;
    }
    return out;
  }

  async function buildFeatures(opts) {
    const { source, fontCandidates, fontLean, fontSizePx, lineGapPx, kerningSig, marginsMM, glyphSigs, layoutVec, extras = {} } = opts;
    const features = {
      id: `foa-${Date.now()}`,
      created_at: new Date().toISOString(),
      source,
      features: {
        font_candidates: fontCandidates,
        avg_font_size_px: Core.round1(fontSizePx),
        line_gap_px: Core.round1(lineGapPx),
        kerning_signature: kerningSig,
        margin_mm: marginsMM,
        glyph_signatures: glyphSigs
      }
    };
    if (fontLean) features.features.font_lean = { lean: fontLean.lean, aspect: fontLean.aspect };
    const vec = (layoutVec || []).map(x => Number.isFinite(x) ? Math.round(x * 10) / 10 : 0);
    features.fingerprint_hash = await sha256(JSON.stringify({ source, vec, font: fontCandidates?.slice(0, 3) }));
    features.vector = vec;
    features.extras = extras;

    renderResult(features, fontLean);
    return features;
  }

  // Re-render the last analysis result when the UI language changes.
  document.addEventListener('foa:lang', () => { if (lastFeatures) renderResult(lastFeatures, lastFeatures.features?.font_lean ? { lean: lastFeatures.features.font_lean.lean, aspect: lastFeatures.features.font_lean.aspect } : null); });

  function renderResult(features, fontLean) {
    renderJSON(features);
    renderPills(features.source);
    renderLayoutSummary(features, fontLean);
    renderFontCandidates(features);
    renderMarginMap(features);
    renderGlyphGrid(features);
    renderLineGapChart(features.features.avg_font_size_px, features.features.line_gap_px);
  }

  function renderJSON(f) {
    // Keep thumbnails out of the visible JSON to stay readable (still saved to corpus).
    const shown = JSON.parse(JSON.stringify(f));
    (shown.features.glyph_signatures || []).forEach(g => { if (g.thumb) g.thumb = '[data-url omitted]'; });
    document.getElementById('jsonOut').value = JSON.stringify(shown, null, 2);
  }

  function renderPills(source) {
    const pill = document.getElementById('certaintyPill');
    let levKey = 'certaintyLow', col = '--acc-lime';
    if (source === 'DOCX') { levKey = 'certaintyMid'; col = '--acc-violet'; }
    else if (source === 'PDF/IMG') { levKey = 'certaintyHigh'; col = '--acc-sky'; }
    pill.replaceChildren();
    const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = `var(${col})`;
    pill.appendChild(dot);
    pill.appendChild(document.createTextNode(`${t(levKey)}（${source}）`));
  }

  function leanLabel(fontLean) {
    if (!fontLean) return null;
    const key = fontLean.lean === 'serif' ? 'leanSerif' : fontLean.lean === 'sans' ? 'leanSans' : 'leanNeutral';
    return t('labelFontLean', { lean: t(key), aspect: fontLean.aspect });
  }

  function renderLayoutSummary(f, fontLean) {
    const ul = document.getElementById('layoutSummary'); ul.replaceChildren();
    const L = f.features; const items = [];
    if (L.avg_font_size_px) items.push(t('labelFontHeight', { v: L.avg_font_size_px }));
    if (f.extras?.docxFontSizePt) items.push(t('labelDocxFont', { v: f.extras.docxFontSizePt.toFixed(1) }));
    if (L.line_gap_px) items.push(t('labelLineGap', { v: L.line_gap_px }));
    if (L.margin_mm) {
      items.push(t('labelMarginLR', { l: fmt(L.margin_mm.left), r: fmt(L.margin_mm.right) }));
      items.push(t('labelMarginTB', { t: fmt(L.margin_mm.top), b: fmt(L.margin_mm.bottom) }));
    }
    if (f.extras?.docxMarginsPt) {
      const m = f.extras.docxMarginsPt;
      items.push(t('labelDocxMargin', { t: m.top.toFixed(1), b: m.bottom.toFixed(1), l: m.left.toFixed(1), r: m.right.toFixed(1) }));
    }
    const lean = leanLabel(fontLean || L.font_lean);
    if (lean) items.push(lean);
    if (f.extras?.method) items.push(t('labelMethod', { method: t(f.extras.method === 'text-layer' ? 'methodTextLayer' : 'methodOcr') }));
    if (f.extras?.pages > 1) {
      items.push(t('labelPages', { n: f.extras.pages }));
      items.push(t('labelMarginSpread', { v: (f.extras.marginSpreadMm ?? 0).toFixed(1) }));
      if (f.extras.outlierPages && f.extras.outlierPages.length) items.push(t('labelOutlierPages', { pages: f.extras.outlierPages.join(', ') }));
    }
    if (f.extras?.pdfMeta) {
      if (f.extras.pdfMeta.producer) items.push(t('labelPdfProducer', { v: f.extras.pdfMeta.producer }));
      if (f.extras.pdfMeta.created) items.push(t('labelPdfCreated', { v: f.extras.pdfMeta.created }));
    }
    if (!items.length) items.push(t('noData'));
    items.forEach(text => { const li = document.createElement('li'); li.textContent = text; ul.appendChild(li); });
  }
  function fmt(v) { return (v == null) ? '–' : Number(v).toFixed(1); }

  function renderFontCandidates(f) {
    const ul = document.getElementById('fontCandidates'); ul.replaceChildren();
    (f.features.font_candidates || []).slice(0, 3).forEach(c => {
      const li = document.createElement('li'); li.textContent = `${c.name}  (${(c.score * 100 | 0)}%)`;
      ul.appendChild(li);
    });
  }

  function renderMarginMap(f) {
    const el = document.getElementById('marginMap'); el.replaceChildren();
    const mm = f.features.margin_mm;
    if (!mm || (mm.top == null && mm.left == null)) {
      const reason = f.source === 'TXT' ? t('noMarginTxt') : '';
      const d = document.createElement('div'); d.className = 'map-empty'; d.textContent = t('noMargin') + reason;
      el.appendChild(d); el.style.aspectRatio = 'auto'; el.style.minHeight = 'auto'; el.style.height = 'auto';
      return;
    }
    el.style.aspectRatio = ''; el.style.minHeight = ''; el.style.height = '';
    const box = document.createElement('div'); box.className = 'map-box';
    const pct = v => (!v || v <= 0) ? 0 : Math.min(v * 1.6, 48);
    const top = pct(mm.top), bottom = pct(mm.bottom), left = pct(mm.left), right = pct(mm.right);
    const inner = document.createElement('div'); inner.className = 'map-inner';
    inner.style.left = `${left}%`; inner.style.right = `${right}%`; inner.style.top = `${top}%`; inner.style.bottom = `${bottom}%`;
    inner.textContent = t('contentArea');
    box.appendChild(inner);

    const safePos = p => Math.max(8, Math.min(p / 2, 50));
    function label(cls, posStyle, text) {
      const d = document.createElement('div'); d.className = 'map-label'; d.style.cssText = posStyle;
      const strong = document.createElement('strong'); strong.textContent = `${text}`;
      d.appendChild(strong); return d;
    }
    if (mm.top != null && top > 0) box.appendChild(label('t', `top:${safePos(top)}%; left:50%; transform:translate(-50%,-50%);`, `上 ${mm.top.toFixed(1)}mm`));
    if (mm.bottom != null && bottom > 0) box.appendChild(label('b', `bottom:${safePos(bottom)}%; left:50%; transform:translate(-50%,50%);`, `下 ${mm.bottom.toFixed(1)}mm`));
    if (mm.left != null && left > 0) box.appendChild(label('l', `left:${safePos(left)}%; top:50%; transform:translate(-50%,-50%);`, `左 ${mm.left.toFixed(1)}mm`));
    if (mm.right != null && right > 0) box.appendChild(label('r', `right:${safePos(right)}%; top:50%; transform:translate(50%,-50%);`, `右 ${mm.right.toFixed(1)}mm`));
    el.appendChild(box);
  }

  function renderGlyphGrid(f) {
    const wrap = document.getElementById('glyphGrid'); wrap.replaceChildren();
    const glyphs = f.features.glyph_signatures || [];
    if (glyphs.length === 0) {
      const reason = f.source === 'TXT' ? t('noGlyphTxt') : t('noGlyphImg');
      const d = document.createElement('div'); d.className = 'glyph-empty'; d.textContent = t('noGlyph') + reason;
      wrap.appendChild(d); return;
    }
    for (const g of glyphs) {
      const container = document.createElement('div'); container.className = 'glyph-cell';
      const c = document.createElement('canvas'); c.width = 96; c.height = 96; c.className = 'glyph-canvas';
      const cx = c.getContext('2d');
      cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, 96, 96);
      if (g.thumb) {
        const img = new Image();
        img.onload = () => cx.drawImage(img, 0, 0, 96, 96);
        img.src = g.thumb;
      } else {
        cx.fillStyle = '#111'; cx.font = 'bold 48px system-ui'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
        cx.fillText(g.glyph, 48, 48);
      }
      const label = document.createElement('div'); label.className = 'glyph-label'; label.textContent = `"${g.glyph}"`;
      container.appendChild(c); container.appendChild(label); wrap.appendChild(container);
    }
  }

  function renderLineGapChart(fontSizePx, lineGapPx) {
    const chart = document.getElementById('chartLineGap');
    const cx = chart.getContext('2d');
    const w = chart.width = Math.min(600, chart.parentElement.clientWidth);
    const h = chart.height = 120;
    chart.style.width = w + 'px'; chart.style.height = h + 'px';
    const cs = getComputedStyle(document.documentElement);
    cx.fillStyle = cs.getPropertyValue('--surface'); cx.fillRect(0, 0, w, h);
    const data = [
      { label: t('chartFontHeight'), value: fontSizePx || 0, color: cs.getPropertyValue('--acc-sky') },
      { label: t('chartLineGapLabel'), value: lineGapPx || 0, color: cs.getPropertyValue('--acc-violet') }
    ];
    const maxVal = Math.max(...data.map(d => d.value), 1);
    const barWidth = Math.min(80, w / data.length / 2);
    const gap = (w - barWidth * data.length) / (data.length + 1);
    data.forEach((d, i) => {
      const x = gap + i * (barWidth + gap);
      const barH = (d.value / maxVal) * (h - 40);
      const y = h - barH - 20;
      cx.fillStyle = d.color; cx.fillRect(x, y, barWidth, barH);
      cx.fillStyle = cs.getPropertyValue('--text'); cx.font = '12px system-ui'; cx.textAlign = 'center';
      cx.fillText(`${d.value.toFixed(1)}px`, x + barWidth / 2, y - 5);
      cx.fillStyle = cs.getPropertyValue('--muted'); cx.font = '11px system-ui';
      cx.fillText(d.label, x + barWidth / 2, h - 5);
    });
  }
})();

/* ===== Compare tab ===== */
(function () {
  const fileLeft = document.getElementById('fileLeft');
  const fileRight = document.getElementById('fileRight');
  const canvasLeft = document.getElementById('canvasLeft');
  const canvasRight = document.getElementById('canvasRight');
  const ctxL = canvasLeft.getContext('2d'), ctxR = canvasRight.getContext('2d');
  const dropL = document.getElementById('dropLeft'), dropR = document.getElementById('dropRight');
  const btn = document.getElementById('btnCompare');
  const prog = document.getElementById('compareProgress');
  let featL = null, featR = null, lastCompare = null;

  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(ev =>
    [dropL, dropR].forEach(a => a.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); })));
  ['dragenter', 'dragover'].forEach(ev => [dropL, dropR].forEach(a => a.addEventListener(ev, () => a.classList.add('ring'))));
  ['dragleave', 'drop'].forEach(ev => [dropL, dropR].forEach(a => a.addEventListener(ev, () => a.classList.remove('ring'))));
  dropL.addEventListener('drop', e => { if (e.dataTransfer.files?.[0]) { fileLeft.files = e.dataTransfer.files; fileLeft.dispatchEvent(new Event('change')); } });
  dropR.addEventListener('drop', e => { if (e.dataTransfer.files?.[0]) { fileRight.files = e.dataTransfer.files; fileRight.dispatchEvent(new Event('change')); } });
  dropL.addEventListener('click', () => fileLeft.click());
  dropR.addEventListener('click', () => fileRight.click());

  fileLeft.addEventListener('change', () => {
    if (!fileLeft.files[0]) return;
    prog.textContent = t('progLeftLoading');
    loadPreview(fileLeft.files[0], canvasLeft, ctxL).then(f => { featL = f; prog.textContent = t('progLeftDone'); })
      .catch(e => { showToast(t('toastLeftFailed', { msg: e.message }), 'error'); prog.textContent = ''; });
  });
  fileRight.addEventListener('change', () => {
    if (!fileRight.files[0]) return;
    prog.textContent = t('progRightLoading');
    loadPreview(fileRight.files[0], canvasRight, ctxR).then(f => { featR = f; prog.textContent = t('progRightDone'); })
      .catch(e => { showToast(t('toastRightFailed', { msg: e.message }), 'error'); prog.textContent = ''; });
  });

  btn.addEventListener('click', () => {
    if (!featL || !featR) { showToast(t('toastSelectBoth'), 'warning'); return; }
    const spinner = document.getElementById('compareSpinner');
    spinner.classList.remove('hidden');
    prog.textContent = t('progComparing');
    try {
      lastCompare = { a: featL, b: featR };
      renderCompare();
      spinner.classList.add('hidden'); prog.textContent = t('compareDone');
    } catch (error) {
      console.error('[Compare]', error);
      spinner.classList.add('hidden'); prog.textContent = '';
      showToast(t('toastOcrFailed', { msg: error.message }), 'error');
    }
  });

  document.addEventListener('foa:lang', () => { if (lastCompare) renderCompare(); });

  function renderCompare() {
    if (!lastCompare) return;
    const { a, b } = lastCompare;
    const r = Core.compareEntries(a, b);
    const list = document.getElementById('diffList'); list.replaceChildren();
    const add = (name, v) => { const li = document.createElement('li'); li.textContent = `${name}：${v}`; list.appendChild(li); };
    const note = (text) => { const li = document.createElement('li'); li.className = 'diff-note'; li.textContent = text; list.appendChild(li); };

    if (!r.comparable) {
      add(t('cmpNotComparable'), '–');
      note(r.reason === 'txt-mismatch' ? t('cmpTxtMismatch') : t('cmpInsufficient'));
      document.getElementById('scoreBlock').textContent = '–';
      return;
    }

    const bd = r.breakdown || {};
    const overlapNames = (bd.fontOverlap || []).slice(0, 3).join(', ') || t('diffNone');
    add(t('diffFont'), overlapNames);
    add(t('diffFontHeight'), bd.fontDelta == null ? '–' : String(bd.fontDelta));
    add(t('diffLineGap'), bd.gapDelta == null ? '–' : String(bd.gapDelta));
    add(t('diffMargin'), bd.marginDelta == null ? '–' : String(bd.marginDelta));
    if (!r.sameSource) note(t('cmpCrossNote', { a: a.source, b: b.source }));
    if (r.kind === 'txt') note(t('txtCompareNote'));
    document.getElementById('scoreBlock').textContent = (r.score * 100).toFixed(1) + '%';
  }

  async function loadPreview(file, canvas, ctx) {
    const ext = extOf(file);
    if (!ALLOWED_EXT.includes(ext)) throw new Error(t('toastUnsupported'));
    let imgBitmap = null, pdfPage = null;

    if (ext === 'pdf') {
      if (typeof pdfjsLib === 'undefined') throw new Error(t('toastPdfMissing'));
      const ab = await readFileAsArrayBuffer(file);
      const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
      const page = await pdf.getPage(1);
      pdfPage = page;
      const viewport = page.getViewport({ scale: 1.5 });
      const tmp = document.createElement('canvas'); tmp.width = viewport.width; tmp.height = viewport.height;
      await page.render({ canvasContext: tmp.getContext('2d'), viewport }).promise;
      imgBitmap = await createImageBitmap(tmp);
    } else if (['png', 'jpg', 'jpeg'].includes(ext)) {
      const url = await readFileAsDataURL(file);
      const img = new Image(); img.src = url; await img.decode();
      imgBitmap = await createImageBitmap(img);
    }

    if (imgBitmap) {
      const scale = Math.min(1, (canvas.parentElement.clientWidth - 4) / imgBitmap.width);
      canvas.width = Math.round(imgBitmap.width * scale);
      canvas.height = Math.round(imgBitmap.height * scale);
      ctx.drawImage(imgBitmap, 0, 0, canvas.width, canvas.height);

      // Prefer the PDF text layer over OCR for comparison, too.
      if (ext === 'pdf' && pdfPage) {
        try {
          const tf = await extractPdfTextFeatures(pdfPage);
          if (tf) return {
            source: 'PDF/IMG', vector: tf.vecPx,
            features: {
              font_candidates: tf.candidates.length ? tf.candidates : tf.fontLean.candidates,
              avg_font_size_px: Core.round1(Core.ptToPx(tf.fontSizePt)),
              line_gap_px: Core.round1(Core.ptToPx(tf.lineGapPt)),
              margin_mm: tf.marginsMM
            }
          };
        } catch (e) { warn('[Compare PDF text layer] falling back to OCR:', e); }
      }

      const ocr = await Tesseract.recognize(canvas, 'eng+jpn', { tessedit_pageseg_mode: 6, logger: () => {} });
      const words = ocr.data.words?.filter(w => w.text?.trim()) || [];
      if (words.length === 0) return { source: 'PDF/IMG', vector: [canvas.width, canvas.height], features: {} };
      const fontSizePx = Core.median(words.map(w => w.bbox.y1 - w.bbox.y0));
      const lineGapPx = Core.median(Core.diffs(Core.clusterLines(words.map(w => (w.bbox.y0 + w.bbox.y1) / 2))).filter(x => x > 1));
      const leftMarginPx = Math.min(...words.map(w => w.bbox.x0));
      const rightMarginPx = canvas.width - Math.max(...words.map(w => w.bbox.x1));
      const topMarginPx = Math.min(...words.map(w => w.bbox.y0));
      const bottomMarginPx = canvas.height - Math.max(...words.map(w => w.bbox.y1));
      // Per-character aspect (width/chars ÷ height): a word-level ratio would
      // just track word length, not glyph shape (E).
      const aspect = Core.median(words.map(w => {
        const chars = Math.max(1, (w.text || '').trim().length);
        return ((w.bbox.x1 - w.bbox.x0) / chars) / (w.bbox.y1 - w.bbox.y0 + 1);
      }));
      return {
        source: 'PDF/IMG',
        vector: [fontSizePx, lineGapPx, leftMarginPx, rightMarginPx, topMarginPx, bottomMarginPx],
        features: {
          font_candidates: Core.guessFont(aspect).candidates,
          avg_font_size_px: Core.round1(fontSizePx),
          line_gap_px: Core.round1(lineGapPx),
          margin_mm: { left: Core.pxToMm(leftMarginPx), right: Core.pxToMm(rightMarginPx), top: Core.pxToMm(topMarginPx), bottom: Core.pxToMm(bottomMarginPx) }
        }
      };
    }

    if (ext === 'docx') {
      const ab = await readFileAsArrayBuffer(file);
      const parsed = await parseDocx(ab);
      renderDocxPreview(ctx, canvas, parsed, 640);
      const { margin, sizePt } = parsed;
      // Convert pt → mm so it lines up with the analyze tab's margin_mm (was mislabelled pt before).
      const marginMM = { top: Core.ptToMm(margin.top), bottom: Core.ptToMm(margin.bottom), left: Core.ptToMm(margin.left), right: Core.ptToMm(margin.right) };
      const docxCands = Core.fontCandidatesFromNames(parsed.fontNames);
      return {
        source: 'DOCX',
        vector: [Core.ptToPx(sizePt), Core.ptToPx(sizePt) * 0.5, marginMM.top, marginMM.bottom, marginMM.left, marginMM.right],
        features: {
          font_candidates: docxCands.length ? docxCands : [{ name: '(docx-styles)', score: 1 }],
          avg_font_size_px: Core.round1(Core.ptToPx(sizePt)),
          line_gap_px: Core.round1(Core.ptToPx(sizePt) * 0.5),
          margin_mm: marginMM
        }
      };
    }

    if (ext === 'txt') {
      const text = await readFileAsText(file);
      const w = 640, pad = 56, fontSize = 16, lh = 1.6;
      canvas.width = w; canvas.height = Math.max(360, Math.min(1600, Math.ceil(text.length / 50) * 24 + pad * 2));
      const theme = getComputedStyle(document.documentElement);
      ctx.fillStyle = theme.getPropertyValue('--card'); ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = theme.getPropertyValue('--text');
      ctx.font = `${fontSize}px "Noto Sans JP", "Yu Gothic", "Hiragino Sans", system-ui`;
      const lines = wrapTextCJK(ctx, text.replace(/\r/g, '').replace(/\n/g, ' '), w - pad * 2);
      lines.forEach((ln, i) => ctx.fillText(ln, pad, pad + i * (fontSize * lh)));
      // Content-derived vector: identical texts match, different texts do not (no longer a constant).
      const measuredWidth = Math.max(1, ...lines.map(ln => ctx.measureText(ln).width));
      return { source: 'TXT', vector: [fontSize, lines.length, Math.round(measuredWidth)], features: {} };
    }

    throw new Error(t('toastUnsupported'));
  }
})();

/* ===== Corpus tab ===== */
function renderCorpus() {
  const body = document.getElementById('corpusBody'); if (!body) return;
  const key = 'foa_corpus';
  // Sanitize on read too: a hand-edited localStorage value is untrusted.
  const parsed = Core.parseCorpus(localStorage.getItem(key) || '[]');
  const list = parsed.list;
  body.replaceChildren();
  const empty = document.getElementById('corpusEmpty');
  if (empty) empty.hidden = list.length > 0;

  list.forEach((f, i) => {
    const tr = document.createElement('tr');
    // DOM API + textContent only — never innerHTML with imported values (stored-XSS fix).
    const cells = [f.id, f.source, safeDate(f.created_at), Core.corpusSummary(f)];
    cells.forEach(text => { const td = document.createElement('td'); td.textContent = text; tr.appendChild(td); });
    const tdAction = document.createElement('td');
    const del = document.createElement('button');
    del.type = 'button'; del.className = 'btn btn-mini'; del.textContent = t('btnDelete'); del.dataset.i = String(i);
    del.addEventListener('click', () => {
      const cur = Core.parseCorpus(localStorage.getItem(key) || '[]').list;
      cur.splice(i, 1);
      try { localStorage.setItem(key, JSON.stringify(cur)); } catch (e) {}
      renderCorpus();
    });
    tdAction.appendChild(del); tr.appendChild(tdAction);
    body.appendChild(tr);
  });
}
function safeDate(iso) { const d = new Date(iso); return isNaN(d) ? '–' : d.toLocaleString(); }

document.getElementById('btnExportCorpus').addEventListener('click', () => {
  const raw = localStorage.getItem('foa_corpus') || '[]';
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const filename = `fontorigin_corpus_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.json`;
  const blob = new Blob([raw], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  URL.revokeObjectURL(a.href);
});
document.getElementById('btnImportCorpus').addEventListener('click', () => document.getElementById('importCorpus').click());
document.getElementById('importCorpus').addEventListener('change', async e => {
  const file = e.target.files?.[0]; if (!file) return;
  const text = await readFileAsText(file);
  const result = Core.parseCorpus(text);
  if (!result.ok) { showToast(t('toastImportFailed'), 'error'); e.target.value = ''; return; }
  // Store only the sanitized list so nothing malicious survives in localStorage.
  const rawCount = (() => { try { const a = JSON.parse(text); return Array.isArray(a) ? a.length : 0; } catch (x) { return 0; } })();
  const skipped = rawCount - result.list.length;
  try { localStorage.setItem('foa_corpus', JSON.stringify(result.list)); } catch (x) {}
  renderCorpus();
  if (skipped > 0) showToast(t('toastImportSkipped', { count: result.list.length, skipped }), 'warning');
  else showToast(t('toastImportOk', { count: result.list.length }), 'success');
  e.target.value = '';
});

/* ===== Toast ===== */
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 3000);
}

renderCorpus();

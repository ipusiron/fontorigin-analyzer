/**
 * ===== FontOrigin Analyzer - Main Script =====
 *
 * Purpose: Document forensic analysis tool that extracts font, margin, and layout features
 * Architecture: 100% client-side (no server communication)
 *
 * Key Technologies:
 * - Tesseract.js v5.1.0 - OCR for PDF/image text recognition
 * - PDF.js v3.11.174 - PDF rendering to canvas
 * - JSZip v3.10.1 - DOCX XML parsing
 *
 * Data Flow:
 * 1. File upload → Format detection
 * 2. Format-specific parsing (PDF/IMG→OCR, DOCX→XML, TXT→virtual render)
 * 3. Feature extraction (font size, line gap, margins, glyphs)
 * 4. FontPrint JSON generation (with SHA-256 fingerprint hash)
 * 5. Visualization (charts, heatmaps, glyph comparison)
 *
 * Security:
 * - All processing in browser memory (no server upload)
 * - localStorage for corpus (device-only)
 * - XSS protection via textContent (innerHTML only for controlled data)
 */

/* ===== Library Status Check ===== */
// Verify external dependencies are loaded before proceeding
console.log('[Init] Checking libraries...');
console.log('[Init] pdfjsLib:', typeof pdfjsLib !== 'undefined' ? 'loaded' : 'NOT LOADED');
console.log('[Init] Tesseract:', typeof Tesseract !== 'undefined' ? 'loaded' : 'NOT LOADED');
console.log('[Init] JSZip:', typeof JSZip !== 'undefined' ? 'loaded' : 'NOT LOADED');

if(typeof pdfjsLib === 'undefined'){
  console.error('[Init] PDF.js is not loaded! PDFs will not work.');
} else {
  // Configure PDF.js web worker for background rendering
  // Worker is required for PDF parsing to avoid blocking main thread
  if(!pdfjsLib.GlobalWorkerOptions.workerSrc){
    pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    console.log('[Init] PDF.js worker src configured in script.js');
  } else {
    console.log('[Init] PDF.js worker already configured:', pdfjsLib.GlobalWorkerOptions.workerSrc);
  }

  // Configure CMap for Japanese/Chinese/Korean fonts
  // CMap (Character Map) files map CID (Character ID) to Unicode
  // Required for proper rendering of CJK PDFs
  pdfjsLib.GlobalWorkerOptions.cMapUrl = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/";
  pdfjsLib.GlobalWorkerOptions.cMapPacked = true; // Use packed (compressed) CMap files
  console.log('[Init] PDF.js CMap configured for CJK support');
}

/**
 * ===== Theme Toggle System =====
 *
 * Design: Button shows NEXT mode icon (moon in light mode, sun in dark mode)
 * This UX pattern is more intuitive than showing current mode
 *
 * Features:
 * - localStorage persistence ('theme' key)
 * - System preference detection (prefers-color-scheme)
 * - Smooth transition via CSS (.dark class on <html>)
 * - Accessibility: aria-label and title attributes
 *
 * Implementation: IIFE to avoid global scope pollution
 */
(function(){
  const btn = document.getElementById('themeToggle');
  const root = document.documentElement;
  const LS = 'theme'; // localStorage key

  // SVG paths for sun/moon icons
  const sun = `<path d="M12 4V2m0 20v-2M4 12H2m20 0h-2M5.64 5.64 4.22 4.22m15.56 15.56-1.42-1.42M18.36 5.64l1.42-1.42M5.64 18.36l-1.42 1.42M12 7a5 5 0 100 10 5 5 0 000-10z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`;
  const moon = `<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`;

  // Get current theme (localStorage > system preference)
  function current(){
    const s = localStorage.getItem(LS);
    if(s==='light'||s==='dark') return s;
    // Fall back to system preference
    return matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
  }

  // Apply theme and update button icon to show NEXT mode
  function apply(theme){
    const isDark = theme==='dark';
    root.classList.toggle('dark', isDark); // Trigger CSS theme switch
    localStorage.setItem(LS, theme); // Persist choice

    const next = isDark?'light':'dark'; // Next mode user will switch to
    btn.setAttribute('aria-label', next==='dark'?'ダークモードに切り替え':'ライトモードに切り替え');
    btn.title = btn.getAttribute('aria-label');
    // Show NEXT mode's icon (moon when in light, sun when in dark)
    btn.querySelector('svg').innerHTML = (next==='dark')?moon:sun;
  }

  // Initialize on page load
  apply(current());

  // Toggle on click
  btn.addEventListener('click', ()=>{
    const now = root.classList.contains('dark')?'dark':'light';
    apply(now==='dark'?'light':'dark');
  });
})();

/**
 * ===== Tab Navigation System =====
 *
 * Simple tab switcher for 4 main sections:
 * - analyze: Single file analysis with feature extraction
 * - compare: Side-by-side comparison of two documents
 * - corpus: Saved FontPrint history management
 * - guide: Usage instructions and ethical guidelines
 *
 * Implementation: Toggle .hidden class on tab panes, .is-active on buttons
 */
(function(){
  const tabs = document.querySelectorAll('.tab');
  const panes = {
    analyze: document.getElementById('tab-analyze'),
    compare: document.getElementById('tab-compare'),
    corpus: document.getElementById('tab-corpus'),
    guide: document.getElementById('tab-guide')
  };
  tabs.forEach(b=>{
    b.addEventListener('click', ()=>{
      tabs.forEach(x=>x.classList.remove('is-active'));
      b.classList.add('is-active');
      const t = b.dataset.tab; // data-tab attribute value
      Object.entries(panes).forEach(([k,el])=>{
        el.classList.toggle('hidden', k!==t);
      });
    });
  });
})();

/**
 * ===== Tooltip System (Portal Rendering) =====
 *
 * Design Pattern: Portal rendering to document.body
 * Why: Prevents tooltips from being hidden by overflow:hidden or z-index stacking contexts
 *
 * Features:
 * - Smart positioning with viewport edge detection (flip)
 * - Dual triggers: hover + click
 * - ESC key dismissal
 * - Auto-repositioning on scroll/resize
 * - Accessible: aria-describedby linking
 *
 * DOM Structure:
 * <button class="qmark" aria-describedby="tooltip-id">?</button>
 * <div id="tooltip-id" class="tooltip" hidden>Content</div>
 */
(function(){
  const portal = document.body;

  // Move all tooltips to body on load to prevent hiding in details/accordion
  function moveTooltipsToBody(){
    document.querySelectorAll('.tooltip').forEach(tip=>{
      if(tip.parentElement !== portal) portal.appendChild(tip);
    });
  }

  // Try immediately if DOM ready, otherwise on DOMContentLoaded
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', moveTooltipsToBody);
  } else {
    moveTooltipsToBody();
  }

  function place(btn, tip){
    const r = btn.getBoundingClientRect(), m=10;
    let top = r.bottom + m, left = Math.min(Math.max(m, r.left), innerWidth - tip.offsetWidth - m);
    if(top + tip.offsetHeight > innerHeight - m) top = r.top - tip.offsetHeight - m;
    tip.style.top = `${top}px`; tip.style.left = `${left}px`;
  }
  function show(btn, tip){
    if(!tip.isConnected || tip.parentElement !== portal) portal.appendChild(tip);
    tip.hidden = false; tip.style.opacity = 0; place(btn, tip);
    requestAnimationFrame(()=> tip.style.opacity = 1);
  }
  function hideAll(){ document.querySelectorAll('.tooltip:not([hidden])').forEach(t=>t.hidden=true); }
  document.addEventListener('click', e=>{
    const btn = e.target.closest('.qmark'); hideAll();
    if(!btn) return;
    const id = btn.getAttribute('aria-describedby'), tip = document.getElementById(id); if(!tip) return;
    show(btn, tip); e.stopPropagation();
  });
  document.addEventListener('mouseover', e=>{
    const btn = e.target.closest('.qmark'); if(!btn) return;
    const id = btn.getAttribute('aria-describedby'), tip = document.getElementById(id); if(!tip) return;
    show(btn, tip);
  });
  document.addEventListener('mouseout', e=>{
    const btn = e.target.closest('.qmark'); if(!btn) return;
    const id = btn.getAttribute('aria-describedby'), tip = document.getElementById(id); if(!tip) return;
    setTimeout(()=>{ if(!tip.matches(':hover')) tip.hidden=true; }, 120);
  });
  ['resize','scroll'].forEach(ev=> addEventListener(ev, ()=>{
    document.querySelectorAll('.tooltip:not([hidden])').forEach(t=>{
      const btn = [...document.querySelectorAll('.qmark')].find(b=> b.getAttribute('aria-describedby')===t.id);
      if(btn) place(btn, t);
    });
  }));
  addEventListener('keydown', e=>{ if(e.key==='Escape') hideAll(); });
})();

/**
 * ===== Utility Functions (Global Scope) =====
 *
 * These helpers are used across multiple tabs (analyze, compare)
 * Kept in global scope for code reuse
 */

/**
 * Read file as ArrayBuffer (for PDF/DOCX binary parsing)
 * @param {File} file - File object from input/drop
 * @returns {Promise<ArrayBuffer>}
 */
function readFileAsArrayBuffer(file){
  return new Promise((res,rej)=>{
    const r=new FileReader();
    r.onload=()=>res(r.result);
    r.onerror=rej;
    r.readAsArrayBuffer(file);
  });
}

/**
 * CJK text wrapping (character-by-character)
 * Standard word-based wrapping doesn't work for Chinese/Japanese/Korean
 * @param {CanvasRenderingContext2D} context - Canvas 2D context for text measurement
 * @param {string} text - Text to wrap
 * @param {number} maxWidth - Maximum line width in pixels
 * @returns {string[]} Array of wrapped lines
 */
function wrapTextCJK(context, text, maxWidth){
  const lines = [];
  let line = '';
  for(let i = 0; i < text.length; i++){
    const char = text[i];
    const test = line + char;
    if(context.measureText(test).width > maxWidth && line.length > 0){
      lines.push(line);
      line = char;
    } else {
      line = test;
    }
  }
  if(line) lines.push(line);
  return lines.slice(0, 200); // Safety limit: prevent memory issues with huge texts
}

/**
 * Calculate median value (used for font size/line gap analysis)
 * @param {number[]} arr - Array of numbers
 * @returns {number} Median value
 */
function median(arr){
  if(!arr.length) return 0;
  const a=[...arr].sort((x,y)=>x-y);
  const m=Math.floor(a.length/2);
  return a.length%2 ? a[m] : (a[m-1]+a[m])/2;
}

/**
 * Calculate differences between consecutive array elements
 * Used for line gap distribution analysis
 * @param {number[]} arr - Array of Y coordinates
 * @returns {number[]} Array of differences
 */
function diffs(arr){
  const out=[];
  for(let i=1; i<arr.length; i++) out.push(arr[i]-arr[i-1]);
  return out;
}

/**
 * Cluster nearby line Y-coordinates (merge lines within 4px threshold)
 * Prevents OCR noise from creating duplicate line detections
 * @param {number[]} yCenters - Array of line Y-center coordinates
 * @returns {number[]} Merged line positions
 */
function clusterLines(yCenters){
  const a=[...yCenters].sort((x,y)=>x-y);
  const merged=[];
  for(const y of a){
    if(!merged.length || y-merged[merged.length-1]>4) merged.push(y);
  }
  return merged;
}

/**
 * Heuristic font family guessing based on glyph aspect ratio
 * Serif fonts (Times, 明朝) tend to be narrower (aspect < 1.0)
 * Sans-serif fonts (Arial, Gothic) tend to be wider (aspect > 1.0)
 * @param {number} aspect - Average width/height ratio of glyphs
 * @returns {Array<{name:string, score:number}>} Font candidates sorted by score
 */
function guessFont(aspect){
  const serifScore = clamp((1.1 - aspect), 0, 1);
  const sansScore = clamp((aspect - 0.9), 0, 1);
  const norm = serifScore + sansScore || 1;
  return [
    {name:'Serif-like', score: (serifScore/norm)},
    {name:'Sans-like', score: (sansScore/norm*0.9)},
    {name:'Mono-like', score: 0.1}
  ].sort((a,b)=>b.score-a.score);
}

/**
 * Read text file with automatic encoding detection
 * Tries UTF-8 first, falls back to Shift_JIS if mojibake detected
 * @param {File} file - Text file to read
 * @returns {Promise<string>} Decoded text content
 */
async function readFileAsText(file){
  return new Promise((res,rej)=>{
    const r=new FileReader();
    r.onload=()=>{
      const text = r.result;
      // Detect mojibake: replacement char (U+FFFD) or garbled Japanese patterns
      const hasMojibake = /[\uFFFD]|縺|�/.test(text);
      if(hasMojibake){
        console.warn('[Text] UTF-8 mojibake detected, retrying with Shift_JIS...');
        const r2=new FileReader();
        r2.onload=()=>res(r2.result);
        r2.onerror=()=>res(text); // Fallback to original if Shift_JIS also fails
        r2.readAsText(file, 'Shift_JIS');
      } else {
        res(text);
      }
    };
    r.onerror=rej;
    r.readAsText(file, 'UTF-8'); // Try UTF-8 first (most common)
  });
}

/**
 * Read file as Data URL (for image preview)
 * @param {File} file - Image file
 * @returns {Promise<string>} Data URL (base64)
 */
function readFileAsDataURL(file){
  return new Promise((res,rej)=>{
    const r=new FileReader();
    r.onload=()=>res(r.result);
    r.onerror=rej;
    r.readAsDataURL(file);
  });
}

/**
 * Calculate SHA-256 hash (for FontPrint fingerprint)
 * Used to generate unique document fingerprint from feature vectors
 * @param {string} str - String to hash
 * @returns {Promise<string>} Hex-encoded hash
 */
async function sha256(str){
  const enc=new TextEncoder().encode(str);
  const h=await crypto.subtle.digest('SHA-256', enc);
  return [...new Uint8Array(h)].map(b=>b.toString(16).padStart(2,'0')).join('');
}

/**
 * Clamp value between min and max
 * @param {number} v - Value to clamp
 * @param {number} a - Min value
 * @param {number} b - Max value
 * @returns {number} Clamped value
 */
function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }

/**
 * Toast notification system (non-blocking UI feedback)
 * @param {string} message - Message to display
 * @param {string} type - Notification type: 'info'|'success'|'error'|'warning'
 */
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10); // Trigger CSS animation
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300); // Clean up after fade-out
  }, 3000);
}

/* ===== Analyze tab logic ===== */
(function(){
  const fileInput = document.getElementById('fileAnalyze');
  const dropArea = document.getElementById('dropAnalyze');
  const canvas = document.getElementById('canvasAnalyze');
  const ctx = canvas.getContext('2d');
  const btn = document.getElementById('btnAnalyze');
  const prog = document.getElementById('analyzeProgress');
  const spinner = document.getElementById('analyzeSpinner');
  const emptyState = document.getElementById('emptyState');
  const modeBtns = [document.getElementById('modeBalanced'), document.getElementById('modeFast'), document.getElementById('modeAccurate')];
  let mode='balanced', currentFile=null, lastFeatures=null;

  modeBtns.forEach(b=> b.addEventListener('click', ()=>{
    modeBtns.forEach(x=>x.classList.remove('seg-on')); b.classList.add('seg-on'); mode=b.dataset.mode;
  }));

  ;['dragenter','dragover','dragleave','drop'].forEach(ev=>{
    dropArea.addEventListener(ev, e=>{ e.preventDefault(); e.stopPropagation(); });
  });
  ;['dragenter','dragover'].forEach(ev=> dropArea.addEventListener(ev, ()=> dropArea.classList.add('ring')));
  ;['dragleave','drop'].forEach(ev=> dropArea.addEventListener(ev, ()=> dropArea.classList.remove('ring')));
  dropArea.addEventListener('drop', e=>{
    if(e.dataTransfer.files?.length){ fileInput.files = e.dataTransfer.files; currentFile=fileInput.files[0]; showPreview(); }
  });
  dropArea.addEventListener('click', ()=> fileInput.click());
  fileInput.addEventListener('change', ()=>{ currentFile=fileInput.files[0]; showPreview(); });

  async function showPreview(){
    if(!currentFile) return;
    emptyState.classList.add('hidden');
    canvas.classList.remove('hidden');
    const ext = currentFile.name.toLowerCase().split('.').pop();
    prog.textContent = `${currentFile.name} を読み込みました`;

    if(ext==='pdf'){
      if(typeof pdfjsLib === 'undefined'){
        console.error('[Preview] PDF.jsライブラリが未定義です');
        console.error('[Preview] window.pdfjsLib:', window.pdfjsLib);
        console.error('[Preview] グローバルオブジェクト:', Object.keys(window).filter(k=>k.includes('pdf')));
        showToast('PDF.jsライブラリが読み込まれていません', 'error');
        prog.textContent = '';
        return;
      }
      console.log('[Preview] PDF.js使用開始');
      const ab = await readFileAsArrayBuffer(currentFile);
      const pdf = await pdfjsLib.getDocument({data:ab}).promise;
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({scale: 1.2});
      canvas.width=viewport.width; canvas.height=viewport.height;
      await page.render({canvasContext: ctx, viewport}).promise;
    }else if(['png','jpg','jpeg'].includes(ext)){
      const url = await readFileAsDataURL(currentFile);
      const img = new Image(); img.src = url; await img.decode();
      const scale = Math.min(1, (canvas.parentElement.clientWidth-4)/img.width);
      canvas.width=Math.round(img.width*scale); canvas.height=Math.round(img.height*scale);
      ctx.drawImage(img,0,0,canvas.width,canvas.height);
    }else if(ext==='docx'){
      const ab = await readFileAsArrayBuffer(currentFile);
      const zip = await JSZip.loadAsync(ab);
      const docXml = await zip.file('word/document.xml')?.async('text') || '';
      const sectPr = /<w:sectPr[\s\S]*?<\/w:sectPr>/.exec(docXml)?.[0] || '';
      const margin = {
        top:   Number(/w:pgMar[^>]*w:top="(\d+)"/.exec(sectPr)?.[1]||0)/20,
        bottom:Number(/w:pgMar[^>]*w:bottom="(\d+)"/.exec(sectPr)?.[1]||0)/20,
        left:  Number(/w:pgMar[^>]*w:left="(\d+)"/.exec(sectPr)?.[1]||0)/20,
        right: Number(/w:pgMar[^>]*w:right="(\d+)"/.exec(sectPr)?.[1]||0)/20,
      };
      // Extract text from paragraphs (preserve paragraph breaks)
      const paragraphs = [...docXml.matchAll(/<w:p[^>]*>[\s\S]*?<\/w:p>/g)];
      const bodyLines = [];
      paragraphs.slice(0, 50).forEach(pMatch => {
        const textMatches = [...pMatch[0].matchAll(/<w:t[^>]*>(.*?)<\/w:t>/g)];
        const paraText = textMatches.map(m=>m[1]).join('');
        if(paraText.trim()) bodyLines.push(paraText.trim());
      });

      const w=640,h=Math.round(w*1.414); canvas.width=w; canvas.height=h;
      const theme = getComputedStyle(document.documentElement);
      ctx.fillStyle=theme.getPropertyValue('--card'); ctx.fillRect(0,0,w,h);

      // Draw margin guide (pt to canvas px: A4 width = 595pt, canvas = 640px)
      const ptToPxScale = w / 595;
      const marginPx = {
        top: margin.top * ptToPxScale,
        bottom: margin.bottom * ptToPxScale,
        left: margin.left * ptToPxScale,
        right: margin.right * ptToPxScale
      };
      ctx.strokeStyle=theme.getPropertyValue('--acc-sky'); ctx.setLineDash([4,4]);
      ctx.strokeRect(marginPx.left, marginPx.top, w-marginPx.left-marginPx.right, h-marginPx.top-marginPx.bottom);
      ctx.setLineDash([]);

      // Draw body text with proper wrapping
      ctx.fillStyle=theme.getPropertyValue('--text');
      const fontSize = 14;
      const lineHeight = 22;
      ctx.font=`${fontSize}px "Noto Sans JP", "Yu Gothic", "Hiragino Sans", "MS PGothic", sans-serif`;
      const contentWidth = w - marginPx.left - marginPx.right - 20;
      const startY = marginPx.top + 20;
      const maxLines = Math.floor((h - marginPx.top - marginPx.bottom - 40) / lineHeight);

      let currentLine = 0;
      for(const para of bodyLines){
        if(currentLine >= maxLines) break;
        // Wrap text character by character for CJK support
        const wrapped = wrapTextCJK(ctx, para, contentWidth);
        for(const line of wrapped){
          if(currentLine >= maxLines) break;
          ctx.fillText(line, marginPx.left + 10, startY + currentLine * lineHeight);
          currentLine++;
        }
        currentLine++; // Add spacing between paragraphs
      }

      // Info overlay
      ctx.fillStyle='rgba(0,0,0,0.7)';
      ctx.fillRect(0, 0, w, 28);
      ctx.fillStyle=theme.getPropertyValue('--acc-sky');
      ctx.font='12px "Noto Sans JP", "Yu Gothic", "Hiragino Sans", "MS PGothic", sans-serif';
      ctx.fillText(`DOCX 1ページ目プレビュー（余白: 上${margin.top.toFixed(1)} 下${margin.bottom.toFixed(1)} 左${margin.left.toFixed(1)} 右${margin.right.toFixed(1)}pt）`, 10, 18);
    }else if(ext==='txt'){
      const text = await readFileAsText(currentFile);
      const w=640, pad=56; canvas.width=w; canvas.height=Math.max(360, Math.min(1600, Math.ceil(text.length/50)*24 + pad*2));
      const theme = getComputedStyle(document.documentElement);
      ctx.fillStyle=theme.getPropertyValue('--card'); ctx.fillRect(0,0,w,canvas.height);
      ctx.fillStyle=theme.getPropertyValue('--text');
      // Use Japanese-compatible font
      ctx.font='14px "Noto Sans JP", "Yu Gothic", "Hiragino Sans", "MS PGothic", sans-serif';
      const lines = text.split('\n').slice(0,60);
      lines.forEach((line,i)=> ctx.fillText(line.slice(0,80), pad, pad + 20 + i*24));
    }
  }

  document.getElementById('btnCopyJson').addEventListener('click', ()=>{
    const ta = document.getElementById('jsonOut'); ta.select(); document.execCommand('copy');
    showToast('JSONをコピーしました', 'success');
  });

  document.getElementById('btnSaveCorpus').addEventListener('click', ()=>{
    if(!lastFeatures){ showToast('先に解析してください', 'warning'); return; }
    const key='foa_corpus', list=JSON.parse(localStorage.getItem(key)||'[]');
    list.push(lastFeatures); localStorage.setItem(key, JSON.stringify(list));
    showToast('コーパスに保存しました', 'success');
    renderCorpus();
  });

  btn.addEventListener('click', analyzeNow);

  async function analyzeNow(){
    if(!currentFile){ showToast('ファイルを選択してください', 'warning'); return; }

    console.log('[解析開始] ファイル:', currentFile.name, 'サイズ:', Math.round(currentFile.size/1024), 'KB');

    spinner.classList.remove('hidden');
    prog.textContent='前処理中…';
    emptyState.classList.add('hidden');
    canvas.classList.remove('hidden');
    const ext = currentFile.name.toLowerCase().split('.').pop();
    document.getElementById('sourceType').textContent = ext.toUpperCase();

    let imgBitmap=null;
    if(ext==='pdf'){
      if(typeof pdfjsLib === 'undefined'){
        console.error('[Analyze] PDF.jsライブラリが未定義です');
        console.error('[Analyze] window.pdfjsLib:', window.pdfjsLib);
        console.error('[Analyze] グローバルオブジェクト:', Object.keys(window).filter(k=>k.includes('pdf')));
        showToast('PDF.jsライブラリが読み込まれていません。ページを再読み込みしてください。', 'error');
        spinner.classList.add('hidden');
        prog.textContent = '';
        return;
      }
      console.log('[Analyze] PDF.js使用開始');
      console.log('[PDF] 読み込み中...');
      prog.textContent='PDF読み込み中…';
      const ab = await readFileAsArrayBuffer(currentFile);
      const pdf = await pdfjsLib.getDocument({data:ab}).promise;
      console.log('[PDF] ページ数:', pdf.numPages);
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({scale: 1.5});
      console.log('[PDF] レンダリング中...', viewport.width, 'x', viewport.height);
      const tmp = document.createElement('canvas'); tmp.width=viewport.width; tmp.height=viewport.height;
      await page.render({canvasContext: tmp.getContext('2d'), viewport}).promise;
      imgBitmap = await createImageBitmap(tmp);
      console.log('[PDF] 読み込み完了');
    }else if(['png','jpg','jpeg'].includes(ext)){
      console.log('[画像] 読み込み中...');
      prog.textContent='画像読み込み中…';
      const url = await readFileAsDataURL(currentFile);
      const img = new Image(); img.src = url; await img.decode();
      imgBitmap = await createImageBitmap(img);
      console.log('[画像] 読み込み完了:', img.width, 'x', img.height);
    }else if(ext==='docx'){
      // DOCX: parse XML to extract style metrics without OCR preview (render a placeholder)
      const ab = await readFileAsArrayBuffer(currentFile);
      const zip = await JSZip.loadAsync(ab);
      const docXml = await zip.file('word/document.xml')?.async('text') || '';
      const stylesXml = await zip.file('word/styles.xml')?.async('text') || '';
      const sectPr = /<w:sectPr[\s\S]*?<\/w:sectPr>/.exec(docXml)?.[0] || '';
      const margin = {
        top:   Number(/w:pgMar[^>]*w:top="(\d+)"/.exec(sectPr)?.[1]||0)/20,
        bottom:Number(/w:pgMar[^>]*w:bottom="(\d+)"/.exec(sectPr)?.[1]||0)/20,
        left:  Number(/w:pgMar[^>]*w:left="(\d+)"/.exec(sectPr)?.[1]||0)/20,
        right: Number(/w:pgMar[^>]*w:right="(\d+)"/.exec(sectPr)?.[1]||0)/20,
      };
      const szs = [...docXml.matchAll(/<w:sz w:val="(\d+)"\/>/g)].map(m=>Number(m[1])*0.5);
      const sizePt = szs.length? (szs.reduce((a,b)=>a+b,0)/szs.length): 11;
      // Extract text from paragraphs (preserve paragraph breaks)
      const paragraphs = [...docXml.matchAll(/<w:p[^>]*>[\s\S]*?<\/w:p>/g)];
      const bodyLines = [];
      paragraphs.slice(0, 50).forEach(pMatch => {
        const textMatches = [...pMatch[0].matchAll(/<w:t[^>]*>(.*?)<\/w:t>/g)];
        const paraText = textMatches.map(m=>m[1]).join('');
        if(paraText.trim()) bodyLines.push(paraText.trim());
      });

      // Render preview page with body text
      const w=900,h=Math.round(w*1.414); canvas.width=w; canvas.height=h;
      const theme = getComputedStyle(document.documentElement);
      ctx.fillStyle=theme.getPropertyValue('--card'); ctx.fillRect(0,0,w,h);

      // Draw margin guide (pt to canvas px: A4 width = 595pt, canvas = 900px)
      const ptToPxScale = w / 595;
      const marginPx = {
        top: margin.top * ptToPxScale,
        bottom: margin.bottom * ptToPxScale,
        left: margin.left * ptToPxScale,
        right: margin.right * ptToPxScale
      };
      ctx.strokeStyle=theme.getPropertyValue('--acc-sky'); ctx.setLineDash([4,4]);
      ctx.strokeRect(marginPx.left, marginPx.top, w-marginPx.left-marginPx.right, h-marginPx.top-marginPx.bottom);
      ctx.setLineDash([]);

      // Draw body text with proper wrapping
      ctx.fillStyle=theme.getPropertyValue('--text');
      const fontSize = Math.round(sizePt * 1.33); // pt to px approximation
      const lineHeight = fontSize * 1.6;
      ctx.font=`${fontSize}px "Noto Sans JP", "Yu Gothic", "Hiragino Sans", "MS PGothic", sans-serif`;
      const contentWidth = w - marginPx.left - marginPx.right - 20;
      const startY = marginPx.top + 25;
      const maxLines = Math.floor((h - marginPx.top - marginPx.bottom - 60) / lineHeight);

      let currentLine = 0;
      for(const para of bodyLines){
        if(currentLine >= maxLines) break;
        // Wrap text character by character for CJK support
        const wrapped = wrapTextCJK(ctx, para, contentWidth);
        for(const line of wrapped){
          if(currentLine >= maxLines) break;
          ctx.fillText(line, marginPx.left + 10, startY + currentLine * lineHeight);
          currentLine++;
        }
        currentLine++; // Add spacing between paragraphs
      }

      // Info overlay
      ctx.fillStyle='rgba(0,0,0,0.75)';
      ctx.fillRect(0, 0, w, 32);
      ctx.fillStyle=theme.getPropertyValue('--acc-sky');
      ctx.font='13px "Noto Sans JP", "Yu Gothic", "Hiragino Sans", "MS PGothic", sans-serif';
      ctx.fillText(`DOCX 1ページ目プレビュー（余白: 上${margin.top.toFixed(1)} 下${margin.bottom.toFixed(1)} 左${margin.left.toFixed(1)} 右${margin.right.toFixed(1)}pt / 文字: ${sizePt.toFixed(1)}pt）`, 12, 20);
      // Build features (without OCR)
      // Convert pt to mm (1 pt = 0.3528 mm)
      const marginMM = {
        top: Math.round(margin.top * 0.3528 * 10) / 10,
        bottom: Math.round(margin.bottom * 0.3528 * 10) / 10,
        left: Math.round(margin.left * 0.3528 * 10) / 10,
        right: Math.round(margin.right * 0.3528 * 10) / 10
      };
      const features = await buildFeatures({
        source:'DOCX', fontCandidates:[{name:'(docx-styles)', score:1}],
        fontSizePx: ptToPx(sizePt), lineGapPx: ptToPx(sizePt) * 0.5, kerningSig:'docx-xml',
        marginsMM: marginMM,
        glyphSigs: [], layoutVec:[sizePt, margin.top, margin.bottom, margin.left, margin.right], extras:{docxMarginsPt:margin, docxFontSizePt: sizePt}
      });
      lastFeatures=features;
      spinner.classList.add('hidden');
      prog.textContent='解析完了';
      return;
    }else if(ext==='txt'){
      // TXT: virtual rendering
      const text = await readFileAsText(currentFile);
      const w=900, pad=72; canvas.width=w; canvas.height=Math.max(600, Math.min(2200, Math.ceil(text.length/60)*28 + pad*2));
      const theme = getComputedStyle(document.documentElement);
      ctx.fillStyle=theme.getPropertyValue('--card'); ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.fillStyle=theme.getPropertyValue('--text'); const fontSize=17; const lh=1.6; ctx.font=`${fontSize}px "Noto Sans JP", system-ui`;
      const lines = wrapText(ctx, text, w - pad*2);
      lines.forEach((ln,i)=> ctx.fillText(ln, pad, pad + i*(fontSize*lh)));
      const features = await buildFeatures({
        source:'TXT', fontCandidates:[{name:'(virtual-render)', score:1}],
        fontSizePx: fontSize, lineGapPx: fontSize*(lh-1), kerningSig:'approx',
        marginsMM: pxToMM(pad), glyphSigs:[], layoutVec:[fontSize, lh, pad], extras:{virtual:true}
      });
      lastFeatures=features;
      spinner.classList.add('hidden');
      prog.textContent='解析完了（仮想レンダリング）';
      return;
    }else{
      showToast('未対応の拡張子です', 'error');
      spinner.classList.add('hidden');
      return;
    }

    // Draw preview
    resizeCanvasToBitmap(canvas, imgBitmap); ctx.drawImage(imgBitmap, 0, 0, canvas.width, canvas.height);

    // OCR
    console.log('[OCR] 開始: モード =', mode);
    prog.textContent='OCR準備中…';

    try {
      const ocr = await Tesseract.recognize(canvas, 'eng+jpn', {
        tessedit_pageseg_mode: mode==='fast'?3:6,
        logger: info => {
          console.log('[OCR Progress]', info);
          if(info.status === 'recognizing text'){
            const percent = Math.round(info.progress * 100);
            prog.textContent = `OCR処理中… ${percent}%`;
          }
        }
      });

      console.log('[OCR] 完了: 検出単語数 =', ocr.data.words?.length || 0);

      // Collect word boxes
      const words = ocr.data.words?.filter(w=>w.text?.trim()) || [];
      console.log('[OCR] フィルタ後の単語数 =', words.length);

      if(words.length === 0){
        showToast('テキストが検出できませんでした。画像の品質を確認してください。', 'warning');
      }

      // Compute metrics
      console.log('[解析] メトリクス計算中...');
      const fontSizePx = median(words.map(w=>w.bbox.y1 - w.bbox.y0));
      const lineYs = clusterLines(words.map(w=> (w.bbox.y0 + w.bbox.y1)/2 ));
      const lineDeltas = diffs(lineYs);
      const lineGapPx = median(lineDeltas.filter(x=>x>1));
      const leftMarginPx = Math.min(...words.map(w=>w.bbox.x0));
      const rightMarginPx = canvas.width - Math.max(...words.map(w=>w.bbox.x1));
      const topMarginPx = Math.min(...words.map(w=>w.bbox.y0));
      const bottomMarginPx = canvas.height - Math.max(...words.map(w=>w.bbox.y1));

      console.log('[解析] フォント推定中...');
      // Very rough font family guess by stroke width vs height (placeholder)
      const aspect = median(words.map(w=> (w.bbox.x1-w.bbox.x0)/(w.bbox.y1-w.bbox.y0+1) ));
      const fontCandidates = guessFont(aspect);

      console.log('[解析] FontPrint生成中...');
      const features = await buildFeatures({
        source:'PDF/IMG',
        fontCandidates,
        fontSizePx, lineGapPx, kerningSig:'approx',
        marginsMM: {
          left: pxToMM(leftMarginPx),
          right: pxToMM(rightMarginPx),
          top: pxToMM(topMarginPx),
          bottom: pxToMM(bottomMarginPx)
        },
        glyphSigs: sampleGlyphs(canvas, words),
        layoutVec:[fontSizePx, lineGapPx, leftMarginPx, rightMarginPx, topMarginPx, bottomMarginPx]
      });

      lastFeatures=features;
      spinner.classList.add('hidden');
      prog.textContent='解析完了';
      console.log('[解析] 完了');

    } catch(error) {
      console.error('[OCR Error]', error);
      spinner.classList.add('hidden');
      prog.textContent='';
      showToast(`OCR処理に失敗しました: ${error.message}`, 'error');
    }
  }

  /* --- rendering helpers --- */
  function resizeCanvasToBitmap(c, bmp){
    const maxW = c.parentElement.clientWidth - 4;
    const scale = Math.min(1, maxW / bmp.width);
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
  }
  function wrapText(context, text, maxWidth){
    const words = text.split(/\s+/); const lines=[]; let line='';
    for(const w of words){
      const test=line?line+' '+w:w;
      if(context.measureText(test).width>maxWidth){ lines.push(line||w); line=w; }
      else line=test;
    }
    if(line) lines.push(line);
    return lines.slice(0, 400); // safety
  }

  /* --- metrics helpers --- */
  function pxToMM(px){ const PPI=96; return Math.round((px / PPI) * 25.4 * 10)/10; }
  function ptToPx(pt){ const PPI=96; return pt/72*PPI; }

  function sampleGlyphs(cnv, words){
    const target = ['a','e','g','1','l','"',"‘","’","“","”"];
    const ctx = cnv.getContext('2d');
    const out = [];
    for(const w of words.slice(0,120)){
      const t = (w.text||'').trim();
      if(target.some(ch=> t.includes(ch))){
        const {x0,x1,y0,y1} = w.bbox;
        const wdt = x1-x0, h = y1-y0; if(wdt<=0||h<=0) continue;
        out.push({glyph:t[0], box:[x0,y0,wdt,h]});
      }
      if(out.length>24) break;
    }
    return out;
  }

  async function buildFeatures({source, fontCandidates, fontSizePx, lineGapPx, kerningSig, marginsMM, glyphSigs, layoutVec, extras={}}){
    const features = {
      id: `foa-${Date.now()}`,
      created_at: new Date().toISOString(),
      source, features:{
        font_candidates: fontCandidates,
        avg_font_size_px: round(fontSizePx),
        line_gap_px: round(lineGapPx),
        kerning_signature: kerningSig,
        margin_mm: marginsMM,
        glyph_signatures: glyphSigs
      }
    };
    const vec = (layoutVec||[]).map(x=> Number.isFinite(x)?Math.round(x*10)/10:0);
    features.fingerprint_hash = await sha256(JSON.stringify({source, vec, font:fontCandidates?.slice(0,3)}));
    features.vector = vec;
    features.extras = extras;
    // render UI
    renderJSON(features);
    renderPills(source);
    renderLayoutSummary(features);
    renderFontCandidates(features);
    renderMarginMap(features);
    renderGlyphGrid(features);
    renderLineGapChart(fontSizePx, lineGapPx);
    return features;
  }

  function round(x){ return Number.isFinite(x)? Math.round(x*10)/10 : null; }

  function renderJSON(f){ document.getElementById('jsonOut').value = JSON.stringify(f, null, 2); }
  function renderPills(source){
    const pill = document.getElementById('certaintyPill'); const dot= pill.querySelector('.dot');
    let lev='低', col='var(--acc-violet)';
    if(source==='DOCX') { lev='中'; col='var(--acc-violet)'; }
    if(source==='PDF/IMG') { lev='高'; col='var(--acc-sky)'; }
    if(source==='TXT') { lev='低'; col='var(--acc-lime)'; }
    dot.style.background = `var(${col})`;
    pill.lastChild && (pill.lastChild.textContent = '');
    pill.innerHTML = `<span class="dot" style="background:var(${col})"></span>${lev}（${source}）`;
  }
  function renderLayoutSummary(f){
    const ul = document.getElementById('layoutSummary'); ul.innerHTML='';
    const L = f.features;
    const items = [];
    if(L.avg_font_size_px) items.push(`平均フォント高: ${L.avg_font_size_px}px`);
    if(f.extras?.docxFontSizePt) items.push(`文字サイズ(DOCX): ${f.extras.docxFontSizePt.toFixed(1)}pt`);
    if(L.line_gap_px) items.push(`行間(概算): ${L.line_gap_px}px`);
    if(L.margin_mm){
      items.push(`余白(約mm) 左:${L.margin_mm.left?.toFixed?.(1)} 右:${L.margin_mm.right?.toFixed?.(1)}`);
      items.push(`余白(約mm) 上:${L.margin_mm.top?.toFixed?.(1)} 下:${L.margin_mm.bottom?.toFixed?.(1)}`);
    }
    if(f.extras?.docxMarginsPt){
      const m = f.extras.docxMarginsPt;
      items.push(`余白(DOCX pt) 上:${m.top.toFixed(1)} 下:${m.bottom.toFixed(1)} 左:${m.left.toFixed(1)} 右:${m.right.toFixed(1)}`);
    }
    if(!items.length) items.push('（解析データなし）');
    items.forEach(t=>{ const li=document.createElement('li'); li.textContent=t; ul.appendChild(li); });
  }
  function renderFontCandidates(f){
    const ul = document.getElementById('fontCandidates'); ul.innerHTML='';
    (f.features.font_candidates||[]).slice(0,3).forEach(c=>{
      const li=document.createElement('li'); li.textContent=`${c.name}  (${(c.score*100|0)}%)`;
      ul.appendChild(li);
    });
  }
  function renderMarginMap(f){
    const el = document.getElementById('marginMap'); el.innerHTML='';
    if(!f.features.margin_mm || (f.features.margin_mm.top == null && f.features.margin_mm.left == null)){
      const sourceType = f.source || '';
      const reason = sourceType === 'TXT' ? '（TXTファイルは版面情報を持ちません）' : '';
      el.innerHTML = `<div style="padding:1rem; text-align:center; color:var(--muted); font-size:0.875rem;">余白データがありません${reason}</div>`;
      el.style.aspectRatio = 'auto'; // Remove aspect ratio when no data
      el.style.minHeight = 'auto';
      el.style.height = 'auto';
      return;
    }
    el.style.aspectRatio = ''; // Reset to CSS default (1.414/1)
    el.style.minHeight = '';
    el.style.height = '';
    const mm = f.features.margin_mm;
    const box = document.createElement('div');
    box.style.position='absolute';
    box.style.inset='0';
    box.style.background='linear-gradient(135deg, #8b5cf622, #0ea5e922)';

    // Convert mm to percentage for visualization (scale: 1mm = ~1.6%, max 48%)
    // This makes typical margins (10-30mm) visually proportional
    function pct(val){
      if(!val || val <= 0) return 0;
      // Scale factor: 1.6 makes 10mm=16%, 20mm=32%, 30mm=48%
      return Math.min(val * 1.6, 48);
    }
    const top = pct(mm.top), bottom=pct(mm.bottom), left=pct(mm.left), right=pct(mm.right);

    // Content area (white box)
    const inner = document.createElement('div');
    inner.style.position='absolute';
    inner.style.left=`${left}%`;
    inner.style.right=`${right}%`;
    inner.style.top=`${top}%`;
    inner.style.bottom=`${bottom}%`;
    inner.style.background='var(--surface)';
    inner.style.border='2px solid var(--acc-sky)';
    inner.style.borderRadius='6px';
    inner.style.boxShadow='0 0 20px rgba(34, 211, 238, 0.3)';
    inner.style.display='flex';
    inner.style.alignItems='center';
    inner.style.justifyContent='center';
    inner.style.fontSize='0.75rem';
    inner.style.color='var(--muted)';
    inner.textContent='コンテンツ領域';
    box.appendChild(inner);

    // Margin labels and measurement lines
    const labelStyle = 'position:absolute; font-size:0.7rem; font-weight:600; color:var(--text); background:var(--card); padding:2px 6px; border-radius:4px; box-shadow:0 1px 3px rgba(0,0,0,0.1); white-space:nowrap; z-index:2;';
    const arrowStyle = 'position:absolute; pointer-events:none;';
    const arrowHeadSize = 6;

    // Calculate safe label positions (avoid clipping at edges)
    const safePos = (percent) => Math.max(8, Math.min(percent/2, 50)); // min 8%, max 50%

    // Top margin: arrow from content top edge upward
    if(mm.top != null && top > 0){
      const arrow = document.createElement('div');
      arrow.style.cssText = arrowStyle + `top:0; left:50%; width:2px; height:${top}%; background:var(--acc-violet); opacity:0.6; transform:translateX(-50%);`;
      // Arrow head (top)
      const head = document.createElement('div');
      head.style.cssText = `position:absolute; top:0; left:50%; width:0; height:0; border-left:${arrowHeadSize}px solid transparent; border-right:${arrowHeadSize}px solid transparent; border-bottom:${arrowHeadSize}px solid var(--acc-violet); transform:translateX(-50%); opacity:0.8;`;
      arrow.appendChild(head);
      box.appendChild(arrow);

      const topLabel = document.createElement('div');
      const topPos = safePos(top);
      topLabel.style.cssText = labelStyle + `top:${topPos}%; left:50%; transform:translate(-50%, -50%);`;
      topLabel.innerHTML = `上 <strong>${mm.top.toFixed(1)}mm</strong>`;
      box.appendChild(topLabel);
    }

    // Bottom margin: arrow from content bottom edge downward
    if(mm.bottom != null && bottom > 0){
      const arrow = document.createElement('div');
      arrow.style.cssText = arrowStyle + `bottom:0; left:50%; width:2px; height:${bottom}%; background:var(--acc-violet); opacity:0.6; transform:translateX(-50%);`;
      // Arrow head (bottom)
      const head = document.createElement('div');
      head.style.cssText = `position:absolute; bottom:0; left:50%; width:0; height:0; border-left:${arrowHeadSize}px solid transparent; border-right:${arrowHeadSize}px solid transparent; border-top:${arrowHeadSize}px solid var(--acc-violet); transform:translateX(-50%); opacity:0.8;`;
      arrow.appendChild(head);
      box.appendChild(arrow);

      const bottomLabel = document.createElement('div');
      const bottomPos = safePos(bottom);
      bottomLabel.style.cssText = labelStyle + `bottom:${bottomPos}%; left:50%; transform:translate(-50%, 50%);`;
      bottomLabel.innerHTML = `下 <strong>${mm.bottom.toFixed(1)}mm</strong>`;
      box.appendChild(bottomLabel);
    }

    // Left margin: arrow from content left edge leftward
    if(mm.left != null && left > 0){
      const arrow = document.createElement('div');
      arrow.style.cssText = arrowStyle + `left:0; top:50%; width:${left}%; height:2px; background:var(--acc-violet); opacity:0.6; transform:translateY(-50%);`;
      // Arrow head (left)
      const head = document.createElement('div');
      head.style.cssText = `position:absolute; left:0; top:50%; width:0; height:0; border-top:${arrowHeadSize}px solid transparent; border-bottom:${arrowHeadSize}px solid transparent; border-right:${arrowHeadSize}px solid var(--acc-violet); transform:translateY(-50%); opacity:0.8;`;
      arrow.appendChild(head);
      box.appendChild(arrow);

      const leftLabel = document.createElement('div');
      const leftPos = safePos(left);
      leftLabel.style.cssText = labelStyle + `left:${leftPos}%; top:50%; transform:translate(-50%, -50%);`;
      leftLabel.innerHTML = `左 <strong>${mm.left.toFixed(1)}mm</strong>`;
      box.appendChild(leftLabel);
    }

    // Right margin: arrow from content right edge rightward
    if(mm.right != null && right > 0){
      const arrow = document.createElement('div');
      arrow.style.cssText = arrowStyle + `right:0; top:50%; width:${right}%; height:2px; background:var(--acc-violet); opacity:0.6; transform:translateY(-50%);`;
      // Arrow head (right)
      const head = document.createElement('div');
      head.style.cssText = `position:absolute; right:0; top:50%; width:0; height:0; border-top:${arrowHeadSize}px solid transparent; border-bottom:${arrowHeadSize}px solid transparent; border-left:${arrowHeadSize}px solid var(--acc-violet); transform:translateY(-50%); opacity:0.8;`;
      arrow.appendChild(head);
      box.appendChild(arrow);

      const rightLabel = document.createElement('div');
      const rightPos = safePos(right);
      rightLabel.style.cssText = labelStyle + `right:${rightPos}%; top:50%; transform:translate(50%, -50%);`;
      rightLabel.innerHTML = `右 <strong>${mm.right.toFixed(1)}mm</strong>`;
      box.appendChild(rightLabel);
    }

    el.appendChild(box);
  }
  function renderGlyphGrid(f){
    const wrap = document.getElementById('glyphGrid'); wrap.innerHTML='';
    const glyphs = f.features.glyph_signatures || [];
    if(glyphs.length === 0){
      const sourceType = f.source || '';
      const reason = sourceType === 'TXT' ? '（TXTファイルは版面情報を持ちません）' : '（画像/PDFで検出）';
      wrap.innerHTML = `<div style="padding:1rem; text-align:center; color:var(--muted); font-size:0.875rem; grid-column:1/-1;">グリフデータがありません${reason}</div>`;
      wrap.style.minHeight = '80px';
      wrap.style.display = 'grid'; // Keep grid for proper layout
      return;
    }
    wrap.style.minHeight = '';
    wrap.style.display = '';
    const W=96,H=96;
    for(const g of glyphs){
      const container = document.createElement('div');
      container.style.cssText = 'display:flex; flex-direction:column; align-items:center; gap:4px;';

      const c = document.createElement('canvas');
      c.width=W; c.height=H;
      c.style.cssText = 'border:1px solid var(--line); border-radius:6px; background:var(--surface); width:96px; height:96px; min-height:unset;';

      const cx=c.getContext('2d');
      cx.fillStyle=getComputedStyle(document.documentElement).getPropertyValue('--surface');
      cx.fillRect(0,0,W,H);

      // Draw character large in center
      cx.fillStyle=getComputedStyle(document.documentElement).getPropertyValue('--text');
      cx.font='bold 48px system-ui';
      cx.textAlign='center';
      cx.textBaseline='middle';
      cx.fillText(g.glyph, W/2, H/2);

      // Draw bounding box indicator (small)
      cx.strokeStyle='var(--acc-sky)';
      cx.lineWidth=1.5;
      cx.strokeRect(8, 8, 20, 20);
      cx.fillStyle='var(--acc-sky)';
      cx.font='10px system-ui';
      cx.textAlign='left';
      cx.fillText('bbox', 10, 35);

      // Label below
      const label = document.createElement('div');
      label.style.cssText = 'font-size:0.75rem; color:var(--muted); font-weight:600;';
      label.textContent = `"${g.glyph}"`;

      container.appendChild(c);
      container.appendChild(label);
      wrap.appendChild(container);
    }
  }

  function renderLineGapChart(fontSizePx, lineGapPx){
    const canvas = document.getElementById('chartLineGap');
    const ctx = canvas.getContext('2d');
    // Set canvas internal resolution
    const w = canvas.width = Math.min(600, canvas.parentElement.clientWidth);
    const h = canvas.height = 120;
    // Set CSS display size to match
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';

    // Clear
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--surface');
    ctx.fillRect(0,0,w,h);

    // Get colors
    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text');
    const mutedColor = getComputedStyle(document.documentElement).getPropertyValue('--muted');
    const skyColor = getComputedStyle(document.documentElement).getPropertyValue('--acc-sky');
    const violetColor = getComputedStyle(document.documentElement).getPropertyValue('--acc-violet');

    // Data
    const data = [
      {label: 'フォント高', value: fontSizePx || 0, color: skyColor},
      {label: '行間', value: lineGapPx || 0, color: violetColor}
    ];

    const maxVal = Math.max(...data.map(d=>d.value), 1);
    const barWidth = Math.min(80, w / data.length / 2);
    const gap = (w - barWidth * data.length) / (data.length + 1);

    data.forEach((d, i)=>{
      const x = gap + i * (barWidth + gap);
      const barH = (d.value / maxVal) * (h - 40);
      const y = h - barH - 20;

      // Draw bar
      ctx.fillStyle = d.color;
      ctx.fillRect(x, y, barWidth, barH);

      // Draw value
      ctx.fillStyle = textColor;
      ctx.font = '12px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(`${d.value.toFixed(1)}px`, x + barWidth/2, y - 5);

      // Draw label
      ctx.fillStyle = mutedColor;
      ctx.font = '11px system-ui';
      ctx.fillText(d.label, x + barWidth/2, h - 5);
    });
  }

})();

/* ===== Compare tab ===== */
(function(){
  const fileLeft = document.getElementById('fileLeft');
  const fileRight = document.getElementById('fileRight');
  const canvasLeft = document.getElementById('canvasLeft');
  const canvasRight = document.getElementById('canvasRight');
  const ctxL = canvasLeft.getContext('2d'), ctxR = canvasRight.getContext('2d');
  const dropL = document.getElementById('dropLeft'), dropR = document.getElementById('dropRight');
  const btn = document.getElementById('btnCompare');
  const prog = document.getElementById('compareProgress');
  let featL=null, featR=null;

  ;['dragenter','dragover','dragleave','drop'].forEach(ev=>{
    [dropL, dropR].forEach(area=> area.addEventListener(ev, e=>{ e.preventDefault(); e.stopPropagation(); }));
  });
  ;['dragenter','dragover'].forEach(ev=> [dropL, dropR].forEach(a=>a.addEventListener(ev, ()=> a.classList.add('ring'))));
  ;['dragleave','drop'].forEach(ev=> [dropL, dropR].forEach(a=>a.addEventListener(ev, ()=> a.classList.remove('ring'))));

  dropL.addEventListener('drop', e=>{ if(e.dataTransfer.files?.[0]) fileLeft.files=e.dataTransfer.files; });
  dropR.addEventListener('drop', e=>{ if(e.dataTransfer.files?.[0]) fileRight.files=e.dataTransfer.files; });

  dropL.addEventListener('click', ()=> fileLeft.click());
  dropR.addEventListener('click', ()=> fileRight.click());

  fileLeft.addEventListener('change', ()=> {
    prog.textContent='左側ファイル読み込み中...';
    loadPreview(fileLeft.files[0], canvasLeft, ctxL).then(f=> {
      featL=f;
      prog.textContent='左側ファイル読み込み完了';
    }).catch(e=> {
      console.error('[比較] 左側ファイルエラー:', e);
      showToast(`左側ファイルの読み込みに失敗しました: ${e.message}`, 'error');
      prog.textContent='';
    });
  });
  fileRight.addEventListener('change', ()=> {
    prog.textContent='右側ファイル読み込み中...';
    loadPreview(fileRight.files[0], canvasRight, ctxR).then(f=> {
      featR=f;
      prog.textContent='右側ファイル読み込み完了';
    }).catch(e=> {
      console.error('[比較] 右側ファイルエラー:', e);
      showToast(`右側ファイルの読み込みに失敗しました: ${e.message}`, 'error');
      prog.textContent='';
    });
  });

  btn.addEventListener('click', ()=>{
    if(!featL||!featR){ showToast('両方のファイルを選択してください', 'warning'); return; }
    const cSpinner = document.getElementById('compareSpinner');
    cSpinner.classList.remove('hidden');
    prog.textContent='比較処理中...';
    const list = document.getElementById('diffList'); list.innerHTML='';

    try {
      function add(name, v){
        const li=document.createElement('li'); li.textContent = name + '：' + v; list.appendChild(li);
      }
      // Simple diff on vector distance
      const score = similarity(featL.vector||[], featR.vector||[]);
      const featLF = featL.features || {};
      const featRF = featR.features || {};
      add('フォント候補', overlap(featLF.font_candidates, featRF.font_candidates));
      add('フォント高(±px)', delta(featLF.avg_font_size_px, featRF.avg_font_size_px));
      add('行間(±px)', delta(featLF.line_gap_px, featRF.line_gap_px));
      document.getElementById('scoreBlock').textContent = (score*100).toFixed(1) + '%';
      cSpinner.classList.add('hidden');
      prog.textContent='比較完了';
    } catch(error) {
      console.error('[比較] エラー:', error);
      cSpinner.classList.add('hidden');
      prog.textContent='';
      showToast(`比較処理に失敗しました: ${error.message}`, 'error');
    }
  });

  function delta(a,b){ if(a==null||b==null) return '–'; return (Math.round((a-b)*10)/10).toString(); }
  function overlap(a=[],b=[]){ const A=a.map(x=>x.name), B=b.map(x=>x.name); return A.filter(x=>B.includes(x)).slice(0,3).join(', ')||'（なし）'; }
  function similarity(v1, v2){
    const n = Math.max(v1.length, v2.length);
    let dot=0,a=0,b=0;
    for(let i=0;i<n;i++){ const x=v1[i]||0, y=v2[i]||0; dot+=x*y; a+=x*x; b+=y*y; }
    return (a&&b)? (dot/Math.sqrt(a*b)) : 0;
  }

  async function loadPreview(file, canvas, ctx){
    const ext = file.name.toLowerCase().split('.').pop();
    let imgBitmap = null;

    if(ext==='pdf'){
      if(typeof pdfjsLib === 'undefined'){
        console.error('[Compare] PDF.jsライブラリが未定義です');
        console.error('[Compare] window.pdfjsLib:', window.pdfjsLib);
        throw new Error('PDF.jsライブラリが読み込まれていません');
      }
      console.log('[Compare] PDF.js使用開始');
      const ab = await readFileAsArrayBuffer(file);
      const pdf = await pdfjsLib.getDocument({data:ab}).promise;
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({scale: 1.5});
      const tmp = document.createElement('canvas'); tmp.width=viewport.width; tmp.height=viewport.height;
      await page.render({canvasContext: tmp.getContext('2d'), viewport}).promise;
      imgBitmap = await createImageBitmap(tmp);
    }else if(['png','jpg','jpeg'].includes(ext)){
      const url = await readFileAsDataURL(file);
      const img = new Image(); img.src = url; await img.decode();
      imgBitmap = await createImageBitmap(img);
    }

    // For PDF/Image: perform OCR analysis
    if(imgBitmap){
      const scale = Math.min(1, (canvas.parentElement.clientWidth-4)/imgBitmap.width);
      canvas.width = Math.round(imgBitmap.width * scale);
      canvas.height = Math.round(imgBitmap.height * scale);
      ctx.drawImage(imgBitmap, 0, 0, canvas.width, canvas.height);

      // Run OCR
      const ocr = await Tesseract.recognize(canvas, 'eng+jpn', {
        tessedit_pageseg_mode: 6,
        logger: info => console.log('[Compare OCR]', info.status, info.progress)
      });

      const words = ocr.data.words?.filter(w=>w.text?.trim()) || [];
      if(words.length === 0){
        return {vector:[canvas.width, canvas.height], features:{}};
      }

      // Compute metrics (same as analyze tab)
      const fontSizePx = median(words.map(w=>w.bbox.y1 - w.bbox.y0));
      const lineYs = clusterLines(words.map(w=> (w.bbox.y0 + w.bbox.y1)/2 ));
      const lineDeltas = diffs(lineYs);
      const lineGapPx = median(lineDeltas.filter(x=>x>1));
      const leftMarginPx = Math.min(...words.map(w=>w.bbox.x0));
      const rightMarginPx = canvas.width - Math.max(...words.map(w=>w.bbox.x1));
      const topMarginPx = Math.min(...words.map(w=>w.bbox.y0));
      const bottomMarginPx = canvas.height - Math.max(...words.map(w=>w.bbox.y1));

      const aspect = median(words.map(w=> (w.bbox.x1-w.bbox.x0)/(w.bbox.y1-w.bbox.y0+1) ));
      const fontCandidates = guessFont(aspect);

      return {
        vector:[fontSizePx, lineGapPx, leftMarginPx, rightMarginPx, topMarginPx, bottomMarginPx],
        features:{
          font_candidates: fontCandidates,
          avg_font_size_px: Math.round(fontSizePx*10)/10,
          line_gap_px: Math.round(lineGapPx*10)/10,
          margin_mm: {
            left: Math.round((leftMarginPx / 96) * 25.4 * 10)/10,
            right: Math.round((rightMarginPx / 96) * 25.4 * 10)/10,
            top: Math.round((topMarginPx / 96) * 25.4 * 10)/10,
            bottom: Math.round((bottomMarginPx / 96) * 25.4 * 10)/10
          }
        }
      };
    }

    if(ext==='docx'){
      const ab = await readFileAsArrayBuffer(file);
      const zip = await JSZip.loadAsync(ab);
      const docXml = await zip.file('word/document.xml')?.async('text') || '';
      const sectPr = /<w:sectPr[\s\S]*?<\/w:sectPr>/.exec(docXml)?.[0] || '';
      const margin = {
        top:   Number(/w:pgMar[^>]*w:top="(\d+)"/.exec(sectPr)?.[1]||0)/20,
        bottom:Number(/w:pgMar[^>]*w:bottom="(\d+)"/.exec(sectPr)?.[1]||0)/20,
        left:  Number(/w:pgMar[^>]*w:left="(\d+)"/.exec(sectPr)?.[1]||0)/20,
        right: Number(/w:pgMar[^>]*w:right="(\d+)"/.exec(sectPr)?.[1]||0)/20,
      };
      // Extract text from paragraphs (preserve paragraph breaks)
      const paragraphs = [...docXml.matchAll(/<w:p[^>]*>[\s\S]*?<\/w:p>/g)];
      const bodyLines = [];
      paragraphs.slice(0, 50).forEach(pMatch => {
        const textMatches = [...pMatch[0].matchAll(/<w:t[^>]*>(.*?)<\/w:t>/g)];
        const paraText = textMatches.map(m=>m[1]).join('');
        if(paraText.trim()) bodyLines.push(paraText.trim());
      });

      // Render preview page with body text
      const w=640,h=Math.round(w*1.414); canvas.width=w; canvas.height=h;
      const theme = getComputedStyle(document.documentElement);
      ctx.fillStyle=theme.getPropertyValue('--card'); ctx.fillRect(0,0,w,h);

      // Draw margin guide (pt to canvas px: A4 width = 595pt, canvas = 640px)
      const ptToPxScale = w / 595;
      const marginPx = {
        top: margin.top * ptToPxScale,
        bottom: margin.bottom * ptToPxScale,
        left: margin.left * ptToPxScale,
        right: margin.right * ptToPxScale
      };
      ctx.strokeStyle=theme.getPropertyValue('--acc-sky'); ctx.setLineDash([4,4]);
      ctx.strokeRect(marginPx.left, marginPx.top, w-marginPx.left-marginPx.right, h-marginPx.top-marginPx.bottom);
      ctx.setLineDash([]);

      // Draw body text with proper wrapping
      ctx.fillStyle=theme.getPropertyValue('--text');
      const fontSize = 14;
      const lineHeight = 22;
      ctx.font=`${fontSize}px "Noto Sans JP", "Yu Gothic", "Hiragino Sans", "MS PGothic", sans-serif`;
      const contentWidth = w - marginPx.left - marginPx.right - 20;
      const startY = marginPx.top + 20;
      const maxLines = Math.floor((h - marginPx.top - marginPx.bottom - 40) / lineHeight);

      let currentLine = 0;
      for(const para of bodyLines){
        if(currentLine >= maxLines) break;
        // Wrap text character by character for CJK support
        const wrapped = wrapTextCJK(ctx, para, contentWidth);
        for(const line of wrapped){
          if(currentLine >= maxLines) break;
          ctx.fillText(line, marginPx.left + 10, startY + currentLine * lineHeight);
          currentLine++;
        }
        currentLine++; // Add spacing between paragraphs
      }

      // Info overlay
      ctx.fillStyle='rgba(0,0,0,0.7)';
      ctx.fillRect(0, 0, w, 28);
      ctx.fillStyle=theme.getPropertyValue('--acc-sky');
      ctx.font='12px "Noto Sans JP", "Yu Gothic", "Hiragino Sans", "MS PGothic", sans-serif';
      ctx.fillText(`DOCX 1ページ目プレビュー（余白: 上${margin.top.toFixed(1)} 下${margin.bottom.toFixed(1)} 左${margin.left.toFixed(1)} 右${margin.right.toFixed(1)}pt）`, 10, 18);
      return {vector:[margin.top, margin.bottom, margin.left, margin.right], features:{margin_mm: margin}};
    }else if(ext==='txt'){
      const text = await readFileAsText(file);
      const w=640, pad=56; canvas.width=w; canvas.height=Math.max(360, Math.min(1600, Math.ceil(text.length/50)*24 + pad*2));
      const theme = getComputedStyle(document.documentElement);
      ctx.fillStyle=theme.getPropertyValue('--card'); ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.fillStyle=theme.getPropertyValue('--text'); const fontSize=16; const lh=1.6; ctx.font=`${fontSize}px "Noto Sans JP", system-ui`;
      const lines = (function wrap(context, text, maxW){ const words=text.split(/\s+/); const out=[]; let line=''; for(const w of words){ const t=line?line+' '+w:w; if(context.measureText(t).width>maxW){ out.push(line||w); line=w; } else line=t; } if(line) out.push(line); return out.slice(0,300); })(ctx,text,w-pad*2);
      lines.forEach((ln,i)=> ctx.fillText(ln, pad, pad + i*(fontSize*lh)));
      return {vector:[fontSize, lh, pad]};
    }else{
      alert('未対応'); return {vector:[0]};
    }
  }
})();

/* ===== Corpus tab ===== */
function renderCorpus(){
  const body = document.getElementById('corpusBody'); if(!body) return;
  const key='foa_corpus', list=JSON.parse(localStorage.getItem(key)||'[]');
  body.innerHTML='';
  list.forEach((f,i)=>{
    const tr=document.createElement('tr');
    const type=f.source, date=new Date(f.created_at).toLocaleString();
    const sum=`font ${(f.features.avg_font_size_px??'–')}px / gap ${(f.features.line_gap_px??'–')}px`;
    tr.innerHTML=`<td>${f.id}</td><td>${type}</td><td>${date}</td><td>${sum}</td>
    <td><button data-i="${i}" class="btn btn-mini">削除</button></td>`;
    body.appendChild(tr);
  });
  body.querySelectorAll('button').forEach(b=> b.addEventListener('click', ()=>{
    const idx=Number(b.dataset.i); const list=JSON.parse(localStorage.getItem(key)||'[]'); list.splice(idx,1); localStorage.setItem(key, JSON.stringify(list)); renderCorpus();
  }));
}
renderCorpus();

document.getElementById('btnExportCorpus').addEventListener('click', ()=>{
  const key='foa_corpus', list=localStorage.getItem(key)||'[]';
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');
  const minute = String(now.getMinutes()).padStart(2, '0');
  const second = String(now.getSeconds()).padStart(2, '0');
  const filename = `fontorigin_corpus_${year}${month}${day}_${hour}${minute}${second}.json`;
  console.log('[Export] Corpus filename:', filename);

  const blob=new Blob([list],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=filename;
  a.click();
  URL.revokeObjectURL(a.href);
});
document.getElementById('btnImportCorpus').addEventListener('click', ()=>{
  document.getElementById('importCorpus').click();
});
document.getElementById('importCorpus').addEventListener('change', async (e)=>{
  const file=e.target.files?.[0]; if(!file) return; const text=await readFileAsText(file);
  localStorage.setItem('foa_corpus', text); renderCorpus();
});

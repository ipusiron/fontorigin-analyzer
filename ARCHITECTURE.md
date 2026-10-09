# Architecture & Implementation Details

**FontOrigin Analyzer** の技術的な実装詳細、コアアルゴリズム、設計上の工夫を解説します。

---

## 📐 目次

1. [アーキテクチャ概要](#アーキテクチャ概要)
2. [コア技術スタック](#コア技術スタック)
3. [ファイル形式別の処理パイプライン](#ファイル形式別の処理パイプライン)
4. [特徴量抽出アルゴリズム](#特徴量抽出アルゴリズム)
5. [FontPrint生成ロジック](#fontprint生成ロジック)
6. [比較アルゴリズム](#比較アルゴリズム)
7. [UI/UX実装の工夫](#uiux実装の工夫)
8. [パフォーマンス最適化](#パフォーマンス最適化)
9. [セキュリティ設計](#セキュリティ設計)

---

## アーキテクチャ概要

### 設計原則

```
┌─────────────────────────────────────────────────────────┐
│                  ユーザー (Browser)                      │
├─────────────────────────────────────────────────────────┤
│  UI Layer (index.html)                                  │
│  - Tab Navigation                                       │
│  - File Upload (Drag & Drop)                           │
│  - Visualization (Canvas + Charts)                     │
├─────────────────────────────────────────────────────────┤
│  Logic Layer (script.js)                               │
│  ┌─────────────┬──────────────┬────────────────────┐  │
│  │ File Parser │ OCR Engine   │ Feature Extractor  │  │
│  ├─────────────┼──────────────┼────────────────────┤  │
│  │ PDF.js      │ Tesseract.js │ Layout Analyzer    │  │
│  │ JSZip       │              │ Font Guesser       │  │
│  └─────────────┴──────────────┴────────────────────┘  │
├─────────────────────────────────────────────────────────┤
│  Data Layer (localStorage)                             │
│  - FontPrint corpus (JSON)                             │
│  - Theme preference                                    │
└─────────────────────────────────────────────────────────┘
```

### 完全クライアント処理

**なぜサーバーレスか？**

1. **プライバシー保護**: 文書は機密情報を含む可能性が高い
2. **デプロイ容易性**: GitHub Pages で静的ホスティング可能
3. **スケーラビリティ**: サーバー負荷なし、同時接続制限なし
4. **オフライン動作**: 一度読み込めばネットワーク不要

**技術的課題と解決策:**

| 課題 | 解決策 |
|------|--------|
| 大容量PDFの処理 | PDF.js Web Worker でバックグラウンド実行 |
| OCR処理の重さ | Tesseract.js の段階的進捗表示 + キャンセル可能な実装 |
| メモリ不足 | Canvas解像度の動的調整、不要データの即座解放 |

---

## コア技術スタック

### 1. Tesseract.js (OCR)

**選定理由:**
- ブラウザーで動作する唯一の実用的OCRライブラリ
- WASM版で高速（Emscripten + WebAssembly）
- 日本語対応（`jpn` 言語パック）

**最適化ポイント:**

```javascript
// script.js:289-296
const ocr = await Tesseract.recognize(canvas, 'eng+jpn', {
  tessedit_pageseg_mode: mode === '高速' ? 3 : mode === '高精度' ? 6 : 1,
  // PSM (Page Segmentation Mode):
  // 1 = Automatic with OSD (デフォルト)
  // 3 = Fully automatic (高速だが精度低)
  // 6 = Assume uniform block of text (高精度)
  logger: info => {
    // 進捗表示でユーザー体験向上
    progressDiv.textContent = `${info.status} (${(info.progress*100|0)}%)`;
  }
});
```

**技巧的な実装:**
- **文字境界ボックスの活用**: `word.bbox` から文字の物理的配置を取得
- **ノイズフィルターリング**: 空白・記号を除外して純粋なテキスト領域のみ解析

### 2. PDF.js (PDF Rendering)

**課題: Worker設定の複雑さ**

PDF.jsはWorkerを使わないとメインスレッドがブロックされるが、GitHub Pagesでは同一オリジンポリシーの問題がある。

**解決策:**

```javascript
// index.html:387-389 (インライン設定)
if(typeof pdfjsLib !== 'undefined'){
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

// script.js:32-43 (冗長チェック)
if(!pdfjsLib.GlobalWorkerOptions.workerSrc){
  // フォールバック設定
}
```

**なぜ冗長チェックが必要か？**
- CDNの読み込み順序が保証されない
- スクリプトの非同期実行による競合状態を回避

### 3. JSZip (DOCX解析)

**DOCX = ZIP + XML**

```javascript
// script.js:320-350
const zip = await JSZip.loadAsync(arrayBuffer);
const docXml = await zip.file('word/document.xml').async('text');
const stylesXml = await zip.file('word/styles.xml')?.async('text') || '';

// XML解析（正規表現で高速パース）
const marginMatch = docXml.match(/<w:pgMar[^>]*w:top="(\d+)"[^>]*w:bottom="(\d+)"/);
const margin = {
  top: parseInt(marginMatch?.[1] || '1440') / 20,    // twip → pt (1/20)
  bottom: parseInt(marginMatch?.[2] || '1440') / 20,
  left: parseInt(marginMatch?.[3] || '1440') / 20,
  right: parseInt(marginMatch?.[4] || '1440') / 20
};
```

**技巧: twip単位の変換**

DOCXの余白は **twip** (1/1440 inch) 単位で保存されている：

```
twip → pt: ÷ 20
pt → px (A4基準): × (canvasWidth / 595)
pt → mm: × 0.3528
```

---

## ファイル形式別の処理パイプライン

### PDF → テキストレイヤー直読（OCRは画像PDFのフォールバック）

PDFはまず**テキストレイヤー**を直読する。電子PDFなら実フォント名・字サイズ・座標が正確に取れ、OCRの誤認を避けられる。テキストレイヤーが無い（スキャン/画像）PDFだけOCRに回す。判定は文字数（`totalChars < 6` ならOCR）。

```
┌──────────┐    ┌───────────────────────┐    ┌──────────────────────────┐
│  PDF     │───▶│ page.getTextContent()  │─┬─▶│ text items (pt座標)       │
│          │    │  + commonObjs(font名)  │ │  │ → 実フォント名/字サイズ    │
└──────────┘    └───────────────────────┘ │  └──────────────────────────┘
                   テキスト層なし ──────────┘            │（extractPdfTextFeatures）
                        ▼                                ▼
┌──────────┐    ┌──────────────┐    ┌──────────────┐
│ Canvas   │───▶│ Tesseract.js │───▶│ Word Bboxes  │  ← スキャン/画像PDF・画像
│ Render   │    │ (OCR)        │    │ {x,y,w,h}    │
└──────────┘    └──────────────┘    └──────────────┘
```

**特徴抽出（共通）**: フォント高＝median、行間＝median(クラスタ化した行の差分)、余白＝ページ端との差（テキスト層はpt→mm、OCRはpx→mm）、字形傾向＝横幅比。テキスト層ではフォント名を頻度で候補化（`core.js` の `fontCandidatesFromNames`）。

**コード実装:** `extractPdfTextFeatures()` / `analyzeNow()`（analyzeタブ）, OCR経路は同関数内のフォールバック。

### DOCX → XML解析

```
┌──────────┐    ┌──────────┐    ┌──────────────┐    ┌──────────────┐
│ .docx    │───▶│ JSZip    │───▶│ XML Extract  │───▶│ Regex Parse  │
│ (ZIP)    │    │ Unzip    │    │ document.xml │    │ <w:pgMar />  │
└──────────┘    └──────────┘    └──────────────┘    └──────────────┘
                                                              │
                                                              ▼
┌──────────────────────────────────────────────────────────────────┐
│ Feature Extraction (Direct)                                      │
├──────────────────────────────────────────────────────────────────┤
│ 1. Margins:     <w:pgMar> attributes (twip → mm)               │
│ 2. Font:        <w:rFonts> or <w:defRPr> tags                  │
│ 3. Font Size:   <w:sz w:val="24"/> (half-point units)          │
│ 4. Paragraphs:  <w:p> → <w:t> text extraction                  │
└──────────────────────────────────────────────────────────────────┘
```

**技巧: Canvas疑似レンダリング**

DOCXの本文テキストをCanvasに描画してプレビュー生成（script.js:358-428）：

```javascript
// 日本語フォントスタック（優先順）
ctx.font = '12px "Noto Sans JP", "Yu Gothic", "Hiragino Sans", "MS PGothic", sans-serif';

// CJK文字の折り返し（文字単位）
const bodyLines = [];
paragraphs.slice(0, 50).forEach(pMatch => {
  const paraText = /* XMLから抽出 */;
  const wrapped = wrapTextCJK(ctx, paraText, contentWidth);
  bodyLines.push(...wrapped);
});

// 余白ガイド線を描画（青点線）
ctx.setLineDash([5, 5]);
ctx.strokeStyle = '#3b82f6';
ctx.strokeRect(marginPx.left, marginPx.top, contentWidth, contentHeight);
```

### TXT → 仮想レンダリング

```
┌──────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ .txt     │───▶│ Encoding     │───▶│ Canvas Draw  │───▶│ Virtual Bbox │
│ (text)   │    │ Detection    │    │ (off-screen) │    │ Calculation  │
└──────────┘    └──────────────┘    └──────────────┘    └──────────────┘
                 UTF-8 / Shift_JIS                         (仮定ベース)
```

**技巧: 文字化け検出**

```javascript
// script.js:310-330
const hasMojibake = /[\uFFFD]|縺|�/.test(text);
if(hasMojibake){
  // Shift_JISで再試行
  const r2 = new FileReader();
  r2.readAsText(file, 'Shift_JIS');
}
```

**検出パターン:**
- `\uFFFD`: Unicode置換文字（デコード失敗）
- `縺`: 「あ」が Shift_JIS→UTF-8 誤変換された典型例
- `�`: 表示不可文字

---

## 特徴量抽出アルゴリズム

### 1. フォントサイズ推定

**課題:** OCRは文字の種類を認識するが、フォント名は取得できない

**アプローチ:** 文字境界ボックスの高さから推定

```javascript
// script.js:289-301
const heights = words
  .filter(w => w.text?.trim() && w.confidence > 60) // ノイズ除去
  .map(w => w.bbox.y1 - w.bbox.y0);

const fontSizePx = median(heights); // 中央値（外れ値に強い）
```

**なぜ中央値？**
- 平均値は見出し（大きい文字）に引っ張られる
- 中央値は本文の典型的なサイズを正確に捉える

### 2. 行間（Line Gap）推定

**アルゴリズム:**

```javascript
// script.js:303-312
// Step 1: 各単語のY座標中心を取得
const yCenters = words.map(w => (w.bbox.y0 + w.bbox.y1) / 2);

// Step 2: 近接する単語をクラスタリング（同一行とみなす）
const lines = clusterLines(yCenters); // 4px以内なら同じ行

// Step 3: 行間の差分を計算
const lineGaps = diffs(lines); // [line2-line1, line3-line2, ...]

// Step 4: 中央値を取得
const lineGapPx = median(lineGaps);
```

**技巧: クラスタリング関数**

```javascript
// script.js:277-284
function clusterLines(yCenters){
  const sorted = [...yCenters].sort((a,b) => a-b);
  const merged = [];
  for(const y of sorted){
    // 前の行から4px以上離れていたら新しい行
    if(!merged.length || y - merged[merged.length-1] > 4){
      merged.push(y);
    }
  }
  return merged;
}
```

**なぜ4px？**
- 一般的なフォントで、同一行内の文字は垂直方向に±2px程度しかずれない
- 4pxは経験的に最適な閾値（OCRノイズを吸収しつつ誤結合を防ぐ）

### 3. 余白（Margin）推定

**アルゴリズム:**

```javascript
// script.js:314-328
const leftMarginPx = Math.min(...words.map(w => w.bbox.x0)); // 最左端
const rightMarginPx = canvas.width - Math.max(...words.map(w => w.bbox.x1)); // 最右端
const topMarginPx = Math.min(...words.map(w => w.bbox.y0)); // 最上端
const bottomMarginPx = canvas.height - Math.max(...words.map(w => w.bbox.y1)); // 最下端

// px → mm 変換 (A4基準: 210mm = canvas幅)
const pxToMm = 210 / canvas.width;
const marginMm = {
  left: leftMarginPx * pxToMm,
  right: rightMarginPx * pxToMm,
  top: topMarginPx * pxToMm,
  bottom: bottomMarginPx * pxToMm
};
```

**技巧: A4基準の正規化**

なぜA4（210mm幅）を基準にするか？
- PDFやスキャン画像の解像度はバラバラ（72dpi, 150dpi, 300dpi...）
- A4サイズで正規化することで、異なる解像度の文書を比較可能に

### 4. フォント推定（Heuristic）

**アルゴリズム:**

```javascript
// script.js:286-302
function guessFont(aspect){
  // aspect = 平均文字幅 / 平均文字高さ

  // Serif (明朝・Times): 縦長（aspect < 1.0）
  const serifScore = clamp((1.1 - aspect), 0, 1);

  // Sans-serif (ゴシック・Arial): 横長（aspect > 1.0）
  const sansScore = clamp((aspect - 0.9), 0, 1);

  // 正規化
  const norm = serifScore + sansScore || 1;

  return [
    {name:'Serif-like', score: serifScore/norm},
    {name:'Sans-like', score: sansScore/norm * 0.9}, // 若干ペナルティ
    {name:'Mono-like', score: 0.1} // 固定幅は稀
  ].sort((a,b) => b.score - a.score);
}
```

**根拠:**

| フォント | 典型的なアスペクト比 |
|---------|---------------------|
| Times New Roman | 0.85 - 0.95 |
| 游明朝 | 0.90 - 1.00 |
| Arial | 1.00 - 1.10 |
| Yu Gothic | 0.95 - 1.05 |
| Consolas (等幅) | 0.60 - 0.65 |

**制約:**
- OCRでは実際のフォント名を取得できないため、あくまで「らしさ」の推定
- より高度な判別には機械学習モデルが必要

---

## FontPrint生成ロジック

### FontPrintのデータ構造

```javascript
// script.js:397-432
{
  "id": "doc_1738742891234",        // timestamp-based ID
  "created_at": "2025-10-05T12:34:56.789Z",
  "source": "PDF/IMG" | "DOCX" | "TXT",
  "certainty": "高" | "中" | "低",     // 信頼度レベル

  "features": {
    "font_candidates": [
      {"name": "Serif-like", "score": 0.75},
      {"name": "Sans-like", "score": 0.25}
    ],
    "avg_font_size_px": 14.5,
    "line_gap_px": 6.2,
    "margin_mm": {
      "top": 25.4,
      "bottom": 25.4,
      "left": 31.8,
      "right": 31.8
    },
    "glyph_signatures": [
      {"char": "a", "bbox": {...}, "aspect": 0.95},
      // ... 代表的な文字5-10個
    ]
  },

  "fingerprint_hash": "a3f5b2...",  // SHA-256 (正規化後の特徴量)
  "vector": [14.5, 6.2, 31.8, 31.8, 25.4, 25.4]  // 数値特徴ベクトル
}
```

### ハッシュ生成アルゴリズム

**目的:** 同一文書の再解析でも同じハッシュを生成（再現性）

```javascript
// script.js:415-420
const normalizedFeatures = {
  font: Math.round(avgFontSizePx * 10) / 10,  // 小数第1位まで
  gap: Math.round(lineGapPx * 10) / 10,
  margin: {
    top: Math.round(marginMm.top),    // 整数に丸め
    bottom: Math.round(marginMm.bottom),
    left: Math.round(marginMm.left),
    right: Math.round(marginMm.right)
  }
};

const fingerprintStr = JSON.stringify(normalizedFeatures);
const hash = await sha256(fingerprintStr); // SHA-256
```

**正規化の理由:**
- OCRの微細なノイズ（14.48px vs 14.52px）を吸収
- 同一文書の複数スキャンでも同じハッシュを生成

### 特徴ベクトル構築

```javascript
// script.js:425-432
const vector = [
  avgFontSizePx,      // [0] フォントサイズ
  lineGapPx,          // [1] 行間
  marginMm.left,      // [2] 左余白
  marginMm.right,     // [3] 右余白
  marginMm.top,       // [4] 上余白
  marginMm.bottom     // [5] 下余白
];
```

**次元削減の理由:**
- 6次元ベクトルで文書の「版面指紋」を表現
- コサイン類似度計算が高速（O(n)）
- 可視化・クラスタリングに適した低次元空間

---

## 比較アルゴリズム

### コサイン類似度

**数式:**

```
similarity = (v1 · v2) / (||v1|| × ||v2||)

where:
  v1 · v2 = Σ(v1[i] × v2[i])          // 内積
  ||v|| = √(Σ(v[i]²))                 // ノルム
```

**実装:**

```javascript
// script.js:1163-1177
function cosineSimilarity(v1, v2){
  if(v1.length !== v2.length) return 0;

  let dot = 0;      // 内積
  let norm1 = 0;    // v1のノルム²
  let norm2 = 0;    // v2のノルム²

  for(let i = 0; i < v1.length; i++){
    dot += v1[i] * v2[i];
    norm1 += v1[i] * v1[i];
    norm2 += v2[i] * v2[i];
  }

  return dot / (Math.sqrt(norm1) * Math.sqrt(norm2));
}
```

**スコアの解釈:**

| スコア | 解釈 |
|--------|------|
| 0.95 - 1.00 | ほぼ同一（同じテンプレート） |
| 0.85 - 0.95 | 非常に類似（同じ組織・ソフト） |
| 0.70 - 0.85 | 類似（共通の癖あり） |
| 0.50 - 0.70 | やや類似 |
| 0.00 - 0.50 | 異なる |

**技巧: 重み付けコサイン類似度（将来拡張）**

現在は全次元を等価に扱っているが、以下の重み付けも可能：

```javascript
const weights = [
  1.5,  // フォントサイズ（最重要）
  1.2,  // 行間
  1.0,  // 左余白
  1.0,  // 右余白
  0.8,  // 上余白（ヘッダー影響で変動しやすい）
  0.8   // 下余白（フッター影響で変動しやすい）
];

const weightedDot = v1.reduce((sum, val, i) =>
  sum + (v1[i] * v2[i] * weights[i] * weights[i]), 0
);
```

---

## UI/UX実装の工夫

### 1. ポータルツールチップ

**課題:** `overflow:hidden` や `z-index` スタックコンテキストでツールチップが隠れる

**解決策:** ツールチップを `document.body` に直接レンダリング

```javascript
// script.js:147-199
function moveTooltipsToBody(){
  document.querySelectorAll('.tooltip').forEach(tip => {
    if(tip.parentElement !== document.body){
      document.body.appendChild(tip); // ポータル転送
    }
  });
}

function place(btn, tip){
  const rect = btn.getBoundingClientRect();
  let top = rect.bottom + 10;
  let left = Math.min(
    Math.max(10, rect.left),
    window.innerWidth - tip.offsetWidth - 10
  );

  // ビューポート外なら上に表示（フリップ）
  if(top + tip.offsetHeight > window.innerHeight - 10){
    top = rect.top - tip.offsetHeight - 10;
  }

  tip.style.top = `${top}px`;
  tip.style.left = `${left}px`;
}
```

**メリット:**
- あらゆる要素の上に表示可能（`z-index:9999`）
- アコーディオン内のツールチップも正常動作

### 2. テーマトグル（次のモードアイコン表示）

**UXパターン:** ボタンに「現在のモード」ではなく「次のモード」のアイコンを表示

```javascript
// script.js:76-87
function apply(theme){
  const isDark = theme === 'dark';
  root.classList.toggle('dark', isDark);

  const next = isDark ? 'light' : 'dark'; // 次に切り替わるモード
  btn.querySelector('svg').innerHTML = (next === 'dark') ? moon : sun;
  // ダークモード中は☀️（タップで明るくなる）
  // ライトモード中は🌙（タップで暗くなる）
}
```

**認知心理学的根拠:**
- ユーザーは「これから何が起こるか」を知りたい
- 現在の状態表示より、次の動作の予告の方が直感的

### 3. アコーディオンの滑らかな展開

```css
/* style.css:446-458 */
.acc-content{
  animation: slideDown 0.2s ease-out;
}

@keyframes slideDown{
  from{
    opacity:0;
    transform:translateY(-8px); /* 上から下へスライド */
  }
  to{
    opacity:1;
    transform:translateY(0);
  }
}
```

**技巧:** `<details>` 要素の標準動作は即座展開だが、CSSアニメーションで上書き

### 4. CJK文字の折り返し処理

**課題:** 英語の `word-break` は日本語に適用できない（単語境界がない）

**解決策:** 文字単位の折り返し

```javascript
// script.js:222-245
function wrapTextCJK(ctx, text, maxWidth){
  const lines = [];
  let line = '';

  for(let i = 0; i < text.length; i++){
    const char = text[i];
    const testLine = line + char;
    const metrics = ctx.measureText(testLine);

    if(metrics.width > maxWidth && line.length > 0){
      lines.push(line);      // 現在行を確定
      line = char;           // 次の行を開始
    } else {
      line = testLine;
    }
  }

  if(line) lines.push(line);
  return lines.slice(0, 200); // 安全上限（メモリ保護）
}
```

**パフォーマンス:**
- 1文字ごとに `measureText()` 呼び出し → O(n)
- 200行制限で最悪ケースでも許容範囲

---

## パフォーマンス最適化

### 1. Canvas解像度の適応制御

**課題:** 高解像度画像（4K, 300dpi）でメモリ不足

**解決策:** 動的ダウンスケール

```javascript
// script.js:464-478 (PDF rendering)
const viewport = page.getViewport({scale: 1.0});
let scale = 1.0;

// 幅が2000pxを超えたらスケール調整
if(viewport.width > 2000){
  scale = 2000 / viewport.width;
}

const scaledViewport = page.getViewport({scale});
canvas.width = scaledViewport.width;
canvas.height = scaledViewport.height;
```

**トレードオフ:**
- 解像度 ↓ → メモリ使用量 ↓, OCR精度 ↓
- 2000px は OCR品質を維持しつつメモリを節約する最適値

### 2. OCR進捗表示

```javascript
// script.js:289-296
Tesseract.recognize(canvas, 'eng+jpn', {
  logger: info => {
    const status = info.status;          // "recognizing text"
    const progress = info.progress;      // 0.0 - 1.0
    progressDiv.textContent = `${status} (${Math.floor(progress*100)}%)`;
  }
});
```

**UX効果:**
- 処理が「止まっている」と誤解されるのを防ぐ
- 大きなPDFでも安心して待てる

### 3. Web Worker活用

**PDF.js Worker:**

```javascript
// index.html:388
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
```

**効果:**
- PDFパース処理がバックグラウンドスレッドで実行
- UIスレッドがブロックされない（スクロール・ボタン操作可能）

**Tesseract.js Worker:**

Tesseract.jsは自動的にWorkerを使用（内部実装）:
- WASM実行がWorkerで隔離
- メインスレッドへの影響最小化

---

## セキュリティ設計

### 1. Content Security Policy (CSP)

`index.html` の `<head>` に meta タグで宣言している（GitHub Pagesはレスポンスヘッダーを設定できないため、metaが唯一の手段）。

```html
<meta http-equiv="Content-Security-Policy" content="
  default-src 'self';
  script-src 'self' blob: 'wasm-unsafe-eval' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com;
  worker-src 'self' blob:;
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob:;
  font-src 'self' data:;
  connect-src 'self' blob: data: https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://tessdata.projectnaptha.com;
  object-src 'none';
  base-uri 'self';
" />
```

**許可している理由:**

| ディレクティブ | 理由 |
|---------------|------|
| `script-src 'wasm-unsafe-eval'` | Tesseract.jsのWASMコンパイルに必要な最小権限。`'unsafe-eval'` は許可しない |
| `script-src blob:` / `worker-src blob:` | PDF.js・Tesseract.jsのBlob URLワーカー |
| `img-src data: blob:` | `canvas.toDataURL()`（グリフのサムネイル）、OCR入力画像 |
| `connect-src ... tessdata.projectnaptha.com` | Tesseractの言語データの取得先 |
| `style-src 'unsafe-inline'` | ガイドタブなどの静的 `style` 属性に必要 |

**制限している項目:**
- `object-src 'none'`: プラグイン埋め込み禁止
- `base-uri 'self'`: `<base>` の乗っ取り防止

> metaタグでは無効になる `frame-ancestors` / `X-Frame-Options` / `X-Content-Type-Options` は宣言しない（SECURITY.md参照）。

### 2. Subresource Integrity (SRI)

3本のCDNスクリプトすべてに `integrity`（sha384）と `crossorigin` を付与している。

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"
        integrity="sha384-/1qUCSGwTur9vjf/z9lmu/eCUYbpOTgSjmpbMQZ1/CtX2v/WcAIKqRv+U1DUCG6e"
        crossorigin="anonymous"></script>
```

**効果:**
- CDNが侵害されても、ハッシュ不一致でブラウザーが実行をブロックする
- PDF.jsワーカー・Tesseractの言語データは実行時取得のためSRI対象外で、CSPの `connect-src` / `worker-src` で取得先を制限する

### 3. XSS対策（コーパスのインポート）

コーパスJSONは外部から持ち込まれる唯一のデータである。`core.js` の `sanitizeFontPrint()` が既知のキーだけを持つオブジェクトに再構築し、値をプリミティブへ強制する。

```javascript
// core.js
function sanitizeFontPrint(entry){
  // source が許可値でなければ null（エントリーを破棄）
  // id/created_at は文字列スライス、数値は Number()、余計なキーは捨てる
}
```

描画は必ずDOM API＋`textContent` で行い、インポート値を `innerHTML` に渡さない。

```javascript
// script.js renderCorpus(): 旧 tr.innerHTML=`...${f.id}...` を廃止
const td = document.createElement('td');
td.textContent = f.id;   // <img onerror=...> を仕込んでも文字列として表示される
tr.appendChild(td);
```

`localStorage` から読むときも毎回 `parseCorpus()` でサニタイズする（手編集された値を信頼しない）。

### 4. ファイルの検証

拡張子のホワイトリスト（`pdf/png/jpg/jpeg/docx/txt`）で弾く。解析はすべてクライアント内で完結し、ファイルは実行されないため影響は限定的である。

```javascript
// script.js
const ALLOWED_EXT = ['pdf','png','jpg','jpeg','docx','txt'];
if(!ALLOWED_EXT.includes(extOf(file))){ showToast(t('toastBadType'),'error'); return; }
```

---

## 拡張性のための設計

### プラグイン可能なアーキテクチャ

**現在の実装:**

```javascript
// 将来的にプラグイン化可能な構造
const analyzers = {
  'pdf': analyzePDF,
  'image': analyzeImage,
  'docx': analyzeDOCX,
  'txt': analyzeTXT
};

const extension = file.name.split('.').pop().toLowerCase();
const analyzer = analyzers[extension] || analyzers['image'];
```

**将来の拡張案:**

1. **新しいファイル形式対応**
   ```javascript
   analyzers['odt'] = analyzeODT; // OpenDocument Text
   analyzers['rtf'] = analyzeRTF; // Rich Text Format
   ```

2. **機械学習モデル統合**
   ```javascript
   import * as tf from '@tensorflow/tfjs';

   async function predictFont(glyphs){
     const model = await tf.loadLayersModel('/models/font-classifier.json');
     const tensor = tf.tensor(glyphs);
     const prediction = model.predict(tensor);
     return prediction.dataSync();
   }
   ```

3. **クラウド連携（オプション）**
   ```javascript
   if(userOptIn){
     await fetch('/api/corpus', {
       method: 'POST',
       body: JSON.stringify(fontPrint)
     });
   }
   ```

---

## デバッグ・開発ツール

### コンソールログ戦略

```javascript
// 統一的なログプレフィックス
console.log('[Init] Checking libraries...');
console.log('[PDF.js] Worker configured');
console.log('[Analyze] File type:', file.type);
console.log('[Compare] Similarity:', score.toFixed(2));
```

**メリット:**
- ブラウザーDevToolsでフィルターリング可能
- 問題発生時のデバッグが容易

### ブレークポイント推奨箇所

```javascript
// 1. ファイル解析開始
async function analyzeFile(file){ // script.js:438
  debugger; // ← ここでファイル情報確認
}

// 2. OCR結果取得
const words = ocr.data.words; // script.js:497
debugger; // ← ここでword bboxes確認

// 3. 特徴量抽出
const vector = buildFeatures(...); // script.js:603
debugger; // ← ここで生成されたFontPrint確認
```

---

## おわりに

本ドキュメントでは、FontOrigin Analyzer の主要な技術的実装を解説しました。

**設計の核心:**
- **完全クライアント処理** によるプライバシー保護
- **OCR + XMLパース** の組み合わせによる多様なファイル対応
- **コサイン類似度** による高速な文書比較
- **段階的プログレッシブエンハンスメント** による優れたUX

**今後の発展方向:**
- 機械学習モデルによるフォント識別精度向上
- より多くのファイル形式対応（ODT, RTF, Pages）
- ブラウザー拡張機能化（ワンクリック解析）
- デスクトップアプリ化（Electron）

貢献・フィードバックは [GitHub Issues](https://github.com/ipusiron/fontorigin-analyzer/issues) でお待ちしています。

---

**関連ドキュメント:**
- [README.md](README.md) - プロジェクト概要・使い方
- [SECURITY.md](SECURITY.md) - セキュリティポリシー
- [CLAUDE.md](CLAUDE.md) - Claude Code向けプロジェクト指示

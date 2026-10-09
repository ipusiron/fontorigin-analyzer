# サンプルファイル（実験用）

FontOrigin Analyzer を試すためのサンプルです。どれも架空の内容で、個人情報は含みません。

| ファイル | 形式 | 確からしさ | ねらい |
|---|---|---|---|
| `letter-helvetica.pdf` | テキストPDF | 高 | テキストレイヤー直読。フォント名 **Helvetica** が出る |
| `letter-times.pdf` | テキストPDF | 高 | 本文・余白は同じでフォントだけ **Times-Roman**。`letter-helvetica.pdf` と比較用 |
| `letter-wide-margin.pdf` | テキストPDF | 高 | フォントは同じで余白だけ広い。余白差の比較用 |
| `scan-notice.png` | 画像 | 高 | スキャン風の画像。**OCR経路**（Tesseract）の確認用 |
| `memo.docx` | DOCX | 中 | `word/document.xml` から余白（上下25mm・左右20mm）と文字サイズ（11pt）を抽出 |
| `notes.txt` | TXT | 低 | 版面情報なし。仮想レンダリングと「低」確からしさの確認用 |

## 試し方

### 解析タブ
- `letter-helvetica.pdf` を解析すると、レイアウト要約に「抽出方法: テキストレイヤー（高精度）」と出て、フォント候補が実名（Helvetica）になる。
- `scan-notice.png` はテキストレイヤーが無いので **OCR** にフォールバックする（抽出方法が「OCR」になる）。
- `notes.txt` は確からしさ「低」。

### 比較タブ
- `letter-helvetica.pdf` × `letter-times.pdf` … 本文・余白が同じでフォントだけ違う。フォント候補の不一致を見る。
- `letter-helvetica.pdf` × `letter-wide-margin.pdf` … フォントは同じで余白が違う。余白差とスコアの動きを見る。

> ⚠ 解析結果は「推定の手がかり」です。単独で真偽を断定せず、複数の特徴と他の証拠を併せて判断してください。

# Security Policy

## セキュリティポリシー

### 対象範囲

**FontOrigin Analyzer** は教育・学習・研究目的のデモンストレーションツールです。本番環境や業務用途での使用は想定していません。

### セキュリティ対策

#### 実装済み対策

1. **Content Security Policy (CSP)**
   - `index.html` の `<meta http-equiv="Content-Security-Policy">` で宣言している
   - `default-src 'self'` を基本とし、`script-src` は `'self' blob: 'wasm-unsafe-eval' cdn.jsdelivr.net cdnjs.cloudflare.com` に限定
   - `'wasm-unsafe-eval'` はTesseract.jsのWASM実行に必要な最小権限で、`'unsafe-eval'` は許可していない
   - `object-src 'none'` / `base-uri 'self'` を指定
   - GitHub Pagesはレスポンスヘッダーを設定できないため、metaタグが唯一の手段である。metaタグでは無効になる `X-Frame-Options` / `X-Content-Type-Options` / `frame-ancestors` は宣言しない（後述）

2. **Subresource Integrity (SRI)**
   - Tesseract.js / PDF.js / JSZip の3本すべてに `integrity="sha384-..."` と `crossorigin="anonymous"` を付与
   - バージョン固定URLなのでハッシュは安定し、CDN侵害時は改ざんスクリプトがブロックされる
   - PDF.jsワーカー・Tesseractの言語データは `<script>` 経由ではなく実行時に取得されるためSRIの対象外。取得先は上記CSPの `connect-src` / `worker-src` で制限している

3. **XSS対策（コーパスのインポート）**
   - コーパスJSONのインポート値は `core.js` の `sanitizeFontPrint()` で型を強制し、既知のキーだけを持つオブジェクトに再構築する
   - 表描画はすべてDOM API＋`textContent` で行い、インポート値を `innerHTML` に渡さない（格納型XSSの遮断）
   - `localStorage` から読むときも毎回サニタイズする（手編集された値を信頼しない）

4. **クライアントサイド完結**
   - ファイル解析は100%ブラウザー内で完結
   - サーバーへのデータ送信なし
   - コーパスは `localStorage` に保存（端末内のみ）

#### GitHub Pagesでは設定できない項目

次のヘッダーはHTTPレスポンスヘッダーでのみ有効で、metaタグでは無視される。GitHub Pagesはヘッダーを設定できないため本ツールでは**宣言していない**（宣言しても誤った安心感を与えるだけである）。

- `X-Frame-Options` / CSP `frame-ancestors`（クリックジャッキング対策）
- `X-Content-Type-Options: nosniff`
- `Permissions-Policy`

自己ホスティングする場合は、Webサーバー側でこれらのヘッダーを付与することを推奨する。

#### 既知の制限事項

1. **ブラウザーキャッシュ**
   - アップロードされたファイルはブラウザーメモリに一時保持されます
   - ブラウザー履歴やキャッシュに痕跡が残る可能性があります

2. **CDN依存**
   - Tesseract.js、PDF.js、JSZipは外部CDNから読み込みます
   - CDNが侵害された場合のリスクがあります（SRIで軽減）

3. **OCR精度**
   - Tesseract.jsのOCR結果には誤認識が含まれる可能性があります
   - フォレンジック用途での単独利用は推奨しません

### 使用上の注意

#### ❌ 絶対にアップロードしないでください

- 個人情報を含む文書（マイナンバー、パスポート、契約書など）
- 機密情報（企業秘密、未公開情報、内部資料など）
- 業務文書（社内メモ、議事録、報告書など）
- 法的証拠価値のある文書

#### ✅ 推奨される使用例

- 公開されている文書のフォーマット分析
- 自作サンプル文書でのテスト
- 教育・学習目的のデモンストレーション
- OSINT（公開情報）の補助分析

### 業務利用時の推奨事項

業務や機密性の高い調査で使用する場合は、以下を強く推奨します：

1. **ローカル環境で実行**
   ```bash
   git clone https://github.com/ipusiron/fontorigin-analyzer.git
   cd fontorigin-analyzer
   python -m http.server 8000
   # http://localhost:8000 にアクセス
   ```

2. **ネットワーク分離**
   - インターネット接続を切断した環境で実行
   - 必要に応じてCDNライブラリを事前ダウンロード・自己ホスティング

3. **データ削除**
   - 使用後はブラウザーキャッシュとlocalStorageをクリア
   - プライベートブラウジングモードの使用を検討

### 免責事項

- 本ツールは「現状のまま」提供されます
- 解析結果の正確性を保証しません
- 本ツールの使用によって生じた損害について、開発者は一切の責任を負いません
- 法的証拠としての使用は推奨しません（補助ツールとしてのみ使用してください）

### ライセンス

本プロジェクトはMITライセンスの下で提供されています。詳細はLICENSEファイルを参照してください。

---

**最終更新**: 2026年10月9日
**バージョン**: 1.1.0

# Security Policy

## セキュリティポリシー

### 対象範囲

**FontOrigin Analyzer** は教育・学習・研究目的のデモンストレーションツールです。本番環境や業務用途での使用は想定していません。

### セキュリティ対策

#### 実装済み対策

1. **Content Security Policy (CSP)**
   - `default-src 'self'` による厳格なリソース制限
   - 外部CDNは必要最小限のドメインのみ許可
   - インラインスクリプトは最小限に抑制（Tesseract/PDF.js worker用のみ）

2. **Subresource Integrity (SRI)**
   - PDF.js: SHA-512ハッシュ検証
   - JSZip: SHA-384ハッシュ検証
   - Tesseract.js: SHA-384ハッシュ検証
   - ※ Tailwind CDNはSRI未対応のため注意喚起コメント追加

3. **セキュリティヘッダー**
   - `X-Content-Type-Options: nosniff`
   - `X-Frame-Options: DENY`
   - `Referrer-Policy: strict-origin-when-cross-origin`
   - `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`

4. **XSS対策**
   - ユーザー入力は`textContent`で安全に処理
   - `innerHTML`使用箇所は内部データ・制御されたCSS変数のみ
   - 外部入力の直接DOM挿入を回避

5. **クライアントサイド完結**
   - ファイル解析は100%ブラウザー内で完結
   - サーバーへのデータ送信なし
   - localStorage使用（端末内のみ保存）

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

**最終更新**: 2025年10月5日
**バージョン**: 1.0.0

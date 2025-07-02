# GitHub Secrets設定ガイド

## 必要なSecrets

GitHub Actionsでテストを実行するために、以下のSecretsを設定する必要があります。

### 1. SERVICE_ACCOUNT_JSON

Google Cloud Platformのサービスアカウントキー（JSON形式）の内容全体。

**設定方法:**
1. サービスアカウントキーのJSONファイルを開く
2. 内容全体をコピー
3. GitHubリポジトリの Settings > Secrets and variables > Actions
4. "New repository secret" をクリック
5. Name: `SERVICE_ACCOUNT_JSON`
6. Value: JSONファイルの内容全体を貼り付け

### 2. TEST_SHEET_ID

テスト用Google SpreadsheetのID。

**例:** `1VC9TXYw6ONEkTRdj1kCBQQLj4Kp8AAohd7_9Eb2HUdI`

**取得方法:**
- Google SpreadsheetsのURLから抽出
- `https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit`

### 3. TEST_SHEET_NAME

テスト用シートの名前。

**例:** `testing`

## セキュリティに関する注意事項

- サービスアカウントキーは機密情報です
- 最小権限の原則に従い、テスト用スプレッドシートへのアクセスのみ許可
- 定期的にキーをローテーション

## テスト用スプレッドシートの準備

1. 新しいGoogle Spreadsheetを作成
2. サービスアカウントのメールアドレスに編集権限を付与
3. テスト用のシート名を設定（例: `testing`）
4. シートは自動的にテストデータで初期化されます
# Google Sheet Batch Assistant MCP Server

AI エージェントが Google Spreadsheets のデータを効率的に読み書きするための MCP (Model Context Protocol) サーバーです。

## 特徴

- **バッチ処理**: 5秒間隔でまとめて更新し、API Quota を節約
- **複数エージェント対応**: ロック機構で同時作業が可能
- **自動リトライ**: ネットワークエラーに対して最大3回リトライ
- **グレースフルシャットダウン**: 終了時に未処理の更新を実行

## インストール

```bash
npm install -g google-sheet-batch-assistant-mcp
```

または、ローカルでビルド:

```bash
git clone https://github.com/ideamans/node-google-sheet-batch-assistant-mcp.git
cd node-google-sheet-batch-assistant-mcp
yarn install
yarn build
npm link
```

## 使用方法

### 1. サービスアカウントの準備

1. [Google Cloud Console](https://console.cloud.google.com) でプロジェクトを作成
2. Google Sheets API を有効化
3. サービスアカウントを作成し、JSON キーをダウンロード
4. 対象のスプレッドシートにサービスアカウントのメールアドレスを編集者として追加

### 2. サーバーの起動

```bash
google-sheet-batch-assistant-mcp <spreadsheetId> <sheetName> [options]
```

#### オプション

- `--service-account <path>`: サービスアカウント JSON ファイルのパス（デフォルト: ./service-account.json）
- `--log-file <path>`: ログファイルのパス（デフォルト: ./google-sheet-batch-assistant-mcp.log）
- `--read-interval <ms>`: 読み込み間隔（デフォルト: 5000）
- `--batch-interval <ms>`: バッチ更新間隔（デフォルト: 5000）

### 3. MCP クライアントからの使用

```javascript
// 設定変更
await client.callTool('configure', {
  keyColumn: 'A',
  headerRow: 1
});

// データ検索
const result = await client.callTool('query', {
  conditions: [['status', '==', '未処理']],
  limit: 10
});

// データ取得
const data = await client.callTool('get', { key: 'item001' });

// データ更新（バッチ）
await client.callTool('update', {
  key: 'item001',
  column: 'status',
  value: '処理済'
});

// 即時更新
await client.callTool('flush', {
  key: 'item001',
  column: 'lock',
  value: 'agent1'
});

// 値の追記
await client.callTool('append_value', {
  key: 'item001',
  column: 'history',
  value: '2025-01-15: 処理完了',
  separator: '\\n'
});
```

## 開発

### セットアップ

```bash
git clone https://github.com/ideamans/node-google-sheet-batch-assistant-mcp.git
cd node-google-sheet-batch-assistant-mcp
yarn install
```

### 手元での結合テスト

1. **GCPでサービスアカウントを作成**
   - [Google Cloud Console](https://console.cloud.google.com) でプロジェクトを作成
   - 「APIとサービス」→「認証情報」からサービスアカウントを作成
   - 「鍵を追加」→「新しい鍵を作成」→「JSON」を選択

2. **テスト用スプレッドシートの準備**
   - 新しいGoogle Spreadsheetを作成
   - サービスアカウントのメールアドレス（`xxxx@xxxx.iam.gserviceaccount.com`）を編集者として共有
   - スプレッドシートのIDをメモ（URLの`/d/`と`/edit`の間の文字列）

3. **認証情報の設定**
   ```bash
   # サービスアカウントキーを保存
   cp ~/Downloads/your-service-account-key.json ./service-account.json
   
   # 環境変数ファイルを作成
   cp .env.example .env
   
   # .envを編集してTEST_SHEET_IDを設定
   # TEST_SHEET_ID=your-spreadsheet-id-here
   ```

4. **テストの実行**
   ```bash
   # ビルド
   yarn build
   
   # 単体テスト
   yarn test
   
   # 結合テスト
   yarn test:integration
   ```

### CIでのテスト準備

GitHubリポジトリのSettings > Secrets and variables > Actionsで以下を設定：

1. **SERVICE_ACCOUNT_JSON**: サービスアカウントキーのJSON内容全体
2. **TEST_SHEET_ID**: テスト用スプレッドシートのID
3. **TEST_SHEET_NAME**: テスト用シート名（デフォルト: `testing`）

### MCPサーバーのローカルテスト

1. **.mcp.jsonの準備**
   ```bash
   cp .mcp.json.example .mcp.json
   ```

2. **.mcp.jsonを編集**
   ```json
   {
     "mcpServers": {
       "google-sheet-batch-assistant": {
         "command": "node",
         "args": [
           "dist/index.js",
           "your-spreadsheet-id-here",
           "live"
         ]
       }
     }
   }
   ```

3. **Claudeコマンドでテスト**
   ```bash
   # MCPサーバーを起動してClaudeから接続
   claude --mcp-config .mcp.json
   ```

### ビルド

```bash
yarn build
```

### コード品質チェック

```bash
# 型チェック
yarn typecheck

# リント
yarn lint
```

## ライセンス

MIT
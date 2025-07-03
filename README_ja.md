# Google Sheet Batch Assistant MCP Server

[English version](./README.md)

AIエージェントがGoogle Spreadsheetsのデータを効率的に読み書きするためのMCP（Model Context Protocol）サーバーです。このライブラリはAIエージェントによるバッチ処理において、タスクのリストや結果データ、進捗情報などをスプレッドシートで管理するためのMCP Serverです。

## 機能

- **バッチ処理**: APIクォータを節約するため、更新は5秒ごとにバッチ処理されます
- **マルチエージェントサポート**: 楽観的ロックにより複数のエージェントが同時に作業できます
- **自動リトライ**: ネットワークエラー時に最大3回まで自動的にリトライします
- **グレースフルシャットダウン**: 終了時に保留中の更新を実行します

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

- `--service-account <path>`: サービスアカウントJSONファイルのパス（デフォルト: ./service-account.json）
- `--log-file <path>`: ログファイルのパス（デフォルト: ./google-sheet-batch-assistant-mcp.log）
- `--read-interval <ms>`: 読み込み間隔（ミリ秒）（デフォルト: 5000）
- `--batch-interval <ms>`: バッチ更新間隔（ミリ秒）（デフォルト: 5000）
- `--key, -k <keyColumn>`: キーカラム名または文字（例: 'id' または 'A'）（デフォルト: A）
- `--header, -h <headerRow>`: ヘッダー行番号（1ベース）（デフォルト: 1）

### 3. MCP クライアントからの使用

```javascript
// 設定の構成
await client.callTool("configure", {
  keyColumn: "A",
  headerRow: 1,
});

// データのクエリ
const result = await client.callTool("query", {
  conditions: [["status", "==", "pending"]],
  limit: 10,
});

// キーによるデータ取得
const data = await client.callTool("get", { key: "item001" });

// データの更新（バッチ）
await client.callTool("update", {
  key: "item001",
  column: "status",
  value: "completed",
});

// 即時更新
await client.callTool("flush", {
  key: "item001",
  column: "lock",
  value: "agent1",
});

// 値の追加
await client.callTool("append_value", {
  key: "item001",
  column: "history",
  value: "2025-01-15: Process completed",
  separator: "\\n",
});
```

## 開発

### セットアップ

```bash
git clone https://github.com/ideamans/node-google-sheet-batch-assistant-mcp.git
cd node-google-sheet-batch-assistant-mcp
yarn install
```

### ローカル統合テスト

1. **GCPでサービスアカウントを作成**

   - [Google Cloud Console](https://console.cloud.google.com)でプロジェクトを作成
   - 「APIとサービス」→「認証情報」でサービスアカウントを作成
   - 「鍵を追加」→「新しい鍵を作成」→「JSON」を選択

2. **テストスプレッドシートの準備**

   - 新しいGoogle Spreadsheetを作成
   - サービスアカウントのメールアドレス（`xxxx@xxxx.iam.gserviceaccount.com`）に編集者として共有
   - スプレッドシートID（URLの`/d/`と`/edit`の間の文字列）をメモ

3. **認証情報の設定**

   ```bash
   # サービスアカウントキーを保存
   cp ~/Downloads/your-service-account-key.json ./service-account.json

   # 環境ファイルを作成
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

   # 統合テスト
   yarn test:integration
   ```

### CI/CDセットアップ

GitHubリポジトリの設定 > シークレットと変数 > アクションで以下を設定:

1. **SERVICE_ACCOUNT_JSON**: サービスアカウントキーの完全なJSON内容
2. **TEST_SHEET_ID**: テストスプレッドシートID
3. **TEST_SHEET_NAME**: テストシート名（デフォルト: `testing`）

### ローカルMCPサーバーテスト

1. **.mcp.jsonの準備**

   ```bash
   cp .mcp.json.example .mcp.json
   ```

2. **.mcp.jsonの編集**

   ```json
   {
     "mcpServers": {
       "google-sheet-batch-assistant": {
         "command": "node",
         "args": ["dist/index.js", "your-spreadsheet-id-here", "live"]
       }
     }
   }
   ```

3. **Claudeでテスト**
   ```bash
   # MCPサーバーを起動してClaudeから接続
   claude --mcp-config .mcp.json
   ```

## MCPサーバー設定

### Claude Desktopでの使用

Claude DesktopのMCP設定に以下を追加:

```json
{
  "mcpServers": {
    "backlog": {
      "command": "npx",
      "args": [
        "-y",
        "google-sheet-batch-assistant-mcp",
        "<sheetId>",
        "<sheetName>"
      ]
    }
  }
}
```

`<sheetId>`をGoogle SpreadsheetのIDに、`<sheetName>`を対象のシート名に置き換えてください。

### 追加の設定オプション

args配列にさらにオプションを追加できます:

```json
{
  "mcpServers": {
    "backlog": {
      "command": "npx",
      "args": [
        "-y",
        "google-sheet-batch-assistant-mcp",
        "<sheetId>",
        "<sheetName>",
        "--service-account",
        "/path/to/service-account.json",
        "--read-interval",
        "3000",
        "--batch-interval",
        "3000",
        "--key",
        "task_id",
        "--header",
        "2"
      ]
    }
  }
}
```

### ビルド

```bash
yarn build
```

### コード品質

```bash
# 型チェック
yarn typecheck

# リンティング
yarn lint
```

## ライセンス

MIT

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
git clone https://github.com/yourusername/google-sheet-batch-assistant-mcp.git
cd google-sheet-batch-assistant-mcp
npm install
npm run build
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

### ビルド

```bash
npm run build
```

### テスト

```bash
# 単体テスト
npm test

# 結合テスト（要Google Sheets設定）
npm run test:integration
```

### 型チェック

```bash
npm run typecheck
```

## ライセンス

MIT
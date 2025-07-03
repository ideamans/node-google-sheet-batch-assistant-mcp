# Google Sheet Batch Assistant MCP Server

AI エージェントが Google Spreadsheets のデータを効率的に読み書きするための MCP (Model Context Protocol) サーバーです。このライブラリは AI エージェントによるバッチ処理において、タスクのリストや結果データ、進捗情報などをスプレッドシートで管理するための MCP Server です。

## 技術スタック

### 言語・ランタイム

- TypeScript
- Node.js 20.x ~

### 必須パッケージ

- `@modelcontextprotocol/sdk`: MCP サーバー実装
- `googleapis`: Google Sheets API 公式クライアント
- `google-auth-library`: Google 認証

### 推奨パッケージ

- `google-spreadsheet`: より高レベルな Google Sheets 操作
  - セル単位の操作が簡単
  - 行・列の管理が直感的
  - 内部で googleapis を使用
- `winston`: 構造化ログ出力
- `dotenv`: 環境変数管理（開発時）

### 実装例（google-spreadsheet を使用）

```javascript
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';

class GoogleSheetsClient {
  private doc: GoogleSpreadsheet;
  private sheet: GoogleSpreadsheetWorksheet;

  async initialize(spreadsheetId: string, sheetName: string, serviceAccountPath: string) {
    // 認証設定
    const creds = require(serviceAccountPath);
    const jwt = new JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    // スプレッドシート接続
    this.doc = new GoogleSpreadsheet(spreadsheetId, jwt);
    await this.doc.loadInfo();

    // シート取得
    this.sheet = this.doc.sheetsByTitle[sheetName];
    if (!this.sheet) {
      throw new Error(`Sheet ${sheetName} not found`);
    }
  }

  // ヘッダーとデータの取得（キャッシュ可能）
  async loadData() {
    const rows = await this.sheet.getRows();
    const headers = this.sheet.headerValues;
    return { headers, rows };
  }

  // バッチ更新の実装
  async batchUpdate(updates: Array<{row: number, column: string, value: string}>) {
    await this.sheet.loadCells();

    for (const update of updates) {
      const cell = this.sheet.getCell(update.row, this.getColumnIndex(update.column));
      cell.value = update.value;
    }

    await this.sheet.saveUpdatedCells();
  }
}
```

## 主要機能

### 1. 認証方式

- **サービスアカウント認証のみ対応**
- JSON ファイル形式のサービスアカウントキーを使用
- OAuth2.0 や API キー認証は非対応

### 2. バッチ更新システム

- **5 秒間隔でのバッチ処理**
  - トランザクションを内部キューに蓄積
  - 5 秒ごとに Google Sheets API の batchUpdate を使用して一括更新
  - 書き込み API Quota の消費を最小化
- **サーバー終了時の処理**
  - SIGINT/SIGTERM 受信時に残存トランザクションを全て実行
  - グレースフルシャットダウンを保証

### 3. 読み込み Quota 管理

- **5 秒間隔の読み込み制限**
  - 前回の読み込みから 5 秒経過していない場合は待機
  - 読み込み API Quota の消費を制御

### 4. リトライ機能

- **自動リトライ**
  - API 呼び出しは最大 3 回まで自動リトライ
  - ネットワークエラーや一時的な API 障害に対応

## 起動方法

```bash
google-sheet-batch-assistant-mcp <spreadsheetId> <sheetName> [options]
```

### パラメータ

- `spreadsheetId`: Google Spreadsheet の ID（必須）
- `sheetName`: 操作対象のシート名（必須）

### オプション

- `--service-account <path>`: サービスアカウント JSON ファイルのパス（デフォルト: ./service-account.json）
- `--log-file <path>`: ログファイルのパス（デフォルト: ./google-sheet-batch-assistant-mcp.log）
- `--read-interval <ms>`: 読み込み間隔（デフォルト: 5000）
- `--batch-interval <ms>`: バッチ更新間隔（デフォルト: 5000）
- `--key, -k <keyColumn>`: キーカラム名またはカラム記号（例: 'id' または 'A'）（デフォルト: A）
- `--header, -h <headerRow>`: ヘッダー行番号（1 から始まる）（デフォルト: 1）

### 起動例

```bash
# 基本的な起動
google-sheet-batch-assistant-mcp 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms Sheet1

# 全オプション指定
google-sheet-batch-assistant-mcp 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms Sheet1 \
  --service-account ./credentials.json \
  --log-file ./logs/mcp-server.log \
  --read-interval 3000 \
  --batch-interval 3000
```

## ツール仕様

### 1. configure - 設定変更

シートの構造に関する設定を変更します。

**パラメータ:**

- `keyColumn` (string, optional): キーカラム名（A, B, C など）。デフォルト: "A"
- `headerRow` (number, optional): ヘッダー行番号。1 以上の値。デフォルト: 1

**レスポンス:**

```json
{
  "content": [
    {
      "type": "text",
      "text": "Configuration updated: keyColumn=B, headerRow=2"
    }
  ]
}
```

**エラー:**

- `headerRow < 1`の場合: "headerRow must be 1 or greater"

### 2. query - データ検索

条件を指定してデータを検索し、該当するキーの配列を返します。

**パラメータ:**

- `conditions` (Array): 検索条件の配列
  - 各要素: `[カラム名, 演算子, 値]`
  - 演算子: `"=="` または `"!="`
  - 空配列の場合は全件のキーを返す
- `limit` (number, optional): 返却する最大件数。未指定の場合は全件返却

**レスポンス:**

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\"keys\": [\"item001\", \"item002\", \"item003\"]}"
    }
  ]
}
```

**動作:**

- 存在しないカラム名は無視される
- 全ての条件が AND 条件として評価される
- 読み込み Quota 制限が適用される（5 秒間隔）
- limit を指定した場合、条件に合致する最初の N 件のみ返却

### 3. get - データ参照

キーを指定して該当行の全カラムデータを取得します。

**パラメータ:**

- `key` (string): 検索するキー値

**レスポンス（成功時）:**

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\"id\": \"item001\", \"name\": \"商品A\", \"status\": \"未処理\", \"price\": \"1000\"}"
    }
  ]
}
```

**レスポンス（キーが存在しない場合）:**

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\"error\": \"Key not found\"}"
    }
  ]
}
```

**動作:**

- 全てのカラム値は文字列として返される
- 空のセルは空文字列として返される
- 読み込み Quota 制限が適用される（5 秒間隔）

### 4. update - バッチ更新

指定したキーの特定カラムの値を更新します（5 秒後のバッチ実行）。

**パラメータ:**

- `key` (string): 更新対象のキー
- `column` (string): 更新するカラム名
- `value` (string): 新しい値

**レスポンス:**

```json
{
  "content": [
    {
      "type": "text",
      "text": "Update queued: item001[status] = 処理済"
    }
  ]
}
```

**動作:**

- トランザクションキューに追加される
- 5 秒後の次回バッチ実行時に反映
- 存在しないキーやカラムの更新は実行時に無視される
- 同一セルへの複数更新は最後の値が適用される

### 5. flush - 即時更新

指定したキーの特定カラムの値を即座に更新します。

**パラメータ:**

- `key` (string): 更新対象のキー
- `column` (string): 更新するカラム名
- `value` (string): 新しい値

**レスポンス:**

```json
{
  "content": [
    {
      "type": "text",
      "text": "Immediate update executed: item001[lock] = agent1"
    }
  ]
}
```

**動作:**

- 即座に batchUpdate が実行される
- 書き込み Quota を消費するため、頻繁な使用は推奨されない
- ロック取得など、即時性が必要な場合に使用

### 6. append_value - 値の追記

指定したキーの特定カラムの値に文字列を追記します。

**パラメータ:**

- `key` (string): 対象のキー
- `column` (string): 追記するカラム名
- `value` (string): 追記する値
- `separator` (string, optional): 区切り文字。デフォルト: "\n"

**レスポンス:**

```json
{
  "content": [
    {
      "type": "text",
      "text": "Append queued: item001[history] += \\n2025-01-15: 処理完了"
    }
  ]
}
```

**動作:**

- 既存の値の末尾に区切り文字を挟んで新しい値を追記
- 空のセルの場合は区切り文字なしで値を設定
- バッチ更新として実行される（即時実行が必要な場合は別途 flush を使用）

## データ更新の仕組み

### 更新フロー

1. **最新データの読み込み**
   - 更新実行直前に最新のシートデータを取得
2. **キャッシュ更新**
   - ヘッダー行から各カラムの位置を特定
   - 各キーの行位置を特定
3. **バッチ更新の実行**
   - Google Sheets API の batchUpdate を使用
   - 複数セルを一度の API 呼び出しで更新

### 競合対策

- **楽観的並行性制御**
  - ロック機構は実装しない
  - 更新直前の位置特定により、行の追加・削除に対応
  - 同一セルへの同時更新は後勝ち

## エラーハンドリング

### 接続エラー対応

- **自動リトライ**: Google Sheets API への接続失敗時、5 秒間隔で最大 3 回リトライ
- **リトライ失敗時の動作**:
  1. エラーメッセージを MCP レスポンスとして返却
  2. 未処理トランザクションをログファイルに出力
  3. サーバープロセスを終了

### リトライ対象エラー

- ネットワークエラー
- 一時的な API 障害（5xx 系エラー）
- Rate Limit 超過
- 認証トークンの期限切れ

### エラー時のレスポンス例

```json
{
  "content": [
    {
      "type": "text",
      "text": "Error: Failed to connect to Google Sheets after 3 attempts. Last error: Network timeout"
    }
  ]
}
```

## ログ仕様

### ログファイル

- デフォルトパス: `./google-sheet-batch-assistant-mcp.log`
- 形式: JSON Lines（1 行 1JSON）
- エンコーディング: UTF-8

### ログレベルと内容

ログは最小限に抑え、重要なイベントのみ記録します。

**起動時**

```json
{
  "timestamp": "2025-01-15T10:00:00Z",
  "level": "info",
  "event": "server_started",
  "spreadsheetId": "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms",
  "sheetName": "Sheet1",
  "config": {
    "keyColumn": "A",
    "headerRow": 1,
    "readInterval": 5000,
    "batchInterval": 5000
  }
}
```

**エラー発生時**

```json
{
  "timestamp": "2025-01-15T10:30:00Z",
  "level": "error",
  "event": "api_error",
  "error": "Failed to connect to Google Sheets",
  "retry_count": 2,
  "will_retry": true
}
```

**接続失敗によるシャットダウン時**

```json
{
  "timestamp": "2025-01-15T10:31:00Z",
  "level": "error",
  "event": "shutdown_connection_failed",
  "error": "Connection failed after 3 retries",
  "pending_transactions": 5,
  "transactions": [
    { "key": "item001", "column": "status", "value": "処理中" },
    { "key": "item002", "column": "result", "value": "エラー" }
  ]
}
```

**正常終了時**

```json
{
  "timestamp": "2025-01-15T18:00:00Z",
  "level": "info",
  "event": "server_stopped",
  "reason": "SIGINT",
  "total_reads": 150,
  "total_writes": 45,
  "uptime_seconds": 28800
}
```

### ログローテーション

- ログローテーションは外部ツール（logrotate 等）に委ねる
- アプリケーション側では実装しない

## 使用例

### 基本的なワークフロー

```javascript
// 1. 未処理データの検索
const result = await client.callTool("query", {
  conditions: [["status", "==", "未処理"]],
});
const keys = JSON.parse(result.content[0].text).keys;

// 2. 最初のアイテムを取得してロック
const key = keys[0];
await client.callTool("flush", {
  key: key,
  column: "lock",
  value: "agent1",
});

// 3. データの詳細を取得
const data = await client.callTool("get", { key: key });
const item = JSON.parse(data.content[0].text);

// 4. 処理実行（ここでAIエージェントが何らかの作業を行う）
const result = await processItem(item);

// 5. 結果を更新（バッチ）
await client.callTool("update", {
  key: key,
  column: "result",
  value: result,
});
await client.callTool("update", {
  key: key,
  column: "status",
  value: "処理済",
});

// 6. 処理履歴を追記
await client.callTool("append_value", {
  key: key,
  column: "history",
  value: "2025-01-15 10:30: AIエージェントによる処理完了",
  separator: "\n",
});

// 7. ロック解除（即時）
await client.callTool("flush", {
  key: key,
  column: "lock",
  value: "",
});
```

### 複数エージェントの協調

```javascript
// エージェント1: データのロックと前処理
async function agent1Process() {
  // 限定した件数のみ処理
  const result = await client.callTool("query", {
    conditions: [
      ["status", "==", "未処理"],
      ["lock", "==", ""],
    ],
    limit: 10, // 一度に10件まで
  });

  for (const key of JSON.parse(result.content[0].text).keys) {
    // ロック取得を試みる
    await client.callTool("flush", {
      key: key,
      column: "lock",
      value: "agent1",
    });

    // 前処理を実行
    await client.callTool("update", {
      key: key,
      column: "preprocessed",
      value: "true",
    });

    // 処理履歴を追記
    await client.callTool("append_value", {
      key: key,
      column: "log",
      value: `${new Date().toISOString()}: 前処理完了 by agent1`,
    });

    // ロック解除
    await client.callTool("flush", {
      key: key,
      column: "lock",
      value: "",
    });
  }
}

// エージェント2: 前処理済みデータの本処理
async function agent2Process() {
  const result = await client.callTool("query", {
    conditions: [
      ["preprocessed", "==", "true"],
      ["status", "==", "未処理"],
      ["lock", "==", ""],
    ],
  });

  // 以下、同様の処理
}
```

## 制限事項

### 機能制限

- **削除非対応**: 行の削除機能は実装されていない
- **シート作成非対応**: 既存シートの操作のみ対応
- **数式非対応**: セルの値のみ操作可能（数式の読み書きは不可）
- **書式非対応**: セルの書式設定は変更されない

### パフォーマンス制限

- **読み込み間隔**: 最小 5 秒
- **バッチ更新間隔**: 5 秒固定
- **最大カラム**: ZZ 列まで（702 列）
- **同時トランザクション数**: メモリに依存（実用上は数千程度）

### API Quota 考慮事項

- **読み込み**: 100 リクエスト/100 秒/ユーザー
- **書き込み**: 100 リクエスト/100 秒/ユーザー
- **セル書き込み**: 300 リクエスト/分/プロジェクト

## セキュリティ考慮事項

### 認証情報の管理

- サービスアカウントキーは適切に保護する
- 環境変数や秘密管理サービスの使用を推奨
- キーファイルのアクセス権限を最小限に設定

### アクセス制御

- サービスアカウントには必要最小限の権限のみ付与
- スプレッドシートへの編集権限のみで動作可能
- 組織のセキュリティポリシーに従った運用

## テスト戦略

### 概要

テストは単体テストと結合テストの 2 段階で実施します。単体テストでは MCP サーバーを実際に起動し、MCP クライアント経由でリクエストを送信して、モック化された Google Sheets API への作用を検証します。結合テストでは実際の Google Sheets を使用して動作を検証します。

### 設定可能なパラメータ

テスト用に Quota 制限の間隔を設定可能にします：

- `readInterval`: 読み込み間隔（デフォルト: 5000ms）
- `batchUpdateInterval`: バッチ更新間隔（デフォルト: 5000ms）

### 1. 単体テスト

#### テスト環境

- **MCP サーバー**: 実際にサーバーを起動
- **MCP クライアント**: テスト用クライアントからリクエスト送信
- **Google Sheets API モック**: 全ての API 呼び出しをモック化
- **Quota 設定**: 100ms に短縮して高速テスト

#### テストヘルパー

```javascript
// test/helpers/mcp-test-client.js
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

export class MCPTestClient {
  constructor() {
    this.client = new Client({
      name: "test-client",
      version: "1.0.0",
    });
  }

  async connect(serverProcess) {
    const transport = new StdioClientTransport({
      command: serverProcess.command,
      args: serverProcess.args,
    });
    await this.client.connect(transport);
  }

  async callTool(name, params) {
    return await this.client.request({
      method: `tools/${name}`,
      params,
    });
  }

  async disconnect() {
    await this.client.close();
  }
}
```

#### 単体テストケース

**基本機能テスト**

```javascript
describe("GoogleSheetsMCPServer Unit Tests", () => {
  let client;
  let serverProcess;
  let mockSheetsAPI;

  beforeEach(async () => {
    // Google Sheets APIをモック
    mockSheetsAPI = {
      spreadsheets: {
        values: {
          get: jest.fn().mockResolvedValue({
            data: {
              values: [
                ["id", "name", "status", "lock"],
                ["item001", "商品A", "未処理", ""],
                ["item002", "商品B", "処理済", ""],
              ],
            },
          }),
        },
        batchUpdate: jest.fn().mockResolvedValue({ data: {} }),
        get: jest.fn().mockResolvedValue({
          data: { sheets: [{ properties: { sheetId: 123, title: "Sheet1" } }] },
        }),
      },
    };

    // モックを注入してサーバー起動
    process.env.USE_MOCK_API = "true";
    global.mockSheetsAPI = mockSheetsAPI;

    serverProcess = {
      command: "node",
      args: [
        "./server.js",
        "test-sheet-id",
        "Sheet1",
        "--service-account",
        "./mock.json",
        "--read-interval",
        "100",
        "--batch-interval",
        "100",
      ],
    };

    client = new MCPTestClient();
    await client.connect(serverProcess);
  });

  afterEach(async () => {
    await client.disconnect();
    delete process.env.USE_MOCK_API;
  });

  test("configure - キーカラムとヘッダー行の設定", async () => {
    const response = await client.callTool("configure", {
      keyColumn: "B",
      headerRow: 2,
    });

    expect(response.content[0].text).toContain("keyColumn=B");
    expect(response.content[0].text).toContain("headerRow=2");
  });

  test("configure - 不正なヘッダー行でエラー", async () => {
    await expect(
      client.callTool("configure", { headerRow: 0 })
    ).rejects.toThrow("headerRow must be 1 or greater");
  });

  test("query - 条件指定検索", async () => {
    const response = await client.callTool("query", {
      conditions: [["status", "==", "未処理"]],
    });

    const result = JSON.parse(response.content[0].text);
    expect(result.keys).toEqual(["item001"]);
    expect(mockSheetsAPI.spreadsheets.values.get).toHaveBeenCalledWith({
      spreadsheetId: "test-sheet-id",
      range: "Sheet1!A:ZZ",
    });
  });

  test("get - キー指定参照", async () => {
    const response = await client.callTool("get", { key: "item001" });

    const result = JSON.parse(response.content[0].text);
    expect(result).toEqual({
      id: "item001",
      name: "商品A",
      status: "未処理",
      lock: "",
    });
  });
});
```

**Quota 制限テスト**

```javascript
describe("Quota制限の検証", () => {
  test("読み込みQuota - 100ms以内の連続アクセスをブロック", async () => {
    const start = Date.now();

    // 1回目の読み込み
    await client.callTool("query", { conditions: [] });

    // 即座に2回目の読み込み（ブロックされる）
    await client.callTool("query", { conditions: [] });

    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(100);
    expect(mockSheetsAPI.spreadsheets.values.get).toHaveBeenCalledTimes(2);
  });

  test("バッチ更新 - 100ms間隔での実行", async () => {
    // 複数の更新を登録
    await client.callTool("update", {
      key: "item001",
      column: "status",
      value: "処理中",
    });
    await client.callTool("update", {
      key: "item002",
      column: "status",
      value: "処理中",
    });

    // バッチ実行前
    expect(mockSheetsAPI.spreadsheets.batchUpdate).not.toHaveBeenCalled();

    // 100ms待機後にバッチ実行される
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(mockSheetsAPI.spreadsheets.batchUpdate).toHaveBeenCalledTimes(1);
    expect(mockSheetsAPI.spreadsheets.batchUpdate).toHaveBeenCalledWith({
      spreadsheetId: "test-sheet-id",
      requestBody: {
        requests: expect.arrayContaining([
          expect.objectContaining({
            updateCells: expect.any(Object),
          }),
        ]),
      },
    });
  });

  test("即時更新 - flushは即座に実行", async () => {
    await client.callTool("flush", {
      key: "item001",
      column: "lock",
      value: "test-lock",
    });

    // 即座にbatchUpdateが呼ばれる
    expect(mockSheetsAPI.spreadsheets.batchUpdate).toHaveBeenCalledTimes(1);
  });
});
```

**リトライ機能テスト**

```javascript
describe("リトライ機能の検証", () => {
  test("読み込み失敗時に最大3回リトライ", async () => {
    let attempts = 0;
    mockSheetsAPI.spreadsheets.values.get.mockImplementation(() => {
      attempts++;
      if (attempts < 3) {
        throw new Error("Network error");
      }
      return { data: { values: [["id"], ["item001"]] } };
    });

    const response = await client.callTool("get", { key: "item001" });

    expect(attempts).toBe(3);
    expect(response).toBeDefined();
  });

  test("更新失敗時に最大3回リトライ", async () => {
    let attempts = 0;
    mockSheetsAPI.spreadsheets.batchUpdate.mockImplementation(() => {
      attempts++;
      if (attempts < 3) {
        throw new Error("API error");
      }
      return { data: {} };
    });

    await client.callTool("flush", {
      key: "item001",
      column: "status",
      value: "test",
    });

    expect(attempts).toBe(3);
  });

  test("3回リトライしても失敗したらエラー", async () => {
    mockSheetsAPI.spreadsheets.values.get.mockRejectedValue(
      new Error("Persistent error")
    );

    await expect(client.callTool("get", { key: "test" })).rejects.toThrow();

    expect(mockSheetsAPI.spreadsheets.values.get).toHaveBeenCalledTimes(3);
  });
});
```

**グレースフルシャットダウンテスト**

```javascript
describe("シャットダウン処理", () => {
  test("SIGINT受信時に残存トランザクションを実行", async () => {
    // トランザクションを追加
    await client.callTool("update", {
      key: "item001",
      column: "status",
      value: "終了処理",
    });
    await client.callTool("update", {
      key: "item002",
      column: "status",
      value: "終了処理",
    });

    // サーバープロセスにSIGINTを送信
    process.kill(serverProcess.pid, "SIGINT");

    // シャットダウン処理を待つ
    await new Promise((resolve) => setTimeout(resolve, 200));

    // バッチ更新が実行されたことを確認
    expect(mockSheetsAPI.spreadsheets.batchUpdate).toHaveBeenCalled();
    const calls = mockSheetsAPI.spreadsheets.batchUpdate.mock.calls;
    const lastCall = calls[calls.length - 1][0];

    expect(lastCall.requestBody.requests).toHaveLength(2);
  });
});
```

### 2. 結合テスト

#### テスト環境

- **実際の Google Sheets**: テスト用スプレッドシートを使用
- **環境変数**:
  - `GOOGLE_APPLICATION_CREDENTIALS`: サービスアカウントキーのパス
  - `TEST_SHEET_ID`: テスト用スプレッドシート ID
  - `TEST_SHEET_NAME`: テスト用シート名
- **Quota 設定**: 500ms に設定（テスト時間短縮と Quota 制限のバランス）

#### テストデータ準備

```javascript
// test/integration/test-data.js
export const TEST_HEADERS = [
  "id",
  "name",
  "status",
  "lock",
  "result",
  "history",
  "assignee",
];

export const TEST_DATA_INITIAL = [
  ["item001", "商品A", "未処理", "", "", "", ""],
  ["item002", "商品B", "未処理", "", "", "", ""],
  ["item003", "商品C", "未処理", "", "", "", ""],
  [
    "item004",
    "商品D",
    "処理中",
    "agent-x",
    "",
    "2025-01-14: 処理開始",
    "agent-x",
  ],
  [
    "item005",
    "商品E",
    "処理済",
    "",
    "正常完了",
    "2025-01-13: 処理完了",
    "agent-1",
  ],
  [
    "item006",
    "商品F",
    "エラー",
    "",
    "API呼び出し失敗",
    "2025-01-13: エラー発生",
    "agent-2",
  ],
  ["item007", "商品G", "未処理", "", "", "", ""],
  ["item008", "商品H", "未処理", "", "", "", ""],
  [
    "item009",
    "商品I",
    "確認待ち",
    "",
    "要確認",
    "2025-01-14: 人間の確認が必要",
    "agent-1",
  ],
  ["item010", "商品J", "未処理", "", "", "", ""],
];
```

#### セットアップヘルパー

```javascript
// test/integration/setup.js
import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";
import { TEST_HEADERS, TEST_DATA_INITIAL } from "./test-data.js";

export async function setupTestSheet() {
  const jwt = new JWT({
    keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const doc = new GoogleSpreadsheet(process.env.TEST_SHEET_ID, jwt);
  await doc.loadInfo();

  const sheet = doc.sheetsByTitle[process.env.TEST_SHEET_NAME];

  // シートを完全にクリア
  await sheet.clear();

  // ヘッダーとテストデータを設定
  await sheet.setHeaderRow(TEST_HEADERS);
  await sheet.addRows(
    TEST_DATA_INITIAL.map((row) => {
      const obj = {};
      TEST_HEADERS.forEach((header, index) => {
        obj[header] = row[index];
      });
      return obj;
    })
  );

  console.log("Test sheet initialized with", TEST_DATA_INITIAL.length, "rows");
}

export async function getSheetData() {
  const jwt = new JWT({
    keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const doc = new GoogleSpreadsheet(process.env.TEST_SHEET_ID, jwt);
  await doc.loadInfo();

  const sheet = doc.sheetsByTitle[process.env.TEST_SHEET_NAME];
  const rows = await sheet.getRows();

  return rows.map((row) => {
    const obj = {};
    TEST_HEADERS.forEach((header) => {
      obj[header] = row.get(header) || "";
    });
    return obj;
  });
}
```

#### 結合テストシナリオ

**シナリオ 1: 単一エージェントの基本フロー**

```javascript
describe("Integration Test - Single Agent Workflow", () => {
  let client;

  beforeAll(async () => {
    await setupTestSheet();

    // MCPサーバー起動
    const serverProcess = {
      command: "node",
      args: [
        "./server.js",
        process.env.TEST_SHEET_ID,
        process.env.TEST_SHEET_NAME,
        "--service-account",
        process.env.GOOGLE_APPLICATION_CREDENTIALS,
        "--read-interval",
        "500",
        "--batch-interval",
        "500",
        "--log-file",
        "./test-server.log",
      ],
    };

    client = new MCPTestClient();
    await client.connect(serverProcess);

    // サーバーの初期化を待つ
    await new Promise((resolve) => setTimeout(resolve, 1000));
  });

  afterAll(async () => {
    await client.disconnect();
  });

  test("完全な処理フロー - 未処理アイテムの検索から完了まで", async () => {
    // 1. 未処理かつロックされていないアイテムを検索
    const searchResult = await client.callTool("query", {
      conditions: [
        ["status", "==", "未処理"],
        ["lock", "==", ""],
      ],
      limit: 3,
    });

    const keys = JSON.parse(searchResult.content[0].text).keys;
    expect(keys).toContain("item001");
    expect(keys).toContain("item002");
    expect(keys).toContain("item003");
    expect(keys.length).toBe(3); // limitが効いている

    // 2. 最初のアイテムをロック（即時）
    await client.callTool("flush", {
      key: "item001",
      column: "lock",
      value: "test-agent",
    });

    // 3. アイテムの詳細を取得
    await new Promise((resolve) => setTimeout(resolve, 500));
    const itemData = await client.callTool("get", { key: "item001" });
    const item = JSON.parse(itemData.content[0].text);

    expect(item.id).toBe("item001");
    expect(item.name).toBe("商品A");
    expect(item.lock).toBe("test-agent");

    // 4. 処理を実行（シミュレーション）
    const processingResult = `処理完了: ${item.name}の在庫確認済み`;

    // 5. 結果を更新（バッチ）
    await client.callTool("update", {
      key: "item001",
      column: "status",
      value: "処理済",
    });

    await client.callTool("update", {
      key: "item001",
      column: "result",
      value: processingResult,
    });

    await client.callTool("update", {
      key: "item001",
      column: "assignee",
      value: "test-agent",
    });

    // 6. 履歴を追記
    const timestamp = new Date().toISOString();
    await client.callTool("append_value", {
      key: "item001",
      column: "history",
      value: `${timestamp}: 自動処理完了`,
      separator: "\n",
    });

    // 7. ロック解除（即時）
    await client.callTool("flush", {
      key: "item001",
      column: "lock",
      value: "",
    });

    // 8. バッチ実行を待つ
    await new Promise((resolve) => setTimeout(resolve, 600));

    // 9. 最終状態を確認
    await new Promise((resolve) => setTimeout(resolve, 500));
    const finalData = await getSheetData();
    const processedItem = finalData.find((row) => row.id === "item001");

    expect(processedItem.status).toBe("処理済");
    expect(processedItem.result).toBe(processingResult);
    expect(processedItem.lock).toBe("");
    expect(processedItem.assignee).toBe("test-agent");
    expect(processedItem.history).toContain("自動処理完了");
  });
});
```

**シナリオ 2: 複数エージェントの協調動作**

```javascript
describe("Integration Test - Multi Agent Collaboration", () => {
  let client1, client2;

  beforeAll(async () => {
    await setupTestSheet();

    // 2つのMCPクライアントを起動（同じサーバーに接続）
    const serverProcess = {
      command: "node",
      args: [
        "./server.js",
        process.env.TEST_SHEET_ID,
        process.env.TEST_SHEET_NAME,
        "--service-account",
        process.env.GOOGLE_APPLICATION_CREDENTIALS,
        "--read-interval",
        "500",
        "--batch-interval",
        "500",
      ],
    };

    client1 = new MCPTestClient();
    client2 = new MCPTestClient();

    await client1.connect(serverProcess);
    await client2.connect(serverProcess);

    await new Promise((resolve) => setTimeout(resolve, 1000));
  });

  afterAll(async () => {
    await client1.disconnect();
    await client2.disconnect();
  });

  test("2つのエージェントが異なるアイテムを同時処理", async () => {
    // Agent1: item007を処理
    const agent1Task = async () => {
      // ロック取得
      await client1.callTool("flush", {
        key: "item007",
        column: "lock",
        value: "agent-1",
      });

      // 処理シミュレーション
      await new Promise((resolve) => setTimeout(resolve, 300));

      // 結果更新
      await client1.callTool("update", {
        key: "item007",
        column: "status",
        value: "処理済",
      });

      await client1.callTool("append_value", {
        key: "item007",
        column: "history",
        value: `${new Date().toISOString()}: Agent1が処理`,
      });

      // ロック解除
      await client1.callTool("flush", {
        key: "item007",
        column: "lock",
        value: "",
      });
    };

    // Agent2: item008を処理
    const agent2Task = async () => {
      // ロック取得
      await client2.callTool("flush", {
        key: "item008",
        column: "lock",
        value: "agent-2",
      });

      // 処理シミュレーション
      await new Promise((resolve) => setTimeout(resolve, 400));

      // 結果更新
      await client2.callTool("update", {
        key: "item008",
        column: "status",
        value: "処理済",
      });

      await client2.callTool("append_value", {
        key: "item008",
        column: "history",
        value: `${new Date().toISOString()}: Agent2が処理`,
      });

      // ロック解除
      await client2.callTool("flush", {
        key: "item008",
        column: "lock",
        value: "",
      });
    };

    // 並行実行
    await Promise.all([agent1Task(), agent2Task()]);

    // バッチ実行を待つ
    await new Promise((resolve) => setTimeout(resolve, 600));

    // 結果確認
    const finalData = await getSheetData();

    const item007 = finalData.find((row) => row.id === "item007");
    expect(item007.status).toBe("処理済");
    expect(item007.lock).toBe("");
    expect(item007.history).toContain("Agent1が処理");

    const item008 = finalData.find((row) => row.id === "item008");
    expect(item008.status).toBe("処理済");
    expect(item008.lock).toBe("");
    expect(item008.history).toContain("Agent2が処理");
  });

  test("ロック競合のシミュレーション", async () => {
    // 両エージェントが同じアイテムを取得しようとする
    const targetKey = "item010";

    // 同時にロック取得を試みる
    const [result1, result2] = await Promise.all([
      client1.callTool("flush", {
        key: targetKey,
        column: "lock",
        value: "agent-1",
      }),
      client2.callTool("flush", {
        key: targetKey,
        column: "lock",
        value: "agent-2",
      }),
    ]);

    // どちらかがロックを取得（後勝ち）
    await new Promise((resolve) => setTimeout(resolve, 500));
    const data = await getSheetData();
    const item = data.find((row) => row.id === targetKey);

    // ロックは'agent-1'か'agent-2'のいずれか
    expect(["agent-1", "agent-2"]).toContain(item.lock);

    // ロックを持っているエージェントが処理を完了
    const lockOwner = item.lock;
    const ownerClient = lockOwner === "agent-1" ? client1 : client2;

    await ownerClient.callTool("update", {
      key: targetKey,
      column: "status",
      value: "処理済",
    });

    await ownerClient.callTool("flush", {
      key: targetKey,
      column: "lock",
      value: "",
    });
  });
});
```

**シナリオ 3: エラーハンドリングとリカバリー**

```javascript
describe("Integration Test - Error Handling", () => {
  test("既に処理済みのアイテムをスキップ", async () => {
    // 処理済みアイテムを検索
    const result = await client.callTool("query", {
      conditions: [["status", "==", "処理済"]],
    });

    const keys = JSON.parse(result.content[0].text).keys;
    expect(keys).toContain("item005");
    expect(keys.length).toBeGreaterThan(0);
  });

  test("存在しないキーの参照", async () => {
    const result = await client.callTool("get", { key: "nonexistent" });
    const data = JSON.parse(result.content[0].text);

    expect(data.error).toBe("Key not found");
  });

  test("append_valueで空のセルへの追記", async () => {
    // 新しいアイテムのhistoryカラムに追記
    await client.callTool("append_value", {
      key: "item003",
      column: "history",
      value: "初回エントリー",
    });

    // バッチ実行を待つ
    await new Promise((resolve) => setTimeout(resolve, 600));

    // 確認
    const data = await getSheetData();
    const item = data.find((row) => row.id === "item003");

    expect(item.history).toBe("初回エントリー"); // 区切り文字なし
  });
});
```

### テスト実行方法

```bash
# 環境変数の設定
export GOOGLE_APPLICATION_CREDENTIALS=./test-credentials.json
export TEST_SHEET_ID=your-test-sheet-id
export TEST_SHEET_NAME=TestSheet

# 単体テストの実行
npm test

# 結合テストの実行
npm run test:integration

# 特定のシナリオのみ実行
npm run test:integration -- --testNamePattern="Single Agent"

# カバレッジレポート
npm run test:coverage
```

### CI/CD 統合

```yaml
# .github/workflows/test.yml
name: Test

on: [push, pull_request]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
      - run: npm ci
      - run: npm test

  integration-tests:
    runs-on: ubuntu-latest
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
      - run: npm ci
      - run: npm run test:integration
        env:
          GOOGLE_APPLICATION_CREDENTIALS: ${{ secrets.TEST_CREDENTIALS }}
          TEST_SHEET_ID: ${{ secrets.TEST_SHEET_ID }}
          TEST_SHEET_NAME: ${{ secrets.TEST_SHEET_NAME }}
```

## トラブルシューティング

### よくある問題

1. **"Sheet not found"エラー**

   - シート名が正しいか確認
   - シートが存在するか確認
   - サービスアカウントにアクセス権限があるか確認

2. **更新が反映されない**

   - 5 秒のバッチ間隔を待つ
   - キーやカラム名が正しいか確認
   - エラーログを確認

3. **Quota 超過エラー**

   - 読み込み頻度を下げる
   - バッチ更新を活用する
   - 即時更新（flush）の使用を最小限にする

4. **認証エラー**
   - サービスアカウントキーファイルのパスを確認
   - キーファイルの内容が正しいか確認
   - Google Sheets API が有効化されているか確認

## MCP サーバー設定

### Claude Desktop での使用

Claude Desktop の MCP 設定に以下を追加します：

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

`<sheetId>` をあなたの Google Spreadsheet の ID に、`<sheetName>` を対象のシート名に置き換えてください。

### 追加の設定オプション

args の配列により多くのオプションを追加できます：

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

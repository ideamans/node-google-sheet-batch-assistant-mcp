import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { MCPTestClient } from '../helpers/mcp-test-client.js';
import { setupTestSheet, getSheetData } from './setup.js';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../.env') });

describe('Integration Test - Single Agent Workflow', () => {
  let client: MCPTestClient;

  beforeAll(async () => {
    // 環境変数の確認
    if (!process.env.TEST_SHEET_ID || !process.env.TEST_SHEET_NAME) {
      throw new Error('TEST_SHEET_ID and TEST_SHEET_NAME must be set in .env');
    }
  });

  beforeEach(async () => {
    // 各テストの前にシートを初期化
    await setupTestSheet();

    if (!client) {
      // MCPサーバー起動
      const serverProcess = {
        command: 'node',
        args: [
          path.join(__dirname, '../../dist/index.js'),
          process.env.TEST_SHEET_ID,
          process.env.TEST_SHEET_NAME,
          '--service-account', path.join(__dirname, '../../service-account.json'),
          '--read-interval', '500',
          '--batch-interval', '500',
          '--log-file', path.join(__dirname, '../../test-server.log')
        ]
      };

      client = new MCPTestClient();
      await client.connect(serverProcess);

      // サーバーの初期化を待つ
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  });

  afterEach(async () => {
    // 各テスト後に少し待機
    await new Promise(resolve => setTimeout(resolve, 500));
  });

  afterAll(async () => {
    if (client) {
      await client.disconnect();
    }
  });

  test('configure - キーカラムとヘッダー行の設定', async () => {
    const response = await client.callTool('configure', {
      keyColumn: 'B',
      headerRow: 2
    });

    expect(response.content[0].text).toBe('設定を更新しました');

    // デフォルトに戻す
    await client.callTool('configure', {
      keyColumn: 'A',
      headerRow: 1
    });
  });

  test('完全な処理フロー - 未処理アイテムの検索から完了まで', async () => {
    // 1. 未処理かつロックされていないアイテムを検索
    const searchResult = await client.callTool('query', {
      conditions: [
        ['status', '==', '未処理'],
        ['lock', '==', '']
      ],
      limit: 3
    });

    const keys = JSON.parse(searchResult.content[0].text).keys;
    expect(keys).toContain('item001');
    expect(keys).toContain('item002');
    expect(keys).toContain('item003');
    expect(keys.length).toBe(3); // limitが効いている

    // 2. 最初のアイテムをロック（即時）
    await client.callTool('flush', {
      key: 'item001',
      column: 'lock',
      value: 'test-agent'
    });

    // 3. アイテムの詳細を取得
    await new Promise(resolve => setTimeout(resolve, 500));
    const itemData = await client.callTool('get', { key: 'item001' });
    const item = JSON.parse(itemData.content[0].text);

    expect(item.id).toBe('item001');
    expect(item.name).toBe('商品A');
    expect(item.lock).toBe('test-agent');

    // 4. 処理を実行（シミュレーション）
    const processingResult = `処理完了: ${item.name}の在庫確認済み`;

    // 5. 結果を更新（バッチ）
    await client.callTool('update', {
      key: 'item001',
      column: 'status',
      value: '処理済'
    });

    await client.callTool('update', {
      key: 'item001',
      column: 'result',
      value: processingResult
    });

    await client.callTool('update', {
      key: 'item001',
      column: 'assignee',
      value: 'test-agent'
    });

    // 6. 履歴を追記
    const timestamp = new Date().toISOString();
    await client.callTool('append_value', {
      key: 'item001',
      column: 'history',
      value: `${timestamp}: 自動処理完了`,
      separator: '\n'
    });

    // 7. ロック解除（即時）
    await client.callTool('flush', {
      key: 'item001',
      column: 'lock',
      value: ''
    });

    // 8. バッチ実行を待つ
    await new Promise(resolve => setTimeout(resolve, 600));

    // 9. 最終状態を確認
    await new Promise(resolve => setTimeout(resolve, 500));
    const finalData = await getSheetData();
    const processedItem = finalData.find(row => row.id === 'item001');

    expect(processedItem.status).toBe('処理済');
    expect(processedItem.result).toBe(processingResult);
    expect(processedItem.lock).toBe('');
    expect(processedItem.assignee).toBe('test-agent');
    expect(processedItem.history).toContain('自動処理完了');
  });

  test('存在しないキーの参照', async () => {
    const result = await client.callTool('get', { key: 'nonexistent' });
    const data = JSON.parse(result.content[0].text);

    expect(data.error).toBe('Key not found');
  });

  test('append_valueで空のセルへの追記', async () => {
    // 新しいアイテムのhistoryカラムに追記
    await client.callTool('append_value', {
      key: 'item003',
      column: 'history',
      value: '初回エントリー'
    });

    // バッチ実行を待つ
    await new Promise(resolve => setTimeout(resolve, 600));

    // 確認
    await new Promise(resolve => setTimeout(resolve, 500));
    const data = await getSheetData();
    const item = data.find(row => row.id === 'item003');

    expect(item.history).toBe('初回エントリー'); // 区切り文字なし
  });
});
import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { MCPTestClient } from '../helpers/mcp-test-client.js';
import { setupTestSheet, getSheetData } from './setup.js';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../.env') });

describe('Integration Test - Multi Agent Collaboration', () => {
  let client1: MCPTestClient;
  let client2: MCPTestClient;

  beforeAll(async () => {
    // 環境変数の確認
    if (!process.env.TEST_SHEET_ID || !process.env.TEST_SHEET_NAME) {
      throw new Error('TEST_SHEET_ID and TEST_SHEET_NAME must be set in .env');
    }
  });

  beforeEach(async () => {
    // 各テストの前にシートを初期化
    await setupTestSheet();

    if (!client1 || !client2) {
      // MCPサーバー起動（同じサーバープロセスを共有）
      const serverProcess = {
        command: 'node',
        args: [
          path.join(__dirname, '../../dist/index.js'),
          process.env.TEST_SHEET_ID,
          process.env.TEST_SHEET_NAME,
          '--service-account', path.join(__dirname, '../../service-account.json'),
          '--read-interval', '500',
          '--batch-interval', '500',
          '--log-file', path.join(__dirname, '../../test-server-multi.log')
        ]
      };

      // 2つのクライアントを作成
      client1 = new MCPTestClient();
      client2 = new MCPTestClient();

      await client1.connect(serverProcess);
      
      // 2つ目のクライアントは少し待ってから接続
      await new Promise(resolve => setTimeout(resolve, 500));
      await client2.connect(serverProcess);

      // サーバーの初期化を待つ
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  });

  afterEach(async () => {
    // 各テスト後に少し待機
    await new Promise(resolve => setTimeout(resolve, 500));
  });

  afterAll(async () => {
    if (client1) {
      await client1.disconnect();
    }
    if (client2) {
      await client2.disconnect();
    }
  });

  test('2つのエージェントが異なるアイテムを同時処理', async () => {
    // Agent1: item007を処理
    const agent1Task = async () => {
      // ロック取得
      await client1.callTool('flush', {
        key: 'item007',
        column: 'lock',
        value: 'agent-1'
      });

      // 処理シミュレーション
      await new Promise(resolve => setTimeout(resolve, 300));

      // 結果更新
      await client1.callTool('update', {
        key: 'item007',
        column: 'status',
        value: '処理済'
      });

      await client1.callTool('append_value', {
        key: 'item007',
        column: 'history',
        value: `${new Date().toISOString()}: Agent1が処理`
      });

      // ロック解除
      await client1.callTool('flush', {
        key: 'item007',
        column: 'lock',
        value: ''
      });
    };

    // Agent2: item008を処理
    const agent2Task = async () => {
      // ロック取得
      await client2.callTool('flush', {
        key: 'item008',
        column: 'lock',
        value: 'agent-2'
      });

      // 処理シミュレーション
      await new Promise(resolve => setTimeout(resolve, 400));

      // 結果更新
      await client2.callTool('update', {
        key: 'item008',
        column: 'status',
        value: '処理済'
      });

      await client2.callTool('append_value', {
        key: 'item008',
        column: 'history',
        value: `${new Date().toISOString()}: Agent2が処理`
      });

      // ロック解除
      await client2.callTool('flush', {
        key: 'item008',
        column: 'lock',
        value: ''
      });
    };

    // 並行実行
    await Promise.all([agent1Task(), agent2Task()]);

    // バッチ実行を待つ
    await new Promise(resolve => setTimeout(resolve, 600));

    // 結果確認
    const finalData = await getSheetData();

    const item007 = finalData.find(row => row.id === 'item007');
    expect(item007.status).toBe('処理済');
    expect(item007.lock).toBe('');
    expect(item007.history).toContain('Agent1が処理');

    const item008 = finalData.find(row => row.id === 'item008');
    expect(item008.status).toBe('処理済');
    expect(item008.lock).toBe('');
    expect(item008.history).toContain('Agent2が処理');
  });

  test('ロック競合のシミュレーション', async () => {
    // 両エージェントが同じアイテムを取得しようとする
    const targetKey = 'item010';

    // 同時にロック取得を試みる
    const [result1, result2] = await Promise.all([
      client1.callTool('flush', {
        key: targetKey,
        column: 'lock',
        value: 'agent-1'
      }),
      client2.callTool('flush', {
        key: targetKey,
        column: 'lock',
        value: 'agent-2'
      })
    ]);

    // どちらかがロックを取得（後勝ち）
    await new Promise(resolve => setTimeout(resolve, 500));
    const data = await getSheetData();
    const item = data.find(row => row.id === targetKey);

    // ロックは'agent-1'か'agent-2'のいずれか
    expect(['agent-1', 'agent-2']).toContain(item.lock);

    // ロックを持っているエージェントが処理を完了
    const lockOwner = item.lock;
    const ownerClient = lockOwner === 'agent-1' ? client1 : client2;

    await ownerClient.callTool('update', {
      key: targetKey,
      column: 'status',
      value: '処理済'
    });

    await ownerClient.callTool('flush', {
      key: targetKey,
      column: 'lock',
      value: ''
    });

    // バッチ実行を待つ
    await new Promise(resolve => setTimeout(resolve, 600));

    // 最終確認
    const finalData = await getSheetData();
    const finalItem = finalData.find(row => row.id === targetKey);
    expect(finalItem.status).toBe('処理済');
    expect(finalItem.lock).toBe('');
  });

  test('複数エージェントによる条件検索', async () => {
    // 両エージェントが異なる条件で検索
    const [result1, result2] = await Promise.all([
      client1.callTool('query', {
        conditions: [['status', '==', '処理済']]
      }),
      client2.callTool('query', {
        conditions: [['status', '==', 'エラー']]
      })
    ]);

    const keys1 = JSON.parse(result1.content[0].text).keys;
    const keys2 = JSON.parse(result2.content[0].text).keys;

    // 処理済みアイテムが存在することを確認
    expect(keys1.length).toBeGreaterThan(0);
    expect(keys1).toContain('item005');

    // エラーアイテムが存在することを確認
    expect(keys2).toContain('item006');
  });
});
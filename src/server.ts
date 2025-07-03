import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { 
  CallToolRequestSchema, 
  ListToolsRequestSchema,
  ErrorCode,
  McpError
} from '@modelcontextprotocol/sdk/types.js';
import { GoogleSheetsClient } from './google-sheets-client.js';
import { createLogger } from './logger.js';
import { 
  ServerConfig, 
  SheetConfig, 
  QueryCondition, 
  UpdateTransaction 
} from './types.js';
import winston from 'winston';

export class GoogleSheetsMCPServer {
  private server: Server;
  private sheetsClient: GoogleSheetsClient;
  private logger: winston.Logger;
  private config: ServerConfig;
  private sheetConfig: SheetConfig = {
    keyColumn: 'A',
    headerRow: 1
  };
  
  private updateQueue: UpdateTransaction[] = [];
  private batchTimer: NodeJS.Timeout | null = null;
  private isShuttingDown: boolean = false;
  
  constructor(config: ServerConfig) {
    this.config = config;
    this.logger = createLogger(config.logFilePath);
    
    // 初期設定値を適用
    if (config.keyColumn) {
      this.sheetConfig.keyColumn = config.keyColumn;
    }
    if (config.headerRow) {
      this.sheetConfig.headerRow = config.headerRow;
    }
    
    this.sheetsClient = new GoogleSheetsClient(
      config.spreadsheetId,
      config.sheetName,
      config.serviceAccountPath,
      config.readInterval,
      this.sheetConfig.headerRow
    );
    
    this.server = new Server(
      {
        name: 'google-sheet-batch-assistant-mcp',
        version: '1.0.0'
      },
      {
        capabilities: {
          tools: {}
        }
      }
    );
    
    this.setupHandlers();
    this.setupShutdownHandlers();
  }
  
  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'configure',
          description: 'Configure sheet structure settings',
          inputSchema: {
            type: 'object',
            properties: {
              keyColumn: {
                type: 'string',
                description: 'Key column name (A, B, C, etc.)'
              },
              headerRow: {
                type: 'number',
                description: 'Header row number (1 or greater)'
              }
            },
            additionalProperties: false
          }
        },
        {
          name: 'query',
          description: 'Query data with conditions',
          inputSchema: {
            type: 'object',
            properties: {
              conditions: {
                type: 'array',
                items: {
                  type: 'array',
                  minItems: 3,
                  maxItems: 3,
                  items: { type: 'string' }
                },
                description: 'Array of [column, operator, value] conditions'
              },
              limit: {
                type: 'number',
                description: 'Maximum number of results to return'
              }
            },
            required: ['conditions'],
            additionalProperties: false
          }
        },
        {
          name: 'get',
          description: 'Get data by key',
          inputSchema: {
            type: 'object',
            properties: {
              key: {
                type: 'string',
                description: 'Key value to search for'
              }
            },
            required: ['key'],
            additionalProperties: false
          }
        },
        {
          name: 'update',
          description: 'Queue update for batch processing',
          inputSchema: {
            type: 'object',
            properties: {
              key: {
                type: 'string',
                description: 'Key value'
              },
              column: {
                type: 'string',
                description: 'Column name to update'
              },
              value: {
                type: 'string',
                description: 'New value'
              }
            },
            required: ['key', 'column', 'value'],
            additionalProperties: false
          }
        },
        {
          name: 'flush',
          description: 'Immediately update a cell',
          inputSchema: {
            type: 'object',
            properties: {
              key: {
                type: 'string',
                description: 'Key value'
              },
              column: {
                type: 'string',
                description: 'Column name to update'
              },
              value: {
                type: 'string',
                description: 'New value'
              }
            },
            required: ['key', 'column', 'value'],
            additionalProperties: false
          }
        },
        {
          name: 'append_value',
          description: 'Append value to existing cell content',
          inputSchema: {
            type: 'object',
            properties: {
              key: {
                type: 'string',
                description: 'Key value'
              },
              column: {
                type: 'string',
                description: 'Column name'
              },
              value: {
                type: 'string',
                description: 'Value to append'
              },
              separator: {
                type: 'string',
                description: 'Separator character (default: newline)'
              }
            },
            required: ['key', 'column', 'value'],
            additionalProperties: false
          }
        }
      ]
    }));
    
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const { name, arguments: args } = request.params;
        
        switch (name) {
          case 'configure':
            return await this.handleConfigure(args);
          case 'query':
            return await this.handleQuery(args);
          case 'get':
            return await this.handleGet(args);
          case 'update':
            return await this.handleUpdate(args);
          case 'flush':
            return await this.handleFlush(args);
          case 'append_value':
            return await this.handleAppendValue(args);
          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
      } catch (error) {
        this.logger.error('Tool execution error', { error: String(error) });
        throw error;
      }
    });
  }
  
  private async handleConfigure(args: any) {
    if (args.keyColumn) {
      this.sheetConfig.keyColumn = args.keyColumn;
    }
    
    if (args.headerRow !== undefined) {
      if (args.headerRow < 1) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'headerRow must be 1 or greater'
        );
      }
      this.sheetConfig.headerRow = args.headerRow;
    }
    
    return {
      content: [{
        type: 'text',
        text: '設定を更新しました'
      }]
    };
  }
  
  private async handleQuery(args: any) {
    const conditions = args.conditions || [];
    const limit = args.limit;
    
    const data = await this.sheetsClient.loadData();
    
    let results = data.rows.filter(row => {
      return conditions.every((condition: any[]) => {
        const [column, operator, value] = condition;
        const cellValue = row[column] || '';
        
        if (operator === '==') {
          return cellValue === value;
        } else if (operator === '!=') {
          return cellValue !== value;
        }
        
        return true;
      });
    });
    
    if (limit && limit > 0) {
      results = results.slice(0, limit);
    }
    
    const keyColumn = this.getKeyColumnName(data.headers);
    const keys = results.map(row => row[keyColumn]);
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ keys })
      }]
    };
  }
  
  private async handleGet(args: any) {
    const { key } = args;
    
    const data = await this.sheetsClient.loadData();
    const keyColumn = this.getKeyColumnName(data.headers);
    
    const row = data.rows.find(row => row[keyColumn] === key);
    
    if (!row) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ error: 'Key not found' })
        }]
      };
    }
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(row)
      }]
    };
  }
  
  private async handleUpdate(args: any) {
    const { key, column, value } = args;
    
    this.updateQueue.push({
      key,
      column,
      value,
      timestamp: Date.now()
    });
    
    this.scheduleBatchUpdate();
    
    return {
      content: [{
        type: 'text',
        text: '値を更新します'
      }]
    };
  }
  
  private async handleFlush(args: any) {
    const { key, column, value } = args;
    
    await this.sheetsClient.batchUpdate([{
      key,
      column,
      value,
      timestamp: Date.now()
    }]);
    
    return {
      content: [{
        type: 'text',
        text: '値を更新しました'
      }]
    };
  }
  
  private async handleAppendValue(args: any) {
    const { key, column, value, separator = '\n' } = args;
    
    const data = await this.sheetsClient.getCachedData();
    if (!data) {
      throw new Error('No cached data available');
    }
    
    const keyColumn = this.getKeyColumnName(data.headers);
    const row = data.rows.find(row => row[keyColumn] === key);
    
    const currentValue = row ? (row[column] || '') : '';
    const newValue = currentValue ? `${currentValue}${separator}${value}` : value;
    
    this.updateQueue.push({
      key,
      column,
      value: newValue,
      timestamp: Date.now()
    });
    
    this.scheduleBatchUpdate();
    
    return {
      content: [{
        type: 'text',
        text: '値を追記します'
      }]
    };
  }
  
  private scheduleBatchUpdate(): void {
    if (this.batchTimer || this.isShuttingDown) {
      return;
    }
    
    this.batchTimer = setTimeout(async () => {
      await this.executeBatchUpdate();
    }, this.config.batchInterval);
  }
  
  private async executeBatchUpdate(): Promise<void> {
    if (this.updateQueue.length === 0) {
      this.batchTimer = null;
      return;
    }
    
    const transactions = [...this.updateQueue];
    this.updateQueue = [];
    this.batchTimer = null;
    
    try {
      await this.sheetsClient.batchUpdate(transactions);
      this.logger.info('Batch update executed', { 
        transactionCount: transactions.length 
      });
    } catch (error) {
      this.logger.error('Batch update failed', { 
        error: String(error),
        transactions 
      });
      throw error;
    }
  }
  
  private setupShutdownHandlers(): void {
    const shutdown = async (signal: string) => {
      if (this.isShuttingDown) return;
      
      this.isShuttingDown = true;
      this.logger.info('Server shutting down', { signal });
      
      if (this.batchTimer) {
        clearTimeout(this.batchTimer);
      }
      
      if (this.updateQueue.length > 0) {
        try {
          await this.executeBatchUpdate();
        } catch (error) {
          this.logger.error('Failed to execute final batch update', {
            error: String(error),
            pendingTransactions: this.updateQueue
          });
        }
      }
      
      this.logger.info('Server stopped', {
        reason: signal,
        uptime_seconds: process.uptime()
      });
      
      process.exit(0);
    };
    
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }
  
  /**
   * 現在の設定に基づいてキーカラム名を取得
   */
  private getKeyColumnName(headers: string[]): string {
    // キーカラムが設定されていて、ヘッダーに含まれている場合はそれを使用
    if (this.sheetConfig.keyColumn && headers.includes(this.sheetConfig.keyColumn)) {
      return this.sheetConfig.keyColumn;
    }
    // そうでなければ最初のカラムを使用
    return headers[0] || 'A';
  }

  /**
   * Excel形式のカラム記号(A, B, C...)をインデックスに変換
   */
  private columnLetterToIndex(letter: string): number {
    const upperLetter = letter.toUpperCase();
    let index = 0;
    for (let i = 0; i < upperLetter.length; i++) {
      index = index * 26 + (upperLetter.charCodeAt(i) - 'A'.charCodeAt(0) + 1);
    }
    return index - 1; // 0-indexed
  }

  /**
   * キーカラムを解決する
   * 1. ヘッダー行のカラム名として存在するか確認
   * 2. Excel記法のカラム番号として評価
   * 3. どちらでもなければ最初のカラムを使用
   */
  private async resolveKeyColumn(): Promise<void> {
    if (!this.sheetConfig.keyColumn) return;

    const data = await this.sheetsClient.loadData();
    const headers = data.headers;

    // 1. カラム名として存在するか確認
    if (headers.includes(this.sheetConfig.keyColumn)) {
      // そのまま使用
      return;
    }

    // 2. Excel記法として評価
    if (/^[A-Z]+$/i.test(this.sheetConfig.keyColumn)) {
      const index = this.columnLetterToIndex(this.sheetConfig.keyColumn);
      if (index >= 0 && index < headers.length) {
        // インデックスに対応するカラム名を設定
        this.sheetConfig.keyColumn = headers[index];
        return;
      }
    }

    // 3. 最初のカラムを使用
    this.sheetConfig.keyColumn = headers[0] || 'A';
  }

  async start(): Promise<void> {
    try {
      await this.sheetsClient.initialize();
      
      // キーカラムの解決
      await this.resolveKeyColumn();
      
      this.logger.info('Server started', {
        spreadsheetId: this.config.spreadsheetId,
        sheetName: this.config.sheetName,
        config: {
          keyColumn: this.sheetConfig.keyColumn,
          headerRow: this.sheetConfig.headerRow,
          readInterval: this.config.readInterval,
          batchInterval: this.config.batchInterval
        }
      });
      
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
    } catch (error) {
      this.logger.error('Failed to start server', { error: String(error) });
      throw error;
    }
  }
}
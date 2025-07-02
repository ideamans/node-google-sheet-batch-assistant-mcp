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
    
    this.sheetsClient = new GoogleSheetsClient(
      config.spreadsheetId,
      config.sheetName,
      config.serviceAccountPath,
      config.readInterval
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
    
    const keyColumn = data.headers[0];
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
    const keyColumn = data.headers[0];
    
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
    
    const keyColumn = data.headers[0];
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
  
  async start(): Promise<void> {
    try {
      await this.sheetsClient.initialize();
      
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
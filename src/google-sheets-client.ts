import { GoogleSpreadsheet, GoogleSpreadsheetWorksheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { readFile } from 'fs/promises';
import { SheetData, UpdateTransaction } from './types.js';

export class GoogleSheetsClient {
  private doc: GoogleSpreadsheet | null = null;
  private sheet: GoogleSpreadsheetWorksheet | null = null;
  private cachedData: SheetData | null = null;
  private lastReadTime: number = 0;
  private readonly readInterval: number;
  private readonly maxRetries: number = 3;
  private headerRow: number = 1;
  
  constructor(
    private spreadsheetId: string,
    private sheetName: string,
    private serviceAccountPath: string,
    readInterval: number,
    headerRow: number = 1
  ) {
    this.readInterval = readInterval;
    this.headerRow = headerRow;
  }

  async initialize(): Promise<void> {
    try {
      const credsContent = await readFile(this.serviceAccountPath, 'utf8');
      const creds = JSON.parse(credsContent);
      
      const jwt = new JWT({
        email: creds.client_email,
        key: creds.private_key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });

      this.doc = new GoogleSpreadsheet(this.spreadsheetId, jwt);
      await this.doc.loadInfo();

      this.sheet = this.doc.sheetsByTitle[this.sheetName];
      if (!this.sheet) {
        throw new Error(`Sheet ${this.sheetName} not found`);
      }
    } catch (error) {
      throw new Error(`Failed to initialize Google Sheets client: ${error}`);
    }
  }

  private async retryOperation<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    let lastError: any;
    
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (attempt < this.maxRetries) {
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
      }
    }
    
    throw new Error(`${operationName} failed after ${this.maxRetries} attempts: ${lastError}`);
  }

  async loadData(force: boolean = false): Promise<SheetData> {
    const now = Date.now();
    
    if (!force && this.cachedData && (now - this.lastReadTime) < this.readInterval) {
      const waitTime = this.readInterval - (now - this.lastReadTime);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    if (!this.sheet) {
      throw new Error('Sheet not initialized');
    }

    const data = await this.retryOperation(async () => {
      if (!this.sheet) throw new Error('Sheet not initialized');
      
      let headers: string[];
      let rowData: Record<string, string>[];
      const keyToRowIndex = new Map<string, number>();
      const columnToIndex = new Map<string, number>();

      if (this.headerRow === 1) {
        // デフォルトの動作：google-spreadsheetが自動的に1行目をヘッダーとして使用
        const rows = await this.sheet.getRows();
        headers = this.sheet.headerValues;
        
        headers.forEach((header, index) => {
          columnToIndex.set(header, index);
        });
        
        rowData = rows.map((row, index) => {
          const obj: Record<string, string> = {};
          headers.forEach(header => {
            obj[header] = row.get(header) || '';
          });
          
          const keyColumn = headers[0];
          const keyValue = row.get(keyColumn);
          if (keyValue) {
            keyToRowIndex.set(keyValue, index + 2); // 1行目はヘッダー、データは2行目から
          }
          
          return obj;
        });
      } else {
        // カスタムヘッダー行の場合：手動でセルを読み込む
        await this.sheet.loadCells();
        
        // ヘッダー行を読み込む
        headers = [];
        for (let col = 0; col < this.sheet.columnCount; col++) {
          const cell = this.sheet.getCell(this.headerRow - 1, col);
          if (cell.value) {
            headers.push(String(cell.value));
          } else {
            break; // 空のセルが見つかったらヘッダーの終わり
          }
        }
        
        headers.forEach((header, index) => {
          columnToIndex.set(header, index);
        });
        
        // データ行を読み込む
        rowData = [];
        for (let row = this.headerRow; row < this.sheet.rowCount; row++) {
          const obj: Record<string, string> = {};
          let hasData = false;
          
          headers.forEach((header, colIndex) => {
            const cell = this.sheet!.getCell(row, colIndex);
            const value = cell.value ? String(cell.value) : '';
            obj[header] = value;
            if (value) hasData = true;
          });
          
          if (!hasData) break; // 空行が見つかったらデータの終わり
          
          const keyColumn = headers[0];
          const keyValue = obj[keyColumn];
          if (keyValue) {
            keyToRowIndex.set(keyValue, row + 1); // 0-indexedから1-indexedに変換
          }
          
          rowData.push(obj);
        }
      }
      
      return {
        headers,
        rows: rowData,
        keyToRowIndex,
        columnToIndex,
        lastFetchTime: Date.now()
      };
    }, 'Load data');
    
    this.cachedData = data;
    this.lastReadTime = Date.now();
    
    return data;
  }

  async batchUpdate(transactions: UpdateTransaction[]): Promise<void> {
    if (!this.sheet || !this.doc) {
      throw new Error('Sheet not initialized');
    }
    
    const data = await this.loadData(true);
    
    await this.retryOperation(async () => {
      if (!this.sheet) throw new Error('Sheet not initialized');
      
      await this.sheet.loadCells();
      
      for (const transaction of transactions) {
        const rowIndex = data.keyToRowIndex.get(transaction.key);
        const colIndex = data.columnToIndex.get(transaction.column);
        
        if (rowIndex !== undefined && colIndex !== undefined) {
          const cell = this.sheet.getCell(rowIndex - 1, colIndex);
          
          // 値の型を適切に設定（数値、ブール値、文字列）
          const trimmedValue = transaction.value.trim();
          
          // 数値として解析を試みる
          if (trimmedValue !== '' && !isNaN(Number(trimmedValue))) {
            cell.value = Number(trimmedValue);
          }
          // ブール値として解析
          else if (trimmedValue.toUpperCase() === 'TRUE') {
            cell.value = true;
          }
          else if (trimmedValue.toUpperCase() === 'FALSE') {
            cell.value = false;
          }
          // それ以外は文字列として設定
          else {
            cell.value = transaction.value;
          }
        }
      }
      
      await this.sheet.saveUpdatedCells();
    }, 'Batch update');
  }

  async getCachedData(): Promise<SheetData | null> {
    return this.cachedData;
  }

  getColumnLetter(columnName: string): string {
    const index = this.cachedData?.columnToIndex.get(columnName);
    if (index === undefined) return 'A';
    
    let letter = '';
    let num = index + 1;
    
    while (num > 0) {
      num--;
      letter = String.fromCharCode((num % 26) + 65) + letter;
      num = Math.floor(num / 26);
    }
    
    return letter;
  }
}
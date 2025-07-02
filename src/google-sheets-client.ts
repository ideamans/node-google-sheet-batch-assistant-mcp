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
  
  constructor(
    private spreadsheetId: string,
    private sheetName: string,
    private serviceAccountPath: string,
    readInterval: number
  ) {
    this.readInterval = readInterval;
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
      
      const rows = await this.sheet.getRows();
      const headers = this.sheet.headerValues;
      
      const keyToRowIndex = new Map<string, number>();
      const columnToIndex = new Map<string, number>();
      
      headers.forEach((header, index) => {
        columnToIndex.set(header, index);
      });
      
      const rowData = rows.map((row, index) => {
        const obj: Record<string, string> = {};
        headers.forEach(header => {
          obj[header] = row.get(header) || '';
        });
        
        const keyColumn = headers[0];
        const keyValue = row.get(keyColumn);
        if (keyValue) {
          keyToRowIndex.set(keyValue, index + 2);
        }
        
        return obj;
      });
      
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
          cell.value = transaction.value;
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
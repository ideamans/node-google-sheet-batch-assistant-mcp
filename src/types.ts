export interface ServerConfig {
  spreadsheetId: string;
  sheetName: string;
  serviceAccountPath: string;
  logFilePath: string;
  readInterval: number;
  batchInterval: number;
  keyColumn?: string;
  headerRow?: number;
}

export interface SheetConfig {
  keyColumn: string;
  headerRow: number;
}

export interface QueryCondition {
  column: string;
  operator: '==' | '!=';
  value: string;
}

export interface UpdateTransaction {
  key: string;
  column: string;
  value: string;
  timestamp: number;
}

export interface SheetData {
  headers: string[];
  rows: Record<string, string>[];
  keyToRowIndex: Map<string, number>;
  columnToIndex: Map<string, number>;
  lastFetchTime: number;
}
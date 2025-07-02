import { GoogleSpreadsheet, GoogleSpreadsheetWorksheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { TEST_HEADERS, TEST_DATA_INITIAL } from './test-data.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function setupTestSheet(): Promise<void> {
  const serviceAccountPath = path.join(__dirname, '../../service-account.json');
  
  const jwt = new JWT({
    keyFile: serviceAccountPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });

  const doc = new GoogleSpreadsheet(process.env.TEST_SHEET_ID!, jwt);
  await doc.loadInfo();

  const sheet = doc.sheetsByTitle[process.env.TEST_SHEET_NAME!];
  if (!sheet) {
    throw new Error(`Test sheet ${process.env.TEST_SHEET_NAME} not found`);
  }

  // Clear the sheet
  await sheet.clear();

  // Set headers
  await sheet.setHeaderRow(TEST_HEADERS);

  // Add test data
  await sheet.addRows(
    TEST_DATA_INITIAL.map(row => {
      const obj: Record<string, string> = {};
      TEST_HEADERS.forEach((header, index) => {
        obj[header] = row[index];
      });
      return obj;
    })
  );

  console.log('Test sheet initialized with', TEST_DATA_INITIAL.length, 'rows');
}

export async function getSheetData(): Promise<Record<string, string>[]> {
  const serviceAccountPath = path.join(__dirname, '../../service-account.json');
  
  const jwt = new JWT({
    keyFile: serviceAccountPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });

  const doc = new GoogleSpreadsheet(process.env.TEST_SHEET_ID!, jwt);
  await doc.loadInfo();

  const sheet = doc.sheetsByTitle[process.env.TEST_SHEET_NAME!];
  if (!sheet) {
    throw new Error(`Test sheet ${process.env.TEST_SHEET_NAME} not found`);
  }

  const rows = await sheet.getRows();

  return rows.map(row => {
    const obj: Record<string, string> = {};
    TEST_HEADERS.forEach(header => {
      obj[header] = row.get(header) || '';
    });
    return obj;
  });
}
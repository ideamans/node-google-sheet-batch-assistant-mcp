#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { GoogleSheetsMCPServer } from './server.js';
import { ServerConfig } from './types.js';
import path from 'path';

const argv = await yargs(hideBin(process.argv))
  .command(
    '$0 <spreadsheetId> <sheetName>',
    'Start Google Sheet Batch Assistant MCP Server',
    (yargs) => {
      return yargs
        .positional('spreadsheetId', {
          describe: 'Google Spreadsheet ID',
          type: 'string',
          demandOption: true
        })
        .positional('sheetName', {
          describe: 'Sheet name to operate on',
          type: 'string',
          demandOption: true
        });
    }
  )
  .option('service-account', {
    alias: 's',
    type: 'string',
    description: 'Path to service account JSON file',
    default: './service-account.json'
  })
  .option('log-file', {
    alias: 'l',
    type: 'string',
    description: 'Path to log file',
    default: './google-sheet-batch-assistant-mcp.log'
  })
  .option('read-interval', {
    alias: 'r',
    type: 'number',
    description: 'Read interval in milliseconds',
    default: 5000
  })
  .option('batch-interval', {
    alias: 'b',
    type: 'number',
    description: 'Batch update interval in milliseconds',
    default: 5000
  })
  .help()
  .alias('help', 'h')
  .parse();

const config: ServerConfig = {
  spreadsheetId: argv.spreadsheetId as string,
  sheetName: argv.sheetName as string,
  serviceAccountPath: path.resolve(argv.serviceAccount),
  logFilePath: path.resolve(argv.logFile),
  readInterval: argv.readInterval,
  batchInterval: argv.batchInterval
};

async function main() {
  try {
    const server = new GoogleSheetsMCPServer(config);
    await server.start();
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

main().catch(console.error);
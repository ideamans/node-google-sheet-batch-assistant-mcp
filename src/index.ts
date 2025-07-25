#!/usr/bin/env node

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { GoogleSheetsMCPServer } from "./server.js";
import { ServerConfig } from "./types.js";
import path from "path";

import Dotenv from "dotenv";

Dotenv.config();

const argv = await yargs(hideBin(process.argv))
  .command(
    "$0 <spreadsheetId> <sheetName>",
    "Start Google Sheet Batch Assistant MCP Server",
    (yargs) => {
      return yargs
        .positional("spreadsheetId", {
          describe: "Google Spreadsheet ID",
          type: "string",
          demandOption: true,
        })
        .positional("sheetName", {
          describe: "Sheet name to operate on",
          type: "string",
          demandOption: true,
        });
    }
  )
  .option("service-account", {
    alias: "s",
    type: "string",
    description: "Path to service account JSON file",
  })
  .option("log-file", {
    alias: "l",
    type: "string",
    description: "Path to log file",
    default: "./google-sheet-batch-assistant-mcp.log",
  })
  .option("read-interval", {
    alias: "r",
    type: "number",
    description: "Read interval in milliseconds",
    default: 5000,
  })
  .option("batch-interval", {
    alias: "b",
    type: "number",
    description: "Batch update interval in milliseconds",
    default: 5000,
  })
  .option("key", {
    alias: "k",
    type: "string",
    description: "Key column name or column letter (e.g., 'id' or 'A')",
    default: "A",
  })
  .option("header", {
    alias: "h",
    type: "number",
    description: "Header row number (1-based)",
    default: 1,
  })
  .help()
  .parse();

// サービスアカウントパスの決定
let serviceAccountPath: string;
if (argv.serviceAccount) {
  // オプションが指定されている場合
  serviceAccountPath = path.resolve(argv.serviceAccount);
} else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  // 環境変数が設定されている場合
  serviceAccountPath = path.resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS);
} else {
  // デフォルト値
  serviceAccountPath = path.resolve('./service-account.json');
}

// ヘッダー行の処理（1未満や数値変換できない場合は1）
const headerRow = Math.max(1, parseInt(argv.header?.toString() || '1', 10) || 1);

const config: ServerConfig = {
  spreadsheetId: argv.spreadsheetId as string,
  sheetName: argv.sheetName as string,
  serviceAccountPath,
  logFilePath: path.resolve(argv.logFile),
  readInterval: argv.readInterval,
  batchInterval: argv.batchInterval,
  keyColumn: argv.key as string,
  headerRow: headerRow,
};

async function main() {
  try {
    const server = new GoogleSheetsMCPServer(config);
    await server.start();
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

main().catch(console.error);

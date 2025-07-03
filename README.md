# Google Sheet Batch Assistant MCP Server

[日本語版はこちら](./README_ja.md)

An MCP (Model Context Protocol) server that enables AI agents to efficiently read and write Google Spreadsheets data. This library is designed for batch processing by AI agents, providing management of task lists, result data, and progress information through spreadsheets.

## Features

- **Batch Processing**: Updates are batched every 5 seconds to conserve API quota
- **Multi-Agent Support**: Optimistic locking allows multiple agents to work simultaneously
- **Auto-Retry**: Automatically retries up to 3 times on network errors
- **Graceful Shutdown**: Executes pending updates on termination

## Installation

```bash
npm install -g google-sheet-batch-assistant-mcp
```

Or build locally:

```bash
git clone https://github.com/ideamans/node-google-sheet-batch-assistant-mcp.git
cd node-google-sheet-batch-assistant-mcp
yarn install
yarn build
npm link
```

## Usage

### 1. Prepare Service Account

1. Create a project in [Google Cloud Console](https://console.cloud.google.com)
2. Enable Google Sheets API
3. Create a service account and download the JSON key
4. Share your spreadsheet with the service account email as an editor

### 2. Start the Server

```bash
google-sheet-batch-assistant-mcp <spreadsheetId> <sheetName> [options]
```

#### Options

- `--service-account <path>`: Path to service account JSON file (default: ./service-account.json)
- `--log-file <path>`: Path to log file (default: ./google-sheet-batch-assistant-mcp.log)
- `--read-interval <ms>`: Read interval in milliseconds (default: 5000)
- `--batch-interval <ms>`: Batch update interval in milliseconds (default: 5000)
- `--key, -k <keyColumn>`: Key column name or letter (e.g., 'id' or 'A') (default: A)
- `--header, -h <headerRow>`: Header row number (1-based) (default: 1)

### 3. Using from MCP Client

```javascript
// Configure settings
await client.callTool("configure", {
  keyColumn: "A",
  headerRow: 1,
});

// Query data
const result = await client.callTool("query", {
  conditions: [["status", "==", "pending"]],
  limit: 10,
});

// Get data by key
const data = await client.callTool("get", { key: "item001" });

// Update data (batched)
await client.callTool("update", {
  key: "item001",
  column: "status",
  value: "completed",
});

// Immediate update
await client.callTool("flush", {
  key: "item001",
  column: "lock",
  value: "agent1",
});

// Append value
await client.callTool("append_value", {
  key: "item001",
  column: "history",
  value: "2025-01-15: Process completed",
  separator: "\\n",
});
```

## Development

### Setup

```bash
git clone https://github.com/ideamans/node-google-sheet-batch-assistant-mcp.git
cd node-google-sheet-batch-assistant-mcp
yarn install
```

### Local Integration Testing

1. **Create a Service Account in GCP**

   - Create a project in [Google Cloud Console](https://console.cloud.google.com)
   - Go to "APIs & Services" → "Credentials" to create a service account
   - Click "Add Key" → "Create new key" → Select "JSON"

2. **Prepare Test Spreadsheet**

   - Create a new Google Spreadsheet
   - Share it with the service account email (`xxxx@xxxx.iam.gserviceaccount.com`) as an editor
   - Note the spreadsheet ID (the string between `/d/` and `/edit` in the URL)

3. **Configure Credentials**

   ```bash
   # Save service account key
   cp ~/Downloads/your-service-account-key.json ./service-account.json

   # Create environment file
   cp .env.example .env

   # Edit .env and set TEST_SHEET_ID
   # TEST_SHEET_ID=your-spreadsheet-id-here
   ```

4. **Run Tests**

   ```bash
   # Build
   yarn build

   # Unit tests
   yarn test

   # Integration tests
   yarn test:integration
   ```

### CI/CD Setup

Configure the following in GitHub repository Settings > Secrets and variables > Actions:

1. **SERVICE_ACCOUNT_JSON**: Complete JSON content of service account key
2. **TEST_SHEET_ID**: Test spreadsheet ID
3. **TEST_SHEET_NAME**: Test sheet name (default: `testing`)

### Local MCP Server Testing

1. **Prepare .mcp.json**

   ```bash
   cp .mcp.json.example .mcp.json
   ```

2. **Edit .mcp.json**

   ```json
   {
     "mcpServers": {
       "google-sheet-batch-assistant": {
         "command": "node",
         "args": ["dist/index.js", "your-spreadsheet-id-here", "live"]
       }
     }
   }
   ```

3. **Test with Claude**
   ```bash
   # Start MCP server and connect from Claude
   claude --mcp-config .mcp.json
   ```

## MCP Server Configuration

### Using with Claude Desktop

Add the following to your Claude Desktop MCP settings:

```json
{
  "mcpServers": {
    "backlog": {
      "command": "npx",
      "args": [
        "-y",
        "google-sheet-batch-assistant-mcp",
        "<sheetId>",
        "<sheetName>"
      ]
    }
  }
}
```

Replace `<sheetId>` with your Google Spreadsheet ID and `<sheetName>` with the target sheet name.

### Additional Configuration Options

You can add more options to the args array:

```json
{
  "mcpServers": {
    "backlog": {
      "command": "npx",
      "args": [
        "-y",
        "google-sheet-batch-assistant-mcp",
        "<sheetId>",
        "<sheetName>",
        "--service-account",
        "/path/to/service-account.json",
        "--read-interval",
        "3000",
        "--batch-interval",
        "3000",
        "--key",
        "task_id",
        "--header",
        "2"
      ]
    }
  }
}
```

### Build

```bash
yarn build
```

### Code Quality

```bash
# Type checking
yarn typecheck

# Linting
yarn lint
```

## License

MIT

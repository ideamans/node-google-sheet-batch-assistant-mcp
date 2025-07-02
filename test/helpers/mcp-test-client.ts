import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export interface ServerProcess {
  command: string;
  args: string[];
}

export class MCPTestClient {
  private client: Client;
  private transport: StdioClientTransport | null = null;

  constructor() {
    this.client = new Client({
      name: 'test-client',
      version: '1.0.0'
    }, {
      capabilities: {}
    });
  }

  async connect(serverProcess: ServerProcess): Promise<void> {
    this.transport = new StdioClientTransport({
      command: serverProcess.command,
      args: serverProcess.args
    });

    await this.client.connect(this.transport);
  }

  async callTool(name: string, params: any): Promise<any> {
    const result = await this.client.callTool({
      name,
      arguments: params
    });
    return result;
  }

  async disconnect(): Promise<void> {
    await this.client.close();
  }
}
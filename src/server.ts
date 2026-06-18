import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SERVER_NAME, SERVER_VERSION } from './config.js';
import { registerDiscoveryTools } from './tools/discovery.js';
import { registerLookupTools } from './tools/lookup.js';
import { registerSearchTools } from './tools/search.js';
import { registerAdminTools } from './tools/admin.js';

export function createServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  registerDiscoveryTools(server);
  registerLookupTools(server);
  registerSearchTools(server);
  registerAdminTools(server);

  return server;
}

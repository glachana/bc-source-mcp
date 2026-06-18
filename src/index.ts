#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { logger } from './utils/logger.js';

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('bc-source-mcp server started on stdio');
}

main().catch(err => {
  logger.fatal({ err }, 'Fatal error during startup');
  process.exit(1);
});

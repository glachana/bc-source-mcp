import pino from 'pino';

export const logger = pino({
  level: process.env.BC_SOURCE_LOG_LEVEL ?? 'info',
  base: { name: 'bc-source-mcp' },
}, pino.destination(2));

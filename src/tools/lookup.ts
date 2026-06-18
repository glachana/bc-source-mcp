import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { validateBranch } from '../git/branch-resolver.js';
import { ensureBranchIndexed } from '../index/indexer.js';
import { findObject, getBranchIndexInfo, listEventPublishers } from '../index/queries.js';
import { findProcedure } from '../parser/al-procedures.js';
import { logger } from '../utils/logger.js';

export function registerLookupTools(server: McpServer): void {
  server.registerTool(
    'bc_get_object',
    {
      title: 'Get the source of an AL object',
      description:
        'Returns the full AL source of a specific object (table, page, codeunit, report, enum, query, xmlport, or any extension). ' +
        'Identifies the object by branch + type + name (case-insensitive on type, exact on name). ' +
        'Triggers indexing on first use of a branch.',
      inputSchema: {
        branch: z.string().describe('Branch name, e.g. "w1-26"'),
        type: z.string().describe('AL object type, e.g. "table", "page", "codeunit"'),
        name: z.string().describe('Object name (without quotes), e.g. "Customer", "Sales Header"'),
      },
      outputSchema: {
        branch: z.string(),
        type: z.string(),
        id: z.number().nullable(),
        name: z.string(),
        app: z.string(),
        path: z.string(),
        ext_target: z.string().nullable(),
        source: z.string(),
        size_bytes: z.number(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ branch, type, name }) => {
      const v = validateBranch(branch);
      if (!v.ok) {
        return { content: [{ type: 'text', text: `Error: ${v.reason}` }], isError: true };
      }
      logger.info({ branch, type, name }, 'bc_get_object called');
      await ensureBranchIndexed(branch);

      const obj = findObject(branch, type, name);
      if (!obj) {
        return {
          content: [{
            type: 'text',
            text: `No object found matching type "${type}" and name "${name}" in branch "${branch}". ` +
              `Use bc_list_objects with name_pattern to search.`,
          }],
          isError: true,
        };
      }

      const info = getBranchIndexInfo(branch);
      if (!info?.worktree_path) {
        return {
          content: [{ type: 'text', text: `Internal error: branch "${branch}" has no worktree path.` }],
          isError: true,
        };
      }

      const fullPath = join(info.worktree_path, obj.path);
      let source: string;
      try {
        source = readFileSync(fullPath, 'utf8');
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Failed to read source at ${fullPath}: ${(err as Error).message}` }],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: `# ${obj.type} ${obj.id ?? ''} "${obj.name}"\n` +
              `Branch: ${branch} | App: ${obj.app} | Path: ${obj.path}\n` +
              (obj.ext_target ? `Extends: "${obj.ext_target}"\n` : '') +
              `\n\`\`\`al\n${source}\n\`\`\``,
          },
        ],
        structuredContent: {
          branch, type: obj.type, id: obj.id, name: obj.name, app: obj.app,
          path: obj.path, ext_target: obj.ext_target,
          source, size_bytes: Buffer.byteLength(source, 'utf8'),
        },
      };
    },
  );

  server.registerTool(
    'bc_get_event_publishers',
    {
      title: 'Get event publishers of an AL object',
      description:
        'Lists all event publishers ([IntegrationEvent], [BusinessEvent], [InternalEvent]) ' +
        'defined inside a specific AL object. Returns the event name, kind, full procedure signature, ' +
        'attribute, and source line. Useful for finding events to subscribe to.',
      inputSchema: {
        branch: z.string().describe('Branch name, e.g. "w1-26"'),
        source_type: z.string().describe('Container object type (typically "codeunit", but can be "table", "page", etc.)'),
        source_name: z.string().describe('Container object name, e.g. "Approvals Mgmt." (without quotes)'),
      },
      outputSchema: {
        branch: z.string(),
        source_type: z.string(),
        source_name: z.string(),
        total: z.number(),
        events: z.array(z.object({
          name: z.string(),
          kind: z.string(),
          signature: z.string(),
          attribute: z.string(),
          line: z.number(),
          path: z.string(),
        })),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ branch, source_type, source_name }) => {
      const v = validateBranch(branch);
      if (!v.ok) {
        return { content: [{ type: 'text', text: `Error: ${v.reason}` }], isError: true };
      }
      logger.info({ branch, source_type, source_name }, 'bc_get_event_publishers called');
      await ensureBranchIndexed(branch);

      const rows = listEventPublishers(branch, source_type, source_name);
      const events = rows.map(r => ({
        name: r.event_name, kind: r.event_kind, signature: r.signature,
        attribute: r.attribute, line: r.line, path: r.path,
      }));

      const summary = `${source_type} "${source_name}" in branch "${branch}" publishes ${events.length} event(s).`;
      const sample = events.slice(0, 20).map(e =>
        `  L${e.line}: [${e.kind}] ${e.signature}`
      ).join('\n');
      const more = events.length > 20 ? `\n  ... and ${events.length - 20} more` : '';

      return {
        content: [{ type: 'text', text: `${summary}\n${sample}${more}` }],
        structuredContent: { branch, source_type, source_name, total: events.length, events },
      };
    },
  );

  server.registerTool(
    'bc_get_procedure',
    {
      title: 'Get a specific procedure from an AL object',
      description:
        'Returns the signature, body, attributes, and modifier of a named procedure within an AL object. ' +
        'Useful when you only need a single procedure rather than the full object source.',
      inputSchema: {
        branch: z.string().describe('Branch name, e.g. "w1-26"'),
        object_type: z.string().describe('Type of the object containing the procedure, e.g. "codeunit"'),
        object_name: z.string().describe('Name of the object containing the procedure'),
        procedure_name: z.string().describe('Name of the procedure to retrieve (case-insensitive)'),
      },
      outputSchema: {
        branch: z.string(),
        object_type: z.string(),
        object_name: z.string(),
        path: z.string(),
        procedure: z.object({
          name: z.string(),
          modifier: z.string(),
          signature: z.string(),
          body: z.string(),
          attributes: z.array(z.string()),
          line: z.number(),
        }),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ branch, object_type, object_name, procedure_name }) => {
      const v = validateBranch(branch);
      if (!v.ok) {
        return { content: [{ type: 'text', text: `Error: ${v.reason}` }], isError: true };
      }
      logger.info({ branch, object_type, object_name, procedure_name }, 'bc_get_procedure called');
      await ensureBranchIndexed(branch);

      const obj = findObject(branch, object_type, object_name);
      if (!obj) {
        return {
          content: [{
            type: 'text',
            text: `No ${object_type} "${object_name}" found in branch "${branch}".`,
          }],
          isError: true,
        };
      }
      const info = getBranchIndexInfo(branch);
      if (!info?.worktree_path) {
        return {
          content: [{ type: 'text', text: 'Internal error: missing worktree path' }],
          isError: true,
        };
      }
      const source = readFileSync(join(info.worktree_path, obj.path), 'utf8');
      const proc = findProcedure(source, procedure_name);
      if (!proc) {
        return {
          content: [{
            type: 'text',
            text: `Procedure "${procedure_name}" not found in ${object_type} "${object_name}".`,
          }],
          isError: true,
        };
      }
      return {
        content: [{
          type: 'text',
          text: `# ${proc.modifier} procedure ${proc.name} (line ${proc.line})\n` +
            `In ${object_type} "${object_name}" — ${obj.path}\n\n` +
            (proc.attributes.length ? `Attributes:\n${proc.attributes.map(a => `  ${a}`).join('\n')}\n\n` : '') +
            `\`\`\`al\n${proc.signature}\n${proc.body}\n\`\`\``,
        }],
        structuredContent: {
          branch, object_type, object_name, path: obj.path,
          procedure: {
            name: proc.name, modifier: proc.modifier, signature: proc.signature,
            body: proc.body, attributes: proc.attributes, line: proc.line,
          },
        },
      };
    },
  );
}

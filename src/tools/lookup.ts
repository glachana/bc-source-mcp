import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { validateBranch } from '../git/branch-resolver.js';
import { ensureBranchIndexed } from '../index/indexer.js';
import { findObject, getBranchIndexInfo, listEventPublishers } from '../index/queries.js';
import { findProcedure } from '../parser/al-procedures.js';
import { logger } from '../utils/logger.js';

function safeJoinUnderWorktree(worktree: string, relPath: string): string | null {
  const wtAbs = resolve(worktree);
  const candidate = resolve(wtAbs, relPath);
  const wtPrefix = wtAbs.endsWith(sep) ? wtAbs : wtAbs + sep;
  if (candidate !== wtAbs && !candidate.startsWith(wtPrefix)) return null;
  return candidate;
}

export function registerLookupTools(server: McpServer): void {
  server.registerTool(
    'bc_get_object',
    {
      title: 'Get the source of an AL object',
      description:
        'Returns the AL source of a specific object (table, page, codeunit, report, enum, query, xmlport, or any extension). ' +
        'Identifies the object by branch + type + name (case-insensitive on type, exact on name). ' +
        'Triggers indexing on first use of a branch. ' +
        'Use line_start/line_end to fetch only a slice (1-indexed, inclusive) — useful for large objects (~100k lines). ' +
        'Use include_source=false to skip the source and get only metadata (size, total_lines).',
      inputSchema: {
        branch: z.string().min(1).max(64).describe('Branch name, e.g. "w1-26"'),
        type: z.string().min(1).max(64).describe('AL object type, e.g. "table", "page", "codeunit"'),
        name: z.string().min(1).max(256).describe('Object name (without quotes), e.g. "Customer", "Sales Header"'),
        line_start: z.number().int().min(1).optional().describe('Optional 1-indexed start line (inclusive). Default 1.'),
        line_end: z.number().int().min(1).optional().describe('Optional 1-indexed end line (inclusive). Default: last line.'),
        include_source: z.boolean().optional().describe('If false, omits the source string and returns only metadata. Default true.'),
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
        total_lines: z.number(),
        returned_lines: z.object({
          start: z.number(),
          end: z.number(),
        }),
        truncated: z.boolean(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ branch, type, name, line_start, line_end, include_source }) => {
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

      const fullPath = safeJoinUnderWorktree(info.worktree_path, obj.path);
      if (!fullPath) {
        return {
          content: [{ type: 'text', text: `Internal error: indexed path "${obj.path}" escapes worktree root.` }],
          isError: true,
        };
      }
      let fullSource: string;
      try {
        fullSource = readFileSync(fullPath, 'utf8');
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Failed to read source at ${fullPath}: ${(err as Error).message}` }],
          isError: true,
        };
      }

      const totalSizeBytes = Buffer.byteLength(fullSource, 'utf8');
      const allLines = fullSource.split(/\r?\n/);
      const totalLines = allLines.length;

      const wantSource = include_source !== false;
      const startEff = Math.max(1, line_start ?? 1);
      const endEff = Math.min(totalLines, line_end ?? totalLines);
      const truncated = startEff > 1 || endEff < totalLines;

      let returnedSource = '';
      if (wantSource) {
        if (truncated) {
          returnedSource = allLines.slice(startEff - 1, endEff).join('\n');
        } else {
          returnedSource = fullSource;
        }
      }

      const sourceHeader = wantSource
        ? `\n\`\`\`al\n${returnedSource}\n\`\`\``
        : '\n[source omitted: include_source=false]';
      const rangeLabel = truncated ? ` (lines ${startEff}-${endEff}/${totalLines})` : '';

      return {
        content: [
          {
            type: 'text',
            text: `# ${obj.type} ${obj.id ?? ''} "${obj.name}"${rangeLabel}\n` +
              `Branch: ${branch} | App: ${obj.app} | Path: ${obj.path}\n` +
              (obj.ext_target ? `Extends: "${obj.ext_target}"\n` : '') +
              sourceHeader,
          },
        ],
        structuredContent: {
          branch, type: obj.type, id: obj.id, name: obj.name, app: obj.app,
          path: obj.path, ext_target: obj.ext_target,
          source: returnedSource,
          size_bytes: totalSizeBytes,
          total_lines: totalLines,
          returned_lines: { start: startEff, end: endEff },
          truncated,
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
      const safePath = safeJoinUnderWorktree(info.worktree_path, obj.path);
      if (!safePath) {
        return {
          content: [{ type: 'text', text: `Internal error: indexed path "${obj.path}" escapes worktree root.` }],
          isError: true,
        };
      }
      const source = readFileSync(safePath, 'utf8');
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

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { isMetaBranch, validateBranch } from '../git/branch-resolver.js';
import { listRemoteBranches } from '../git/repo-manager.js';
import { ensureBranchIndexed } from '../index/indexer.js';
import { findObjectAcrossIndexedBranches, listApps, listObjects } from '../index/queries.js';
import { LOCALIZATIONS, VERSIONS } from '../config.js';
import { logger } from '../utils/logger.js';

export function registerDiscoveryTools(server: McpServer): void {
  server.registerTool(
    'bc_list_branches',
    {
      title: 'List branches',
      description:
        'Lists all branches available in the upstream BC sources repository (Stefan Maron mirror). ' +
        'Each branch corresponds to a (localization, version) pair, e.g. "w1-26", "fr-27-vNext". ' +
        'By default, meta/internal branches (main, base, core, serena) are filtered out. ' +
        'Set include_meta=true to include them.',
      inputSchema: {
        include_meta: z
          .boolean()
          .optional()
          .describe('Include non-code meta branches (main, base, core, serena). Default false.'),
      },
      outputSchema: {
        total: z.number(),
        branches: z.array(z.object({
          name: z.string(),
          sha: z.string(),
        })),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ include_meta }) => {
      logger.info({ include_meta }, 'bc_list_branches called');
      const all = await listRemoteBranches();
      const filtered = include_meta ? all : all.filter(b => !isMetaBranch(b.name));
      filtered.sort((a, b) => a.name.localeCompare(b.name));

      const summary = `Found ${filtered.length} branch(es)${include_meta ? '' : ' (meta branches excluded)'}.`;
      const sample = filtered.slice(0, 20).map(b => `  - ${b.name}`).join('\n');
      const more = filtered.length > 20 ? `\n  ... and ${filtered.length - 20} more` : '';

      return {
        content: [
          {
            type: 'text',
            text: `${summary}\n${sample}${more}`,
          },
        ],
        structuredContent: {
          total: filtered.length,
          branches: filtered,
        },
      };
    },
  );

  server.registerTool(
    'bc_list_versions',
    {
      title: 'List supported BC versions',
      description:
        'Lists the Business Central major versions for which sources are available in this MCP. ' +
        'Set include_vnext=true to also list the preview/-vNext variants.',
      inputSchema: {
        include_vnext: z.boolean().optional().describe('Also include vNext preview versions. Default false.'),
      },
      outputSchema: { versions: z.array(z.string()) },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ include_vnext }) => {
      const versions: string[] = [...VERSIONS];
      if (include_vnext) {
        for (const v of VERSIONS) versions.push(`${v}-vNext`);
      }
      versions.sort();
      return {
        content: [{ type: 'text', text: `Supported versions: ${versions.join(', ')}` }],
        structuredContent: { versions },
      };
    },
  );

  server.registerTool(
    'bc_list_localizations',
    {
      title: 'List supported BC localizations',
      description:
        'Lists the country/region codes available as branches in the upstream repository, ' +
        'with their human-readable names. "w1" is the worldwide base.',
      inputSchema: {},
      outputSchema: {
        localizations: z.array(z.object({
          code: z.string(),
          name: z.string(),
        })),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const txt = LOCALIZATIONS.map(l => `  - ${l.code}: ${l.name}`).join('\n');
      return {
        content: [{ type: 'text', text: `${LOCALIZATIONS.length} localizations available:\n${txt}` }],
        structuredContent: { localizations: LOCALIZATIONS },
      };
    },
  );

  server.registerTool(
    'bc_find_object_across_branches',
    {
      title: 'Find an object across indexed branches',
      description:
        'Searches for an AL object (by type and exact name) across all branches that have already ' +
        'been indexed in this MCP instance. Use this to compare presence/path of an object across ' +
        'versions or localizations. Does not trigger indexing — call bc_list_apps on a branch first ' +
        'if you want to include it.',
      inputSchema: {
        type: z.string().describe('AL object type (table, page, codeunit, ...)'),
        name: z.string().describe('Exact object name'),
        branches: z.array(z.string()).optional().describe(
          'Optional list of branches to restrict the search to (e.g. ["w1-26", "fr-26"]). ' +
          'If omitted, searches all indexed branches.',
        ),
      },
      outputSchema: {
        type: z.string(),
        name: z.string(),
        total: z.number(),
        results: z.array(z.object({
          branch: z.string(),
          type: z.string(),
          id: z.number().nullable(),
          name: z.string(),
          app: z.string(),
          path: z.string(),
        })),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ type, name, branches }) => {
      logger.info({ type, name, branches }, 'bc_find_object_across_branches called');
      const results = findObjectAcrossIndexedBranches(type, name, branches);
      const text = results.length === 0
        ? `${type} "${name}" not found in any indexed branch` +
            (branches ? ` (filter: ${branches.join(', ')})` : '') + '.'
        : `${type} "${name}" found in ${results.length} branch(es):\n` +
            results.map(r => `  - ${r.branch}: id=${r.id ?? 'n/a'}, app="${r.app}", path=${r.path}`).join('\n');
      return {
        content: [{ type: 'text', text }],
        structuredContent: {
          type, name, total: results.length, results,
        },
      };
    },
  );

  server.registerTool(
    'bc_list_apps',
    {
      title: 'List apps in a branch',
      description:
        'Lists top-level application folders in a given branch (e.g. "Base Application", "System Application", "Business Foundation"). ' +
        'If the branch has not been indexed yet, this triggers a first-time fetch + sparse-checkout + indexing (can take 1-5 minutes the first time).',
      inputSchema: {
        branch: z.string().describe('Branch name, e.g. "w1-26", "fr-27-vNext"'),
      },
      outputSchema: {
        branch: z.string(),
        apps: z.array(z.object({
          name: z.string(),
          object_count: z.number(),
        })),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ branch }) => {
      const v = validateBranch(branch);
      if (!v.ok) {
        return { content: [{ type: 'text', text: `Error: ${v.reason}` }], isError: true };
      }
      logger.info({ branch }, 'bc_list_apps called');
      await ensureBranchIndexed(branch);
      const apps = listApps(branch).map(a => ({ name: a.name, object_count: a.object_count }));
      return {
        content: [{
          type: 'text',
          text: `Branch "${branch}" — ${apps.length} app(s):\n` +
            apps.map(a => `  - ${a.name} (${a.object_count} objects)`).join('\n'),
        }],
        structuredContent: { branch, apps },
      };
    },
  );

  server.registerTool(
    'bc_list_objects',
    {
      title: 'List objects in a branch',
      description:
        'Lists AL objects in a branch, with optional filters by type, app, and name pattern. ' +
        'Use "*" as wildcard in name_pattern (translated to SQL LIKE %). Triggers indexing on first use of a branch.',
      inputSchema: {
        branch: z.string().describe('Branch name, e.g. "w1-26"'),
        type: z.string().optional().describe('AL object type filter (table, page, codeunit, report, enum, query, xmlport, tableextension, pageextension, etc.)'),
        app: z.string().optional().describe('App name filter (exact match), e.g. "Base Application"'),
        name_pattern: z.string().optional().describe('Name pattern with * wildcards, e.g. "Sales*", "*Header*"'),
        limit: z.number().int().min(1).max(1000).optional().describe('Max items to return. Default 100.'),
        offset: z.number().int().min(0).optional().describe('Pagination offset. Default 0.'),
      },
      outputSchema: {
        branch: z.string(),
        total: z.number(),
        offset: z.number(),
        limit: z.number(),
        items: z.array(z.object({
          type: z.string(),
          id: z.number().nullable(),
          name: z.string(),
          app: z.string(),
          path: z.string(),
          ext_target: z.string().nullable(),
        })),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ branch, type, app, name_pattern, limit, offset }) => {
      const v = validateBranch(branch);
      if (!v.ok) {
        return { content: [{ type: 'text', text: `Error: ${v.reason}` }], isError: true };
      }
      const effLimit = limit ?? 100;
      const effOffset = offset ?? 0;
      logger.info({ branch, type, app, name_pattern, limit: effLimit, offset: effOffset }, 'bc_list_objects called');
      await ensureBranchIndexed(branch);
      const r = listObjects({ branch, type, app, namePattern: name_pattern, limit: effLimit, offset: effOffset });
      const summary = `Branch "${branch}" — ${r.total} matching object(s)` +
        `, showing ${r.items.length} (offset ${effOffset}).`;
      const sample = r.items.slice(0, 30).map(o => {
        const idStr = o.id !== null ? ` ${o.id}` : '';
        const ext = o.ext_target ? ` extends "${o.ext_target}"` : '';
        return `  - ${o.type}${idStr} "${o.name}" [${o.app}]${ext}`;
      }).join('\n');
      const more = r.items.length > 30 ? `\n  ... and ${r.items.length - 30} more in this page` : '';
      return {
        content: [{ type: 'text', text: `${summary}\n${sample}${more}` }],
        structuredContent: {
          branch, total: r.total, offset: effOffset, limit: effLimit,
          items: r.items.map(i => ({
            type: i.type, id: i.id, name: i.name, app: i.app,
            path: i.path, ext_target: i.ext_target,
          })),
        },
      };
    },
  );
}

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { rgPath } from '@vscode/ripgrep';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { validateBranch } from '../git/branch-resolver.js';
import { ensureBranchIndexed } from '../index/indexer.js';
import { getBranchIndexInfo, listIndexedBranches, searchFts } from '../index/queries.js';
import { logger } from '../utils/logger.js';

interface RgMatch {
  path: string;
  line_number: number;
  text: string;
  is_context: boolean;
}

const TYPE_TO_GLOB: Record<string, string> = {
  table: '*.Table.al',
  page: '*.Page.al',
  codeunit: '*.Codeunit.al',
  report: '*.Report.al',
  enum: '*.Enum.al',
  query: '*.Query.al',
  xmlport: '*.XmlPort.al',
  tableextension: '*.TableExt.al',
  pageextension: '*.PageExt.al',
  enumextension: '*.EnumExt.al',
  reportextension: '*.ReportExt.al',
  permissionset: '*.PermissionSet.al',
  permissionsetextension: '*.PermissionSetExt.al',
  interface: '*.Interface.al',
  controladdin: '*.ControlAddIn.al',
};

interface RunRgOptions {
  cwd: string;
  pattern: string;
  ignoreCase: boolean;
  contextLines: number;
  maxResults: number;
  glob?: string;
  subdir?: string;
  timeoutMs?: number;
}

const RG_DEFAULT_TIMEOUT_MS = 30_000;

interface RgEvent {
  type: string;
  data?: {
    path?: { text?: string };
    line_number?: number;
    lines?: { text?: string };
    submatches?: Array<{ match: { text: string }; start: number; end: number }>;
  };
}

function runRipgrep(opts: RunRgOptions): Promise<RgMatch[]> {
  return new Promise((resolve, reject) => {
    const args = [
      '--json',
      '--no-messages',
      '-e', opts.pattern,
      '--glob', '*.al',
    ];
    if (opts.ignoreCase) args.push('-i');
    if (opts.contextLines > 0) args.push('-C', String(opts.contextLines));
    if (opts.glob) {
      args.push('--glob', opts.glob);
    }

    const searchRoot = opts.subdir
      ? join(opts.cwd, opts.subdir)
      : opts.cwd;

    if (!existsSync(searchRoot)) {
      resolve([]);
      return;
    }

    args.push(searchRoot);

    const child = spawn(rgPath, args, { cwd: opts.cwd });

    const results: RgMatch[] = [];
    let buffer = '';
    let stderr = '';
    let matchCount = 0;
    let killed = false;
    let timedOut = false;

    const timeoutMs = opts.timeoutMs ?? RG_DEFAULT_TIMEOUT_MS;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      killed = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', chunk => {
      if (killed) return;
      buffer += chunk.toString();
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let ev: RgEvent;
        try {
          ev = JSON.parse(line) as RgEvent;
        } catch {
          continue;
        }
        if (ev.type === 'match' || ev.type === 'context') {
          const path = ev.data?.path?.text ?? '';
          const line_number = ev.data?.line_number ?? 0;
          const text = (ev.data?.lines?.text ?? '').replace(/\r?\n$/, '');
          results.push({ path, line_number, text, is_context: ev.type === 'context' });
          if (ev.type === 'match') {
            matchCount++;
            if (matchCount >= opts.maxResults) {
              killed = true;
              child.kill('SIGKILL');
              child.stdout.destroy();
              child.stderr.destroy();
            }
          }
        }
      }
    });

    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });

    child.on('error', err => {
      clearTimeout(timeoutHandle);
      reject(err);
    });
    child.on('close', code => {
      clearTimeout(timeoutHandle);
      if (timedOut) {
        reject(new Error(`ripgrep timed out after ${timeoutMs}ms (pattern too broad or catastrophic regex?)`));
        return;
      }
      // ripgrep exit codes: 0 = matches found, 1 = no matches, 2 = error.
      // Killed (signal) means we hit our max — treat as success.
      if (killed || code === 0 || code === 1 || code === null) {
        resolve(results);
      } else {
        reject(new Error(`ripgrep exited with code ${code}: ${stderr}`));
      }
    });
  });
}

function normalizePath(absPath: string, worktree: string): string {
  return absPath.startsWith(worktree)
    ? absPath.slice(worktree.length + 1).replace(/\\/g, '/')
    : absPath.replace(/\\/g, '/');
}

export function registerSearchTools(server: McpServer): void {
  server.registerTool(
    'bc_search_code',
    {
      title: 'Full-text search in BC AL source code',
      description:
        'Searches AL source code in a branch using regular expressions (ripgrep). ' +
        'Returns matching lines with optional context. Filter by object_type (file suffix, e.g. "table" → "*.Table.al") ' +
        'or by app (top-level folder). Triggers indexing on first use of a branch (for the worktree).',
      inputSchema: {
        branch: z.string().min(1).max(64).describe('Branch name, e.g. "w1-26"'),
        pattern: z.string().min(1).max(1024).describe('Regular expression to search for'),
        object_type: z.string().max(64).optional().describe('Limit to a specific AL object type (table, page, codeunit, ...)'),
        app: z.string().max(128).optional().describe('Limit to a single top-level app folder, e.g. "Base Application"'),
        ignore_case: z.boolean().optional().describe('Case-insensitive search. Default false.'),
        max_results: z.number().int().min(1).max(500).optional().describe('Max number of matches (excluding context). Default 50.'),
        context_lines: z.number().int().min(0).max(10).optional().describe('Lines of context to include around each match. Default 2.'),
      },
      outputSchema: {
        branch: z.string(),
        pattern: z.string(),
        total_matches: z.number(),
        matches: z.array(z.object({
          path: z.string(),
          line: z.number(),
          text: z.string(),
          is_context: z.boolean(),
        })),
        truncated: z.boolean(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ branch, pattern, object_type, app, ignore_case, max_results, context_lines }) => {
      const v = validateBranch(branch);
      if (!v.ok) {
        return { content: [{ type: 'text', text: `Error: ${v.reason}` }], isError: true };
      }
      const maxResults = max_results ?? 50;
      const contextLines = context_lines ?? 2;
      const ignoreCase = ignore_case ?? false;

      logger.info({ branch, pattern, object_type, app, ignoreCase, maxResults, contextLines }, 'bc_search_code called');

      await ensureBranchIndexed(branch);
      const info = getBranchIndexInfo(branch);
      if (!info?.worktree_path) {
        return {
          content: [{ type: 'text', text: 'Internal error: missing worktree path' }],
          isError: true,
        };
      }

      const glob = object_type ? TYPE_TO_GLOB[object_type.toLowerCase()] : undefined;
      if (object_type && !glob) {
        return {
          content: [{
            type: 'text',
            text: `Unknown object_type "${object_type}". Supported: ${Object.keys(TYPE_TO_GLOB).join(', ')}.`,
          }],
          isError: true,
        };
      }

      const rawMatches = await runRipgrep({
        cwd: info.worktree_path,
        pattern,
        ignoreCase,
        contextLines,
        maxResults,
        glob,
        subdir: app,
      });

      const matches = rawMatches.map(m => ({
        path: normalizePath(m.path, info.worktree_path!),
        line: m.line_number,
        text: m.text,
        is_context: m.is_context,
      }));

      const matchOnly = matches.filter(m => !m.is_context);
      const truncated = matchOnly.length >= maxResults;

      const summary = `Pattern /${pattern}/${ignoreCase ? 'i' : ''} in ${branch}` +
        (app ? ` (app="${app}")` : '') +
        (object_type ? ` (type=${object_type})` : '') +
        ` — ${matchOnly.length} match(es)` + (truncated ? ' (truncated)' : '') + '.';

      const sample = matchOnly.slice(0, 30).map(m =>
        `  ${m.path}:${m.line}: ${m.text.trim().slice(0, 200)}`
      ).join('\n');
      const more = matchOnly.length > 30 ? `\n  ... and ${matchOnly.length - 30} more` : '';

      return {
        content: [{ type: 'text', text: `${summary}\n${sample}${more}` }],
        structuredContent: {
          branch, pattern,
          total_matches: matchOnly.length,
          matches, truncated,
        },
      };
    },
  );

  server.registerTool(
    'bc_search_fts',
    {
      title: 'Full-text search via FTS5 (cross-branch capable)',
      description:
        'Token-based full-text search across indexed AL sources using SQLite FTS5. ' +
        'Faster than bc_search_code (no disk re-scan) and supports cross-branch queries. ' +
        'Use FTS5 syntax: bare terms ("Customer Posting"), phrases ("\\"Sales Header\\""), boolean (term1 AND term2), prefixes (Cust*). ' +
        'Returns ranked snippets with matched tokens wrapped in <<...>>. ' +
        'For regex patterns, prefer bc_search_code.',
      inputSchema: {
        query: z.string().min(1).max(1024).describe(
          'FTS5 query, e.g. "OnAfterPost", "\\"Sales Header\\" AND Customer", "Approv*".',
        ),
        branches: z.array(z.string().min(1).max(64)).max(50).optional().describe(
          'Optional list of branches to search (must already be indexed). If omitted, all indexed branches.',
        ),
        app: z.string().max(128).optional().describe('Restrict to a single top-level app (exact match), e.g. "Base Application".'),
        object_type: z.string().max(64).optional().describe('Restrict to a specific AL object type.'),
        limit: z.number().int().min(1).max(500).optional().describe('Max matches to return. Default 50.'),
        offset: z.number().int().min(0).optional().describe('Pagination offset. Default 0.'),
      },
      outputSchema: {
        query: z.string(),
        total: z.number(),
        offset: z.number(),
        limit: z.number(),
        items: z.array(z.object({
          branch: z.string(),
          app: z.string(),
          type: z.string(),
          name: z.string(),
          path: z.string(),
          snippet: z.string(),
          score: z.number(),
        })),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ query, branches, app, object_type, limit, offset }) => {
      const effLimit = limit ?? 50;
      const effOffset = offset ?? 0;

      if (branches) {
        for (const b of branches) {
          const v = validateBranch(b);
          if (!v.ok) {
            return { content: [{ type: 'text', text: `Error in branches[]: ${v.reason}` }], isError: true };
          }
        }
      }

      const allIndexed = listIndexedBranches().map(b => b.name);
      if (allIndexed.length === 0) {
        return {
          content: [{ type: 'text', text: 'No branch has been indexed yet — call bc_list_apps on a branch first.' }],
          structuredContent: { query, total: 0, offset: effOffset, limit: effLimit, items: [] },
        };
      }

      const targets = branches
        ? branches.filter(b => allIndexed.includes(b))
        : allIndexed;

      if (branches && targets.length < branches.length) {
        const missing = branches.filter(b => !allIndexed.includes(b));
        logger.warn({ missing }, 'bc_search_fts: some branches are not indexed and will be skipped');
      }

      logger.info({ query, targets, app, object_type, limit: effLimit, offset: effOffset }, 'bc_search_fts called');

      let r;
      try {
        r = searchFts({
          query, branches: targets, app, type: object_type,
          limit: effLimit, offset: effOffset,
        });
      } catch (err) {
        return {
          content: [{
            type: 'text',
            text: `FTS5 query failed: ${(err as Error).message}. Check FTS5 syntax — bare terms, "phrases", AND/OR/NOT, prefix*.`,
          }],
          isError: true,
        };
      }

      const summary = `FTS query \`${query}\` across ${targets.length} branch(es)` +
        (app ? ` (app="${app}")` : '') +
        (object_type ? ` (type=${object_type})` : '') +
        ` — ${r.total} match(es), showing ${r.items.length} (offset ${effOffset}).`;
      const sample = r.items.slice(0, 20).map(m =>
        `  [${m.branch}] ${m.type} "${m.name}" — ${m.path}\n    ${m.snippet.replace(/\s+/g, ' ').slice(0, 200)}`,
      ).join('\n');

      return {
        content: [{ type: 'text', text: `${summary}\n${sample}` }],
        structuredContent: {
          query, total: r.total, offset: effOffset, limit: effLimit,
          items: r.items,
        },
      };
    },
  );
}

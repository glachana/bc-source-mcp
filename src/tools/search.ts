import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { rgPath } from '@vscode/ripgrep';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { validateBranch } from '../git/branch-resolver.js';
import { ensureBranchIndexed } from '../index/indexer.js';
import { getBranchIndexInfo } from '../index/queries.js';
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
}

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

    child.on('error', err => reject(err));
    child.on('close', code => {
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
        branch: z.string().describe('Branch name, e.g. "w1-26"'),
        pattern: z.string().describe('Regular expression to search for'),
        object_type: z.string().optional().describe('Limit to a specific AL object type (table, page, codeunit, ...)'),
        app: z.string().optional().describe('Limit to a single top-level app folder, e.g. "Base Application"'),
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
}

import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { simpleGit, type SimpleGit } from 'simple-git';
import { CACHE_ROOT, REPO_DIR, REPO_URL, WORKTREES_DIR } from '../config.js';
import { logger } from '../utils/logger.js';

let cachedRepo: SimpleGit | null = null;

function ensureCacheDirs(): void {
  if (!existsSync(CACHE_ROOT)) mkdirSync(CACHE_ROOT, { recursive: true });
  if (!existsSync(WORKTREES_DIR)) mkdirSync(WORKTREES_DIR, { recursive: true });
}

export async function ensureRepo(): Promise<SimpleGit> {
  if (cachedRepo) return cachedRepo;

  ensureCacheDirs();

  if (!existsSync(join(REPO_DIR, '.git'))) {
    logger.info({ url: REPO_URL, dest: REPO_DIR }, 'Partial clone of upstream repo (one-time, ~500MB-1GB)');
    const cloner = simpleGit();
    await cloner.clone(REPO_URL, REPO_DIR, [
      '--filter=blob:none',
      '--no-checkout',
    ]);
    logger.info('Partial clone completed');
  }

  cachedRepo = simpleGit(REPO_DIR);
  return cachedRepo;
}

export interface RemoteBranchInfo {
  name: string;
  sha: string;
}

export async function listRemoteBranches(): Promise<RemoteBranchInfo[]> {
  const git = await ensureRepo();
  const raw = await git.raw(['ls-remote', '--heads', 'origin']);
  const branches: RemoteBranchInfo[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [sha, ref] = trimmed.split(/\s+/);
    if (!sha || !ref) continue;
    const name = ref.replace(/^refs\/heads\//, '');
    branches.push({ name, sha });
  }
  return branches;
}

export async function fetchBranch(branch: string): Promise<void> {
  const git = await ensureRepo();
  logger.info({ branch }, 'Fetching branch from origin');
  await git.raw([
    'fetch',
    '--no-tags',
    'origin',
    `${branch}:refs/remotes/origin/${branch}`,
  ]);
}

export function worktreePath(branch: string): string {
  return join(WORKTREES_DIR, branch);
}

export async function hasWorktree(branch: string): Promise<boolean> {
  return existsSync(join(worktreePath(branch), '.git'));
}

export async function ensureWorktree(branch: string): Promise<string> {
  const git = await ensureRepo();
  const wtPath = worktreePath(branch);

  if (!existsSync(join(wtPath, '.git'))) {
    logger.info({ branch, wtPath }, 'Creating worktree (full checkout, blobs fetched on demand)');
    await git.raw([
      'worktree', 'add',
      '-B', branch,
      wtPath,
      `origin/${branch}`,
    ]);
  }

  return wtPath;
}

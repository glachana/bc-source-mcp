import { LOCALIZATION_CODES, META_BRANCHES, VERSIONS } from '../config.js';

export interface ParsedBranch {
  localization: string;
  version: string;
  vNext: boolean;
}

const BRANCH_RE = /^([a-z0-9]+)-(\d+)(-vNext)?$/;

export function parseBranchName(branch: string): ParsedBranch | null {
  const m = BRANCH_RE.exec(branch);
  if (!m) return null;
  return {
    localization: m[1]!,
    version: m[2]! + (m[3] ?? ''),
    vNext: m[3] !== undefined,
  };
}

export function buildBranchName(localization: string, version: string): string {
  return `${localization}-${version}`;
}

export function isMetaBranch(branch: string): boolean {
  if (META_BRANCHES.has(branch)) return true;
  const parsed = parseBranchName(branch);
  if (!parsed) return true;
  return META_BRANCHES.has(parsed.localization);
}

export interface BranchValidationError {
  ok: false;
  reason: string;
}
export interface BranchValidationOk {
  ok: true;
  branch: string;
  parsed: ParsedBranch;
}
export type BranchValidationResult = BranchValidationOk | BranchValidationError;

export function validateBranch(branch: string): BranchValidationResult {
  const parsed = parseBranchName(branch);
  if (!parsed) {
    return {
      ok: false,
      reason: `Branch name "${branch}" does not match the expected pattern "<localization>-<version>[-vNext]" (e.g. "w1-26", "fr-27-vNext").`,
    };
  }
  if (!LOCALIZATION_CODES.has(parsed.localization)) {
    return {
      ok: false,
      reason: `Unknown localization "${parsed.localization}". Use bc_list_localizations to see valid codes.`,
    };
  }
  const baseVersion = parsed.version.replace(/-vNext$/, '');
  if (!(VERSIONS as readonly string[]).includes(baseVersion)) {
    return {
      ok: false,
      reason: `Unknown version "${baseVersion}". Use bc_list_versions to see valid versions.`,
    };
  }
  return { ok: true, branch, parsed };
}

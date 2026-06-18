import { describe, it, expect } from 'vitest';
import {
  parseBranchName,
  buildBranchName,
  isMetaBranch,
  validateBranch,
} from '../src/git/branch-resolver.js';

describe('parseBranchName', () => {
  it('parses standard branches', () => {
    expect(parseBranchName('w1-26')).toEqual({
      localization: 'w1', version: '26', vNext: false,
    });
    expect(parseBranchName('fr-23')).toEqual({
      localization: 'fr', version: '23', vNext: false,
    });
  });

  it('parses vNext branches', () => {
    expect(parseBranchName('fr-26-vNext')).toEqual({
      localization: 'fr', version: '26-vNext', vNext: true,
    });
    expect(parseBranchName('us-29-vNext')).toEqual({
      localization: 'us', version: '29-vNext', vNext: true,
    });
  });

  it('returns null for invalid names', () => {
    expect(parseBranchName('main')).toBeNull();
    expect(parseBranchName('serena')).toBeNull();
    expect(parseBranchName('foo-bar')).toBeNull();
    expect(parseBranchName('')).toBeNull();
  });
});

describe('buildBranchName', () => {
  it('builds canonical names', () => {
    expect(buildBranchName('w1', '26')).toBe('w1-26');
    expect(buildBranchName('fr', '26-vNext')).toBe('fr-26-vNext');
  });
});

describe('isMetaBranch', () => {
  it('flags exact meta names', () => {
    expect(isMetaBranch('main')).toBe(true);
    expect(isMetaBranch('base')).toBe(true);
    expect(isMetaBranch('core')).toBe(true);
    expect(isMetaBranch('serena')).toBe(true);
  });

  it('flags meta-prefixed versioned branches', () => {
    expect(isMetaBranch('base-26')).toBe(true);
    expect(isMetaBranch('core-27-vNext')).toBe(true);
    expect(isMetaBranch('serena-28')).toBe(true);
  });

  it('flags unparseable branches as meta', () => {
    expect(isMetaBranch('random-stuff')).toBe(true);
    expect(isMetaBranch('xyz')).toBe(true);
  });

  it('does not flag real code branches', () => {
    expect(isMetaBranch('w1-26')).toBe(false);
    expect(isMetaBranch('fr-27-vNext')).toBe(false);
    expect(isMetaBranch('us-23')).toBe(false);
  });
});

describe('validateBranch', () => {
  it('accepts valid branches', () => {
    const r = validateBranch('w1-26');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.parsed.localization).toBe('w1');
      expect(r.parsed.version).toBe('26');
    }
  });

  it('accepts vNext', () => {
    expect(validateBranch('fr-29-vNext').ok).toBe(true);
  });

  it('rejects unknown localization', () => {
    const r = validateBranch('xx-26');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/localization/i);
  });

  it('rejects unknown version', () => {
    const r = validateBranch('w1-99');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/version/i);
  });

  it('rejects malformed names', () => {
    const r = validateBranch('not-a-branch-name');
    expect(r.ok).toBe(false);
  });
});

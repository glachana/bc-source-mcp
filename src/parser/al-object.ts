export type AlObjectType =
  | 'table'
  | 'page'
  | 'codeunit'
  | 'report'
  | 'query'
  | 'xmlport'
  | 'enum'
  | 'tableextension'
  | 'pageextension'
  | 'enumextension'
  | 'reportextension'
  | 'permissionset'
  | 'permissionsetextension'
  | 'interface'
  | 'controladdin'
  | 'profile'
  | 'pagecustomization'
  | 'entitlement'
  | 'dotnet';

export interface AlObjectHeader {
  type: AlObjectType;
  id: number | null;
  name: string;
  extends: string | null;
}

const OBJECT_TYPES: AlObjectType[] = [
  'tableextension', 'pageextension', 'enumextension', 'reportextension',
  'permissionsetextension',
  'table', 'page', 'codeunit', 'report', 'query', 'xmlport', 'enum',
  'permissionset',
  'interface', 'controladdin', 'profile', 'pagecustomization', 'entitlement', 'dotnet',
];

const HEADER_RE = new RegExp(
  '^(' + OBJECT_TYPES.join('|') + ')' +
  '\\s+(?:(\\d+)\\s+)?' +
  '("[^"]+"|[A-Za-z_][\\w]*)' +
  '(?:\\s+extends\\s+("[^"]+"|[A-Za-z_][\\w]*))?',
  'i',
);

function unquote(s: string): string {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1);
  }
  return s;
}

function stripBlockComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

function isSkippableLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed === '') return true;
  if (trimmed.startsWith('//')) return true;
  if (trimmed.startsWith('#pragma')) return true;
  if (trimmed.startsWith('#region') || trimmed.startsWith('#endregion')) return true;
  // BC v26+ namespace directives (appear before the object declaration)
  if (/^namespace\s/i.test(trimmed)) return true;
  if (/^using\s/i.test(trimmed)) return true;
  return false;
}

/**
 * Parses the object declaration from an AL source string.
 * Returns null if the source does not contain a recognizable object header.
 * Only inspects the first ~50 lines to keep parsing fast.
 */
export function parseObjectHeader(source: string): AlObjectHeader | null {
  // Read up to 64KB of the source — enough to skip large namespace+using preambles
  // (e.g. Customer.Table.al has ~58 using lines before the declaration in BC v26+).
  const head = stripBlockComments(source.slice(0, 65_536));
  const lines = head.split(/\r?\n/);

  for (const rawLine of lines) {
    if (isSkippableLine(rawLine)) continue;
    const noLineComment = rawLine.replace(/\/\/.*$/, '').trim();
    if (!noLineComment) continue;

    const m = HEADER_RE.exec(noLineComment);
    if (!m) {
      return null;
    }

    const type = m[1]!.toLowerCase() as AlObjectType;
    const id = m[2] ? parseInt(m[2], 10) : null;
    const name = unquote(m[3]!);
    const extendsTarget = m[4] ? unquote(m[4]) : null;

    return { type, id, name, extends: extendsTarget };
  }

  return null;
}

/**
 * Extracts the "app" name (top-level folder) from a path relative to the worktree root.
 * E.g. "Base Application/Src/Sales/Cust.Table.al" -> "Base Application".
 */
export function appFromPath(relPath: string): string {
  const parts = relPath.replace(/\\/g, '/').split('/');
  return parts[0] ?? '';
}

export interface AlProcedure {
  name: string;
  signature: string;
  body: string;
  attributes: string[];
  line: number;
  modifier: 'local' | 'internal' | 'protected' | 'public';
}

function findMatchingParen(source: string, openIdx: number): number {
  let depth = 1;
  let i = openIdx + 1;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (depth === 0) return i;
    i++;
  }
  return -1;
}

function lineOf(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === '\n') line++;
  }
  return line;
}

/**
 * Finds the closing `end;` of an AL procedure body starting at the position
 * just after `begin`. Tracks nested begin/end pairs and ignores them in
 * strings/comments (simplified — assumes well-formed AL).
 */
function findMatchingEnd(source: string, beginEndIdx: number): number {
  const tokens = /\bbegin\b|\bend\b|\/\/[^\n]*|\/\*[\s\S]*?\*\/|'(?:[^'\\]|\\.)*'/gi;
  tokens.lastIndex = beginEndIdx;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = tokens.exec(source)) !== null) {
    const tok = m[0]!.toLowerCase();
    if (tok === 'begin') depth++;
    else if (tok === 'end') {
      depth--;
      if (depth === 0) return m.index + m[0]!.length;
    }
  }
  return -1;
}

/**
 * Extracts a procedure named `targetName` from the AL source, including any
 * attribute decorations on the immediately-preceding non-blank lines.
 * Returns null if no procedure with that name is found.
 */
export function findProcedure(source: string, targetName: string): AlProcedure | null {
  const PROC_RE = /(?:^|\r?\n)([ \t]*)((?:\[(?:[^\]\r\n]|\][^\r\n]*?)+\][ \t]*\r?\n[ \t]*)*)((?:local|internal|protected)\s+)?procedure\s+(\w+)\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = PROC_RE.exec(source)) !== null) {
    const name = m[4]!;
    if (name.toLowerCase() !== targetName.toLowerCase()) continue;

    const attrsBlock = m[2] ?? '';
    const modifierKw = (m[3] ?? '').trim().toLowerCase();
    const modifier =
      modifierKw === 'local' ? 'local' :
      modifierKw === 'internal' ? 'internal' :
      modifierKw === 'protected' ? 'protected' : 'public';

    const procStart = m.index + (m[0]!.startsWith('\n') ? 1 : 0) + (m[1] ?? '').length;
    const openParenAbs = m.index + m[0]!.length - 1;
    const closeParenAbs = findMatchingParen(source, openParenAbs);
    if (closeParenAbs < 0) return null;

    let sigEnd = closeParenAbs + 1;
    const tail = source.slice(sigEnd, sigEnd + 200);
    const retMatch = /^[ \t]*(?:\w+[ \t]*)?:[ \t]*[^;\n{]+/.exec(tail);
    if (retMatch) sigEnd += retMatch[0]!.length;

    const beginRe = /\bbegin\b/gi;
    beginRe.lastIndex = sigEnd;
    const beginMatch = beginRe.exec(source);
    if (!beginMatch) return null;
    const bodyStart = beginMatch.index;
    const bodyEnd = findMatchingEnd(source, beginMatch.index + beginMatch[0].length);
    if (bodyEnd < 0) return null;

    const signature = source.slice(procStart, sigEnd).trim().replace(/\s+/g, ' ');
    const body = source.slice(bodyStart, bodyEnd);

    const attributes: string[] = [];
    if (attrsBlock) {
      const attrRe = /\[(?:[^\]\n]|\][^\n]*?)+\]/g;
      let am: RegExpExecArray | null;
      while ((am = attrRe.exec(attrsBlock)) !== null) {
        attributes.push(am[0]!);
      }
    }

    return {
      name,
      signature,
      body,
      attributes,
      line: lineOf(source, procStart),
      modifier,
    };
  }
  return null;
}

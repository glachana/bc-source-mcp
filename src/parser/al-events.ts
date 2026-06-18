export type AlEventKind = 'IntegrationEvent' | 'BusinessEvent' | 'InternalEvent';

export interface AlEventPublisher {
  kind: AlEventKind;
  name: string;
  signature: string;
  line: number;
  attribute: string;
}

const EVENT_ATTR_RE = /\[(IntegrationEvent|BusinessEvent|InternalEvent)\s*\(([^\]]*)\)\s*\]/gi;

const PROCEDURE_RE = /\b((?:local|internal|protected)\s+)?procedure\s+(\w+)\s*\(/i;

function normalizeKind(raw: string): AlEventKind {
  const lower = raw.toLowerCase();
  if (lower === 'integrationevent') return 'IntegrationEvent';
  if (lower === 'businessevent') return 'BusinessEvent';
  return 'InternalEvent';
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

export function extractEventPublishers(source: string): AlEventPublisher[] {
  const results: AlEventPublisher[] = [];
  EVENT_ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = EVENT_ATTR_RE.exec(source)) !== null) {
    const kind = normalizeKind(m[1]!);
    const attribute = m[0];
    const attrEnd = m.index + m[0].length;

    const after = source.slice(attrEnd);
    const procMatch = PROCEDURE_RE.exec(after);
    if (!procMatch) continue;

    const procName = procMatch[2]!;
    const procStartInAfter = procMatch.index;
    const openParenInAfter = procMatch.index + procMatch[0].length - 1;
    const openParenAbs = attrEnd + openParenInAfter;
    const closeParenAbs = findMatchingParen(source, openParenAbs);
    if (closeParenAbs < 0) continue;

    let sigEnd = closeParenAbs + 1;
    const tail = source.slice(sigEnd, sigEnd + 200);
    // Optional return type: ": Type" or "Name: Type"
    const retMatch = /^[ \t]*(?:\w+[ \t]*)?:[ \t]*[^;\n{]+/.exec(tail);
    if (retMatch) {
      sigEnd += retMatch[0]!.length;
    }

    const procStartAbs = attrEnd + procStartInAfter;
    const signature = source.slice(procStartAbs, sigEnd).trim().replace(/\s+/g, ' ');

    results.push({
      kind,
      name: procName,
      signature,
      line: lineOf(source, procStartAbs),
      attribute,
    });
  }

  return results;
}

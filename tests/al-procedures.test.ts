import { describe, it, expect } from 'vitest';
import { findProcedure } from '../src/parser/al-procedures.js';

describe('findProcedure', () => {
  it('extracts a basic procedure', () => {
    const src = `
codeunit 1 Foo
{
    procedure DoSomething(var X: Integer)
    begin
        X := X + 1;
    end;
}
`;
    const p = findProcedure(src, 'DoSomething');
    expect(p).not.toBeNull();
    expect(p?.name).toBe('DoSomething');
    expect(p?.modifier).toBe('public');
    expect(p?.signature).toContain('procedure DoSomething(var X: Integer)');
    expect(p?.body).toContain('X := X + 1');
    expect(p?.body).toMatch(/end$/);
  });

  it('captures local modifier', () => {
    const src = `
local procedure Helper()
begin
end;
`;
    const p = findProcedure(src, 'Helper');
    expect(p?.modifier).toBe('local');
  });

  it('captures internal modifier', () => {
    const src = `
internal procedure Foo(): Integer
begin
    exit(42);
end;
`;
    const p = findProcedure(src, 'Foo');
    expect(p?.modifier).toBe('internal');
    expect(p?.signature).toMatch(/:\s*Integer/);
  });

  it('captures attributes on preceding lines', () => {
    const src = `
[IntegrationEvent(false, false)]
[Obsolete('Use OnAfterPostV2 instead', '24.0')]
procedure OnAfterPost()
begin
end;
`;
    const p = findProcedure(src, 'OnAfterPost');
    expect(p?.attributes).toHaveLength(2);
    expect(p?.attributes[0]).toContain('IntegrationEvent');
    expect(p?.attributes[1]).toContain('Obsolete');
  });

  it('handles nested begin/end inside the body', () => {
    const src = `
procedure Outer()
begin
    if X then begin
        Y := 1;
    end;
    case Z of
        1: begin Y := 2; end;
    end;
end;
`;
    const p = findProcedure(src, 'Outer');
    expect(p).not.toBeNull();
    expect(p?.body).toContain('case Z of');
    expect(p?.body).toMatch(/end$/);
  });

  it('handles begin/end inside strings without breaking', () => {
    const src = `
procedure SaySomething()
begin
    Message('Press begin and then end to finish');
end;
`;
    const p = findProcedure(src, 'SaySomething');
    expect(p?.body).toContain("Message('Press begin and then end to finish')");
  });

  it('handles begin/end inside comments', () => {
    const src = `
procedure SaySomething()
begin
    // call begin before end
    Foo();
    /* begin in a block comment end */
end;
`;
    const p = findProcedure(src, 'SaySomething');
    expect(p?.body).toContain('Foo()');
    expect(p?.body).toMatch(/end$/);
  });

  it('returns null when procedure not found', () => {
    const src = `
procedure A() begin end;
procedure B() begin end;
`;
    expect(findProcedure(src, 'C')).toBeNull();
  });

  it('is case-insensitive on name lookup', () => {
    const src = `
procedure DoIt() begin end;
`;
    expect(findProcedure(src, 'doit')).not.toBeNull();
    expect(findProcedure(src, 'DOIT')).not.toBeNull();
  });

  it('captures named return type', () => {
    const src = `
procedure Compute(): Result: Integer
begin
    Result := 42;
end;
`;
    const p = findProcedure(src, 'Compute');
    expect(p?.signature).toMatch(/Result:\s*Integer/);
  });

  it('handles CRLF line endings (real BC source files)', () => {
    const src = [
      '    end;', '', '    [IntegrationEvent(false, false)]',
      '    procedure OnSendSalesDocForApproval(var SalesHeader: Record "Sales Header")',
      '    begin', '    end;',
    ].join('\r\n');
    const p = findProcedure(src, 'OnSendSalesDocForApproval');
    expect(p).not.toBeNull();
    expect(p?.attributes).toHaveLength(1);
    expect(p?.attributes[0]).toBe('[IntegrationEvent(false, false)]');
  });
});

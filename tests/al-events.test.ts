import { describe, it, expect } from 'vitest';
import { extractEventPublishers } from '../src/parser/al-events.js';

describe('extractEventPublishers', () => {
  it('extracts a basic IntegrationEvent', () => {
    const src = `
codeunit 1535 "Approvals Mgmt."
{
    [IntegrationEvent(false, false)]
    procedure OnSendSalesDocForApproval(var SalesHeader: Record "Sales Header")
    begin
    end;
}
`;
    const events = extractEventPublishers(src);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'IntegrationEvent',
      name: 'OnSendSalesDocForApproval',
    });
    expect(events[0]!.signature).toContain('procedure OnSendSalesDocForApproval');
    expect(events[0]!.signature).toContain('var SalesHeader: Record "Sales Header"');
  });

  it('extracts multiple events of different kinds', () => {
    const src = `
codeunit 1 Foo
{
    [IntegrationEvent(false, false)]
    procedure OnA(var X: Integer)
    begin end;

    [BusinessEvent(false, false)]
    procedure OnB()
    begin end;

    [InternalEvent(false, false)]
    procedure OnC(var Y: Text)
    begin end;
}
`;
    const events = extractEventPublishers(src);
    expect(events).toHaveLength(3);
    expect(events.map(e => e.kind)).toEqual([
      'IntegrationEvent', 'BusinessEvent', 'InternalEvent',
    ]);
    expect(events.map(e => e.name)).toEqual(['OnA', 'OnB', 'OnC']);
  });

  it('handles local/internal procedure modifiers', () => {
    const src = `
[IntegrationEvent(false, false)]
local procedure OnInternalEvent(var X: Integer)
begin
end;
`;
    const events = extractEventPublishers(src);
    expect(events).toHaveLength(1);
    expect(events[0]?.name).toBe('OnInternalEvent');
    expect(events[0]?.signature).toMatch(/local\s+procedure/);
  });

  it('handles 3-arg IntegrationEvent (with IsolationLevel)', () => {
    const src = `
[IntegrationEvent(false, false, IsolationLevel::ReadCommitted)]
procedure OnFoo(var X: Integer)
begin
end;
`;
    const events = extractEventPublishers(src);
    expect(events).toHaveLength(1);
    expect(events[0]?.attribute).toContain('IsolationLevel');
  });

  it('captures return type when present', () => {
    const src = `
[IntegrationEvent(false, false)]
procedure OnGetSomething(var X: Integer) Result: Boolean
begin
end;
`;
    const events = extractEventPublishers(src);
    expect(events).toHaveLength(1);
    expect(events[0]?.signature).toMatch(/Result:\s*Boolean/);
  });

  it('handles nested parens in record types', () => {
    const src = `
[IntegrationEvent(false, false)]
procedure OnTricky(var Rec: Record "Foo (Bar)")
begin
end;
`;
    const events = extractEventPublishers(src);
    expect(events).toHaveLength(1);
    expect(events[0]?.signature).toContain('Record "Foo (Bar)"');
  });

  it('returns empty array when no events present', () => {
    const src = `
codeunit 1 Foo
{
    procedure PlainProc()
    begin
    end;
}
`;
    expect(extractEventPublishers(src)).toEqual([]);
  });

  it('tracks line numbers correctly', () => {
    const src = [
      'codeunit 1 Foo',
      '{',
      '    procedure PlainProc()',
      '    begin end;',
      '',
      '    [IntegrationEvent(false, false)]',
      '    procedure OnSomething(var X: Integer)',
      '    begin end;',
      '}',
    ].join('\n');
    const events = extractEventPublishers(src);
    expect(events).toHaveLength(1);
    expect(events[0]?.line).toBe(7);
  });
});

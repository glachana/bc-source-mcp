import { describe, it, expect } from 'vitest';
import { parseObjectHeader, appFromPath } from '../src/parser/al-object.js';

describe('parseObjectHeader', () => {
  it('parses a table with quoted name', () => {
    const src = `table 18 "Customer"\n{\n    DataClassification = CustomerContent;\n}\n`;
    expect(parseObjectHeader(src)).toEqual({
      type: 'table', id: 18, name: 'Customer', extends: null,
    });
  });

  it('parses a table with unquoted name', () => {
    const src = `table 18 Customer\n{\n}\n`;
    expect(parseObjectHeader(src)).toEqual({
      type: 'table', id: 18, name: 'Customer', extends: null,
    });
  });

  it('parses a page with multi-word quoted name', () => {
    const src = `page 21 "Customer Card"\n{\n    PageType = Card;\n}\n`;
    expect(parseObjectHeader(src)).toEqual({
      type: 'page', id: 21, name: 'Customer Card', extends: null,
    });
  });

  it('parses a codeunit', () => {
    const src = `codeunit 12 "Gen. Jnl.-Post"\n{\n}\n`;
    expect(parseObjectHeader(src)).toEqual({
      type: 'codeunit', id: 12, name: 'Gen. Jnl.-Post', extends: null,
    });
  });

  it('parses a report', () => {
    const src = `report 109 "Customer - Top 10 List"\n{\n}\n`;
    expect(parseObjectHeader(src)?.type).toBe('report');
  });

  it('parses an enum', () => {
    const src = `enum 1 "Sales Document Type"\n{\n}\n`;
    expect(parseObjectHeader(src)).toEqual({
      type: 'enum', id: 1, name: 'Sales Document Type', extends: null,
    });
  });

  it('parses tableextension with extends', () => {
    const src = `tableextension 50100 "Cust Ext" extends Customer\n{\n}\n`;
    expect(parseObjectHeader(src)).toEqual({
      type: 'tableextension', id: 50100, name: 'Cust Ext', extends: 'Customer',
    });
  });

  it('parses pageextension extending a quoted name', () => {
    const src = `pageextension 50101 "Cust Card Ext" extends "Customer Card"\n{\n}\n`;
    expect(parseObjectHeader(src)).toEqual({
      type: 'pageextension', id: 50101, name: 'Cust Card Ext', extends: 'Customer Card',
    });
  });

  it('parses interface without id', () => {
    const src = `interface "IFoo"\n{\n}\n`;
    expect(parseObjectHeader(src)).toEqual({
      type: 'interface', id: null, name: 'IFoo', extends: null,
    });
  });

  it('parses controladdin without id', () => {
    const src = `controladdin BigTextBox\n{\n}\n`;
    expect(parseObjectHeader(src)).toEqual({
      type: 'controladdin', id: null, name: 'BigTextBox', extends: null,
    });
  });

  it('parses permissionsetextension', () => {
    const src = `permissionsetextension 60101 "Custom Sales" extends "Sales"\n{\n}\n`;
    expect(parseObjectHeader(src)).toEqual({
      type: 'permissionsetextension', id: 60101, name: 'Custom Sales', extends: 'Sales',
    });
  });

  it('skips line comments before declaration', () => {
    const src = `// Copyright Microsoft\n// Licensed under MIT\ntable 18 "Customer"\n{\n}\n`;
    expect(parseObjectHeader(src)?.name).toBe('Customer');
  });

  it('skips block comments before declaration', () => {
    const src = `/* Multi\n   line\n   comment */\ntable 18 "Customer"\n{\n}\n`;
    expect(parseObjectHeader(src)?.name).toBe('Customer');
  });

  it('skips pragma and region directives', () => {
    const src = `#pragma implicitwith disable\n#region MyRegion\ntable 18 "Customer"\n{\n}\n`;
    expect(parseObjectHeader(src)?.name).toBe('Customer');
  });

  it('skips namespace and using directives (BC v26+)', () => {
    const src = [
      'namespace Microsoft.Sales.Customer;',
      '',
      'using Microsoft.Bank.BankAccount;',
      'using Microsoft.CRM.Contact;',
      '',
      'table 18 Customer',
      '{',
      '}',
    ].join('\n');
    expect(parseObjectHeader(src)).toEqual({
      type: 'table', id: 18, name: 'Customer', extends: null,
    });
  });

  it('handles trailing line comment on declaration', () => {
    const src = `table 18 "Customer" // primary customer table\n{\n}\n`;
    expect(parseObjectHeader(src)).toEqual({
      type: 'table', id: 18, name: 'Customer', extends: null,
    });
  });

  it('is case-insensitive on the type keyword', () => {
    const src = `TABLE 18 "Customer"\n{\n}\n`;
    expect(parseObjectHeader(src)?.type).toBe('table');
  });

  it('returns null on empty source', () => {
    expect(parseObjectHeader('')).toBeNull();
  });

  it('returns null when first non-comment line is not a declaration', () => {
    const src = `// header\nrandom garbage here\ntable 18 "Customer"\n{\n}\n`;
    expect(parseObjectHeader(src)).toBeNull();
  });
});

describe('appFromPath', () => {
  it('extracts top-level folder from a forward-slash path', () => {
    expect(appFromPath('Base Application/Src/Sales/Cust.Table.al')).toBe('Base Application');
  });

  it('handles backslash paths (Windows)', () => {
    expect(appFromPath('Base Application\\Src\\Sales\\Cust.Table.al')).toBe('Base Application');
  });

  it('returns the path itself when no separator', () => {
    expect(appFromPath('foo.al')).toBe('foo.al');
  });
});

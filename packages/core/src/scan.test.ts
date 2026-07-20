import { describe, expect, it } from 'vitest';

import { maskImports } from './scan.js';

const lineCount = (s: string): number => s.split('\n').length;

describe('maskImports', () => {
  it('blanks a single-line named import but keeps positions', () => {
    const src = "import { getUser } from './api';";
    const masked = maskImports(src);
    expect(masked).not.toContain('getUser');
    expect(masked.length).toBe(src.length);
  });

  it('blanks multi-line imports across every line', () => {
    const src = [
      'import {',
      '  getUser,',
      '  createUser,',
      "} from './api';",
      '',
      'getUser();',
    ].join('\n');
    const masked = maskImports(src);
    const maskedLines = masked.split('\n');
    // The import block (lines 0-3) must not contain the symbols…
    expect(maskedLines.slice(0, 4).join('\n')).not.toMatch(/getUser|createUser/);
    // …but the real call on the last line survives, at the same line index.
    expect(maskedLines[5]).toBe('getUser();');
    expect(lineCount(masked)).toBe(lineCount(src));
  });

  it('masks re-exports and side-effect imports', () => {
    expect(maskImports("export { getUser } from './api';")).not.toContain('getUser');
    expect(maskImports("import './polyfill';")).not.toContain('polyfill');
  });

  it('does not swallow code after a from-less statement boundary', () => {
    const src = "import './a';\ngetUser();";
    const masked = maskImports(src);
    expect(masked.split('\n')[1]).toBe('getUser();');
  });

  it('leaves a local (non re-export) export untouched', () => {
    const src = 'export const getUser = () => useGetUser();';
    expect(maskImports(src)).toBe(src);
  });
});

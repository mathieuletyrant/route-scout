import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { buildIndex } from './build.js';
import { importedSymbols } from './scan.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures-import');

describe('importedSymbols', () => {
  it('collects named, default, aliased and namespace imports', () => {
    const src = [
      "import Default, { a, b as c } from './x';",
      "import * as ns from './y';",
      "import { type T, d } from './z';",
      'const local = 1;',
    ].join('\n');
    const names = importedSymbols(src);
    expect([...names].sort()).toEqual(['Default', 'a', 'c', 'd', 'ns'].sort());
  });

  it('handles multi-line import clauses', () => {
    const src = 'import {\n  one,\n  two,\n} from "./m";';
    expect([...importedSymbols(src)].sort()).toEqual(['one', 'two']);
  });

  it('filters by module source substring', () => {
    const src = "import { a } from './generated/client';\nimport { b } from './utils';";
    expect([...importedSymbols(src, ['generated'])]).toEqual(['a']);
  });
});

describe('buildIndex importAware', () => {
  it('counts a bare identifier only where it is imported', async () => {
    const off = await buildIndex({ root: FIXTURES });
    const on = await buildIndex({ root: FIXTURES, importAware: true });

    const count = (r: Awaited<ReturnType<typeof buildIndex>>) =>
      r.endpoints.find((e) => e.operation.operationId === 'getWidget')?.callSites.length ?? 0;

    // Without gating: the imported call + the Apollo destructure & call all match.
    expect(count(off)).toBe(3);
    // With gating: only the file that imports `getWidget` counts.
    const sites =
      on.endpoints.find((e) => e.operation.operationId === 'getWidget')?.callSites ?? [];
    expect(sites).toHaveLength(1);
    expect(sites[0]?.file).toBe('src/client-call.ts');
  });
});

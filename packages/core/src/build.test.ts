import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { buildIndex } from './build.js';
import type { EndpointUsage, IndexResult } from './types.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures');

const find = (result: IndexResult, operationId: string): EndpointUsage => {
  const found = result.endpoints.find((e) => e.operation.operationId === operationId);
  if (!found) throw new Error(`operation ${operationId} not found`);
  return found;
};

describe('buildIndex', () => {
  it('maps operations to call sites with the default (symbol) matchers', async () => {
    const result = await buildIndex({ root: FIXTURES });

    expect(result.stats.operations).toBe(5);
    expect(result.stats.specFiles).toBe(1);

    // useListPets() usage — the import line is ignored, so exactly one call site.
    expect(find(result, 'listPets').callSites).toHaveLength(1);
    expect(find(result, 'listPets').callSites[0]!.file).toBe('src/pets-page.ts');

    expect(find(result, 'getPetById').callSites).toHaveLength(1);
    expect(find(result, 'createPet').callSites).toHaveLength(1);
    expect(find(result, 'deletePet').callSites).toHaveLength(1);
  });

  it('reports operations with no operationId as unused (no symbol to match)', async () => {
    const result = await buildIndex({ root: FIXTURES });
    const health = result.endpoints.find((e) => e.operation.path === '/health');
    expect(health?.operation.operationId).toBeNull();
    expect(health?.callSites).toHaveLength(0);
  });

  it('does not count import lines as usage', async () => {
    const result = await buildIndex({ root: FIXTURES });
    const importLines = find(result, 'listPets').callSites.filter((s) =>
      s.preview.startsWith('import'),
    );
    expect(importLines).toHaveLength(0);
  });

  it('supports regex matchers against raw URLs', async () => {
    const result = await buildIndex({
      root: FIXTURES,
      usage: [{ kind: 'regex', template: 'fetch\\([\'"]{path}[\'"]' }],
    });
    const listPets = find(result, 'listPets');
    expect(listPets.callSites).toHaveLength(1);
    expect(listPets.callSites[0]!.file).toBe('src/admin.ts');
    // /pets/{petId} must not match the /pets fetch call.
    expect(find(result, 'getPetById').callSites).toHaveLength(0);
  });

  it('honours a custom usage matcher list', async () => {
    const result = await buildIndex({
      root: FIXTURES,
      usage: [{ kind: 'symbol', template: 'use{OperationId}' }],
    });
    // createPet is only ever called bare (createPet(...)), never as a hook.
    expect(find(result, 'createPet').callSites).toHaveLength(0);
    expect(find(result, 'listPets').callSites).toHaveLength(1);
  });
});

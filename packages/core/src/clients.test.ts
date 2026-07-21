import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { buildIndex } from './build.js';
import { clientSpecsForModule, moduleMatches, normalizeImport, resolveClients } from './clients.js';
import type { ClientConfig } from './config.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures-clients');

const CLIENTS: ClientConfig[] = [
  { module: '__generated__/orders-client', spec: 'orders-api-openapi.json' },
  { module: 'providers/billing/__generated__', spec: 'billing-api-openapi.json' },
];

const getThing = (r: Awaited<ReturnType<typeof buildIndex>>, specFile: string) =>
  r.endpoints.find(
    (e) => e.operation.operationId === 'getThing' && e.operation.specFile === specFile,
  );

describe('normalizeImport', () => {
  it('keeps bare/alias specifiers as-is (discriminant already present)', () => {
    expect(normalizeImport('~/__generated__/orders-client/things.js', 'src/ui/useThing.ts')).toBe(
      '~/__generated__/orders-client/things.js',
    );
    expect(normalizeImport('@sourcehub/mdm-client', 'src/x.ts')).toBe('@sourcehub/mdm-client');
  });

  it('resolves a relative specifier to a repo-relative path (extension stripped)', () => {
    expect(
      normalizeImport(
        '../__generated__/client.js',
        'src/providers/billing/services/things.service.ts',
      ),
    ).toBe('src/providers/billing/__generated__/client');
  });
});

describe('moduleMatches', () => {
  it('substring by default, glob when `*` present', () => {
    expect(moduleMatches('orders-client', 'x/__generated__/orders-client/y')).toBe(true);
    expect(moduleMatches('orders-client', 'x/billing-client/y')).toBe(false);
    expect(moduleMatches('*mdm*', 'a/mdm-server-client/b')).toBe(true);
  });
});

describe('resolveClients / clientSpecsForModule', () => {
  it('maps a module to its spec files', () => {
    const resolved = resolveClients(CLIENTS, [
      'specs/orders-api-openapi.json',
      'specs/billing-api-openapi.json',
    ]);
    expect(clientSpecsForModule('~/__generated__/orders-client/things', resolved)).toEqual(
      new Set(['specs/orders-api-openapi.json']),
    );
    expect(clientSpecsForModule('src/providers/billing/__generated__/client', resolved)).toEqual(
      new Set(['specs/billing-api-openapi.json']),
    );
    expect(clientSpecsForModule('some/unrelated/module', resolved).size).toBe(0);
  });
});

describe('buildIndex with clients (per-endpoint attribution)', () => {
  const config = {
    root: FIXTURES,
    specs: ['specs/*-openapi.json'],
    sources: ['src/**/*.ts'],
    // symbol matchers catch imported hooks/functions; the regex catches
    // property-access calls on a client instance (`api.getThing(...)`).
    usage: [
      { kind: 'symbol' as const, template: '{operationId}' },
      { kind: 'symbol' as const, template: 'use{OperationId}' },
      { kind: 'regex' as const, template: '\\.{operationId}\\s*\\(' },
    ],
  };

  it('splits a shared operationId to the right endpoint and ignores non-client code', async () => {
    const r = await buildIndex({ ...config, clients: CLIENTS });

    const orders = getThing(r, 'specs/orders-api-openapi.json');
    const billing = getThing(r, 'specs/billing-api-openapi.json');

    expect(orders?.callSites.map((s) => s.file)).toEqual(['src/ui/useThing.ts']);
    expect(billing?.callSites.map((s) => s.file)).toEqual([
      'src/providers/billing/services/things.service.ts',
    ]);

    // Decoys (controller method + local usecase) never count.
    const allFiles = r.endpoints.flatMap((e) => e.callSites.map((s) => s.file));
    expect(allFiles.some((f) => f.includes('decoy'))).toBe(false);
  });

  it('without clients, the shared operationId collides (both endpoints see every hit)', async () => {
    const r = await buildIndex(config);
    const orders = getThing(r, 'specs/orders-api-openapi.json');
    const billing = getThing(r, 'specs/billing-api-openapi.json');
    // No gating → the decoys + both real sites land on both endpoints identically.
    expect(orders?.callSites.length ?? 0).toBeGreaterThan(1);
    expect(orders?.callSites.length).toBe(billing?.callSites.length);
  });
});

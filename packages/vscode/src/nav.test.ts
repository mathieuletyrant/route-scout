import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildIndex } from '@route-scout/core';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  type DeclLoc,
  declarationsIn,
  disambiguate,
  endpointIdentity,
  pickDeclaration,
  type Scouted,
  toPosix,
} from './nav.js';

// A "sourcehub-like" workspace: two servers (orders, billing), each exposing the
// SAME operationId `getInvoice` on two channels (api + internal). So one id maps
// to four endpoints and four controllers, all on the identical URL path
// `/invoices/{id}`. Only the spec/controller *names* tell them apart.
const fixtureRoot = fileURLToPath(new URL('../test/fixtures/multi-channel', import.meta.url));

const CONTROLLERS = [
  'apps/orders/src/invoices.api.controller.ts',
  'apps/orders/src/invoices.internal.controller.ts',
  'apps/billing/src/invoices.api.controller.ts',
  'apps/billing/src/invoices.internal.controller.ts',
];

let endpoints: Scouted[];
let declsById: Map<string, DeclLoc[]>;

beforeAll(async () => {
  const result = await buildIndex({
    root: fixtureRoot,
    specs: ['specs/*-openapi.json'],
    sources: ['src/**/*.ts'],
  });
  endpoints = result.endpoints.map((endpoint) => ({ root: result.root, endpoint }));

  declsById = new Map();
  for (const file of CONTROLLERS) {
    const text = readFileSync(join(fixtureRoot, file), 'utf8');
    for (const { id, line } of declarationsIn(text)) {
      const list = declsById.get(id) ?? [];
      list.push({ root: fixtureRoot, file, line });
      declsById.set(id, list);
    }
  }
});

const endpointFor = (specFile: string): Scouted => {
  const found = endpoints.find((e) => e.endpoint.operation.specFile === specFile);
  if (!found) throw new Error(`no endpoint for ${specFile}`);
  return found;
};

describe('multi-channel disambiguation', () => {
  it('reproduces the collision: one operationId, four endpoints, four controllers', () => {
    const invoices = endpoints.filter((e) => e.endpoint.operation.operationId === 'getInvoice');
    expect(invoices).toHaveLength(4);
    expect(declsById.get('getInvoice')).toHaveLength(4);
  });

  // The bug: every endpoint shares path `/invoices/{id}`, so routing on the URL
  // segment alone lands on an arbitrary controller. Identity (channel + server)
  // must send each of the four endpoints to its own controller.
  it.each([
    ['specs/orders-api-openapi.json', 'apps/orders/src/invoices.api.controller.ts'],
    ['specs/orders-internal-openapi.json', 'apps/orders/src/invoices.internal.controller.ts'],
    ['specs/billing-api-openapi.json', 'apps/billing/src/invoices.api.controller.ts'],
    ['specs/billing-internal-openapi.json', 'apps/billing/src/invoices.internal.controller.ts'],
  ])('routes %s to %s', (specFile, controller) => {
    const { operation } = endpointFor(specFile).endpoint;
    const choice = pickDeclaration(declsById.get('getInvoice') ?? [], endpointIdentity(operation));
    expect(choice.ambiguous).toBe(false);
    expect(choice.best?.file).toBe(controller);
  });

  it('sends the four endpoints to four distinct controllers', () => {
    const targets = ['orders-api', 'orders-internal', 'billing-api', 'billing-internal'].map(
      (channel) => {
        const { operation } = endpointFor(`specs/${channel}-openapi.json`).endpoint;
        return pickDeclaration(declsById.get('getInvoice') ?? [], endpointIdentity(operation)).best
          ?.file;
      },
    );
    expect(new Set(targets).size).toBe(4);
  });

  it('flags ambiguity (instead of guessing) when no token distinguishes candidates', () => {
    const { operation } = endpointFor('specs/orders-api-openapi.json').endpoint;
    // Two identical declarations with no channel/server token to tell them apart.
    const decls: DeclLoc[] = [
      { root: fixtureRoot, file: 'a/invoices.controller.ts', line: 1 },
      { root: fixtureRoot, file: 'b/invoices.controller.ts', line: 1 },
    ];
    const choice = pickDeclaration(decls, endpointIdentity(operation));
    expect(choice.ambiguous).toBe(true);
    expect(choice.best).toBeNull();
    expect(choice.ranked).toHaveLength(2);
  });
});

describe('disambiguate (spec <-> usage, by document path)', () => {
  it('narrows to the endpoint whose channel matches the document', () => {
    const invoices = endpoints.filter((e) => e.endpoint.operation.operationId === 'getInvoice');
    const docFsPath = join(fixtureRoot, 'apps/billing/src/invoices.internal.controller.ts');
    const narrowed = disambiguate(docFsPath, undefined, invoices);
    expect(narrowed).toHaveLength(1);
    expect(narrowed[0]!.endpoint.operation.specFile).toBe('specs/billing-internal-openapi.json');
  });

  it('prefers an exact spec-file match', () => {
    const invoices = endpoints.filter((e) => e.endpoint.operation.operationId === 'getInvoice');
    const specRel = toPosix(
      relative(fixtureRoot, join(fixtureRoot, 'specs/orders-api-openapi.json')),
    );
    const narrowed = disambiguate('whatever.ts', specRel, invoices);
    expect(narrowed).toHaveLength(1);
    expect(narrowed[0]!.endpoint.operation.specFile).toBe('specs/orders-api-openapi.json');
  });
});

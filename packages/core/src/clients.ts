import { posix } from 'node:path';

import type { ClientConfig } from './config.js';
import { asArray, patternMatches } from './match.js';

const toPosix = (p: string): string => p.split('\\').join('/');

/** A client with its module/file patterns and the concrete spec files it resolved to. */
export interface ResolvedClient {
  modules: string[];
  files: string[];
  specFiles: string[];
}

/** `true` when `pattern` matches `str`: glob semantics if it contains `*`, else substring. */
export const moduleMatches = patternMatches;

/**
 * Normalize an import specifier to a string matchable against a client `module`.
 * Relative specifiers are resolved against the importing file (repo-relative,
 * posix, extension stripped) so a generic `../__generated__/client.js` becomes
 * the discriminating `apps/…/providers/companyServer/__generated__/client`.
 * Bare/alias specifiers already carry the discriminant, so are kept as-is.
 */
export function normalizeImport(specifier: string, importerRelFile: string): string {
  if (!specifier.startsWith('.')) return specifier;
  const dir = posix.dirname(toPosix(importerRelFile));
  return posix.normalize(posix.join(dir, specifier)).replace(/\.(?:m|c)?[jt]sx?$/, '');
}

/** Resolve each client's `spec` patterns to the concrete spec files present in the index. */
export function resolveClients(clients: ClientConfig[], specFiles: string[]): ResolvedClient[] {
  return clients.map((client) => ({
    modules: asArray(client.module),
    files: asArray(client.files),
    specFiles: specFiles.filter((sf) => asArray(client.spec).some((p) => moduleMatches(p, sf))),
  }));
}

/** The spec files of every client whose module patterns match `normalizedModule`. */
export function clientSpecsForModule(
  normalizedModule: string,
  clients: ResolvedClient[],
): Set<string> {
  const specs = new Set<string>();
  for (const client of clients) {
    if (client.modules.some((m) => moduleMatches(m, normalizedModule))) {
      for (const sf of client.specFiles) specs.add(sf);
    }
  }
  return specs;
}

/**
 * The spec files of every client whose `files` patterns match `relFile` — i.e.
 * the specs this whole file is declared to talk to, independently of imports.
 */
export function clientSpecsForFile(relFile: string, clients: ResolvedClient[]): Set<string> {
  const specs = new Set<string>();
  const file = toPosix(relFile);
  for (const client of clients) {
    if (client.files.some((f) => moduleMatches(f, file))) {
      for (const sf of client.specFiles) specs.add(sf);
    }
  }
  return specs;
}

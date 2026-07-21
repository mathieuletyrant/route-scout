import { posix } from 'node:path';

import type { ClientConfig } from './config.js';

const toPosix = (p: string): string => p.split('\\').join('/');
const asArray = (v: string | string[]): string[] => (Array.isArray(v) ? v : [v]);

/** A client with its module patterns and the concrete spec files it resolved to. */
export interface ResolvedClient {
  modules: string[];
  specFiles: string[];
}

/** `true` when `pattern` matches `str`: glob semantics if it contains `*`, else substring. */
export function moduleMatches(pattern: string, str: string): boolean {
  if (!pattern.includes('*')) return str.includes(pattern);
  const re = new RegExp(
    pattern
      .split('*')
      .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*'),
  );
  return re.test(str);
}

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
